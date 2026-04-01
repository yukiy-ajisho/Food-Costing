import { supabase } from "../config/supabase";
import type { Item, RecipeLine } from "../types/database";

/**
 * Cross-tenant aware recipe dependency cycle detection.
 * Share semantics match calculate_item_costs_with_breakdown cross-tenant seed (temp_ct_foreign_needed EXISTS).
 */

const CYCLE_MSG_PREFIX = "Cycle detected in recipe dependency chain.";

export class RecipeDependencyCycleError extends Error {
  readonly code = "RECIPE_DEPENDENCY_CYCLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "RecipeDependencyCycleError";
  }
}

export class CrossTenantShareDeniedError extends Error {
  readonly code = "CROSS_TENANT_SHARE_DENIED" as const;
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantShareDeniedError";
  }
}

export class CrossTenantNonPreppedIngredientError extends Error {
  readonly code = "CROSS_TENANT_NON_PREPPED_INGREDIENT" as const;
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantNonPreppedIngredientError";
  }
}

function pathStringForMessage(
  itemIds: string[],
  itemsMap: Map<string, Item>
): string {
  return itemIds
    .map((id) => {
      const it = itemsMap.get(id);
      return it?.name && it.name.length > 0 ? it.name : id;
    })
    .join(" → ");
}

/**
 * Seed-equivalent: cross_tenant_item_shares + company_tenants (viewer in share company),
 * read in allowed_actions, target company or tenant matches viewer.
 */
async function hasCrossTenantReadShare(
  viewerTenantId: string,
  childItem: Item,
  shareCache: Map<string, boolean>
): Promise<boolean> {
  const cacheKey = `${viewerTenantId}:${childItem.id}`;
  if (shareCache.has(cacheKey)) {
    return shareCache.get(cacheKey)!;
  }

  const { data: shares, error } = await supabase
    .from("cross_tenant_item_shares")
    .select(
      "id, company_id, owner_tenant_id, item_id, target_type, target_id, allowed_actions"
    )
    .eq("item_id", childItem.id)
    .eq("owner_tenant_id", childItem.tenant_id);

  if (error || !shares?.length) {
    shareCache.set(cacheKey, false);
    return false;
  }

  const companyIds = [...new Set(shares.map((s) => s.company_id))];
  const { data: links } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", viewerTenantId)
    .in("company_id", companyIds);

  const viewerCompanies = new Set((links ?? []).map((l) => l.company_id));

  for (const row of shares) {
    if (!viewerCompanies.has(row.company_id)) continue;
    const actions = row.allowed_actions ?? [];
    if (!actions.includes("read")) continue;

    const companyIdText = String(row.company_id);
    const targetOk =
      (row.target_type === "company" && row.target_id === companyIdText) ||
      (row.target_type === "tenant" && row.target_id === viewerTenantId);

    if (targetOk) {
      shareCache.set(cacheKey, true);
      return true;
    }
  }

  shareCache.set(cacheKey, false);
  return false;
}

async function ensureItem(
  itemId: string,
  itemsMap: Map<string, Item>
): Promise<Item | null> {
  let item = itemsMap.get(itemId);
  if (item) return item;

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !data) return null;
  item = data as Item;
  itemsMap.set(itemId, item);
  return item;
}

async function loadIngredientLinesForParent(
  parentItem: Item,
  recipeLinesOverlay: Map<string, RecipeLine[]> | undefined,
  linesCache: Map<string, RecipeLine[]>
): Promise<RecipeLine[]> {
  const cacheKey = `${parentItem.id}:${parentItem.tenant_id}`;
  if (linesCache.has(cacheKey)) {
    return linesCache.get(cacheKey)!;
  }

  let lines: RecipeLine[];

  if (recipeLinesOverlay?.has(parentItem.id)) {
    lines = (recipeLinesOverlay.get(parentItem.id) ?? []).filter(
      (l) =>
        l.line_type === "ingredient" &&
        l.tenant_id === parentItem.tenant_id &&
        l.child_item_id
    );
  } else {
    const { data, error } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", parentItem.id)
      .eq("tenant_id", parentItem.tenant_id)
      .eq("line_type", "ingredient");

    if (error) {
      console.log(
        `[CYCLE DETECTION CT] Error fetching recipe lines for parent ${parentItem.id}: ${error.message}`
      );
      lines = [];
    } else {
      lines = (data ?? []).filter((l) => l.child_item_id);
    }
  }

  linesCache.set(cacheKey, lines);
  return lines;
}

/**
 * DFS cycle check with cross-tenant edges gated by the same read-share rules as cost RPC seed.
 *
 * @param viewerTenantId - Editing / request tenant (one per request).
 * @param recipeLinesOverlay - Optional map parent_item_id -> lines (simulated state for unsaved POST/PUT/batch).
 */
export async function checkCycleCrossTenant(
  itemId: string,
  viewerTenantId: string,
  visited: Set<string>,
  itemsMap: Map<string, Item>,
  recipeLinesOverlay: Map<string, RecipeLine[]> | undefined,
  linesCache: Map<string, RecipeLine[]>,
  shareCache: Map<string, boolean>,
  currentPath: string[],
  enforceShareCheck: boolean = true
): Promise<void> {
  const item = await ensureItem(itemId, itemsMap);
  if (!item) {
    console.log(
      `[CYCLE DETECTION CT] Item not found: ${itemId}, skipping branch...`
    );
    return;
  }

  const itemName = item.name || itemId;
  const pathNames = currentPath.map((id) => pathStringForMessage([id], itemsMap));
  console.log(
    `[CYCLE DETECTION CT] Checking item: ${itemName} (${itemId}), viewer=${viewerTenantId}, path: [${pathNames.join(" → ")}]`
  );

  if (visited.has(itemId)) {
    const cyclePath = [...currentPath, itemId];
    const pathStr = pathStringForMessage(cyclePath, itemsMap);
    console.error(
      `[CYCLE DETECTION CT] CYCLE at "${itemName}" (${itemId}). Path: ${pathStr}`
    );
    throw new RecipeDependencyCycleError(
      `${CYCLE_MSG_PREFIX} Item "${itemName}" creates a circular dependency. Path: ${pathStr}`
    );
  }

  if (item.item_kind === "raw") {
    console.log(
      `[CYCLE DETECTION CT] Item is raw: ${itemName} (${itemId}), leaf.`
    );
    return;
  }

  const recipeLines = await loadIngredientLinesForParent(
    item,
    recipeLinesOverlay,
    linesCache
  );

  console.log(
    `[CYCLE DETECTION CT] Item ${itemName} (${itemId}) has ${recipeLines.length} ingredient line(s) (tenant_id=${item.tenant_id})`
  );

  visited.add(itemId);
  const newPath = [...currentPath, itemId];

  try {
    for (const line of recipeLines) {
      if (line.line_type !== "ingredient" || !line.child_item_id) continue;

      const childItem = await ensureItem(line.child_item_id, itemsMap);
      if (!childItem) {
        throw new Error(
          `Ingredient item not found: ${line.child_item_id}. It may have been deleted or is not visible.`
        );
      }

      const childName = childItem.name || line.child_item_id;
      console.log(
        `[CYCLE DETECTION CT] Edge ${itemName} → ${childName} (parentTenant=${item.tenant_id}, childTenant=${childItem.tenant_id})`
      );

      if (item.tenant_id !== childItem.tenant_id) {
        if (childItem.item_kind !== "prepped") {
          throw new CrossTenantNonPreppedIngredientError(
            `Cannot use ingredient "${childName}": it belongs to another tenant but is not a prepped item. Only shared prepped items may be used across tenants.`
          );
        }
        if (enforceShareCheck) {
          const allowed = await hasCrossTenantReadShare(
            viewerTenantId,
            childItem,
            shareCache
          );
          if (!allowed) {
            throw new CrossTenantShareDeniedError(
              `Cannot use ingredient "${childName}": this prepped item is not shared for read access to your tenant (or the share does not match costing rules). Remove it or ask the owner tenant to publish it.`
            );
          }
        }
      }

      await checkCycleCrossTenant(
        line.child_item_id,
        // Descend with the next parent's home tenant as viewer context.
        // This keeps cross-tenant share checks aligned with each edge owner.
        childItem.tenant_id,
        visited,
        itemsMap,
        recipeLinesOverlay,
        linesCache,
        shareCache,
        newPath,
        enforceShareCheck
      );
    }
    console.log(
      `[CYCLE DETECTION CT] No cycle below item: ${itemName} (${itemId})`
    );
  } finally {
    visited.delete(itemId);
  }
}
