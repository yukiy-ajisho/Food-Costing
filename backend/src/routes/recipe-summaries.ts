import { Router } from "express";
import { supabase } from "../config/supabase";
import { withTenantFilter } from "../middleware/tenant-filter";
import { convertToGrams } from "../services/units";
import type { BaseItem, Item, RecipeLine, VendorProduct } from "../types/database";
import { calculateCost } from "../services/cost";

const router = Router();

type RecipeSummaryRow = {
  id: string;
  tenant_id: string;
  summary_name: string;
  source_item_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type AccessCheckResult = {
  allowed: boolean;
  reason: "cross_tenant_restricted" | "hidden_by_access_control" | null;
};

type TechnicalSheetStep = {
  step_key: string;
  title: string;
  item_id: string;
  procedure: string | null;
};

type IngredientAccumulator = {
  item_id: string;
  nature: string;
  vendor_item: string;
  unit: string;
  step_quantities: Record<string, number>;
  total: number;
  pu: number;
  pt: number;
};

async function isCompanyOfficerOnTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: link, error: linkErr } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (linkErr || !link?.company_id) return false;
  const { data: member } = await supabase
    .from("company_members")
    .select("id")
    .eq("company_id", link.company_id)
    .eq("user_id", userId)
    .in("role", ["company_admin", "company_director"])
    .maybeSingle();
  return !!member;
}

function evaluateAccessControl(
  roleInTenant: string | undefined,
  currentUserId: string,
  item: { id: string; tenant_id: string; responsible_user_id?: string | null },
  selectedTenantId: string,
  managerShareTypeByItemId: Map<string, "hide" | "view-only" | "editable">,
  canUseCrossTenant: boolean,
  sharedCrossTenantItemIds: Set<string>,
): AccessCheckResult {
  const isCrossTenant = item.tenant_id !== selectedTenantId;
  if (isCrossTenant) {
    if (!canUseCrossTenant || !sharedCrossTenantItemIds.has(item.id)) {
      return { allowed: false, reason: "cross_tenant_restricted" };
    }
  }

  if (roleInTenant !== "manager") {
    return { allowed: true, reason: null };
  }

  const shareType = managerShareTypeByItemId.get(item.id) ?? "hide";
  const isResponsible = item.responsible_user_id === currentUserId;
  if (shareType === "hide" && !isResponsible) {
    return { allowed: false, reason: "hidden_by_access_control" };
  }

  return { allowed: true, reason: null };
}

function nextStepKey(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let n = index;
  let result = "";
  do {
    result = alphabet[n % 26] + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

function toDisplayName(item: Pick<Item, "item_kind" | "name" | "base_item_id">, baseItem?: BaseItem | null): string {
  if (item.item_kind === "raw") {
    return (baseItem?.name ?? item.name ?? "").trim() || "(Unnamed)";
  }
  return (item.name ?? "").trim() || "(Unnamed)";
}

function normalizePositiveNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

router.get("/", async (req, res) => {
  try {
    let query = supabase
      .from("recipe_summaries")
      .select("id, tenant_id, summary_name, source_item_id, created_by, created_at, updated_at")
      .order("created_at", { ascending: false });
    query = withTenantFilter(query, req);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const sourceItemIds = [...new Set((data ?? []).map((r) => r.source_item_id))];
    const itemNameMap = new Map<string, string | null>();
    if (sourceItemIds.length > 0) {
      const { data: itemRows, error: itemErr } = await supabase
        .from("items")
        .select("id, name")
        .in("id", sourceItemIds);
      if (itemErr) {
        return res.status(500).json({ error: itemErr.message });
      }
      for (const row of itemRows ?? []) {
        itemNameMap.set(row.id, row.name ?? null);
      }
    }

    const summaryIds = (data ?? []).map((r) => r.id);
    const targetMap = new Map<string, string[]>();
    if (summaryIds.length > 0) {
      const { data: targetRows, error: targetErr } = await supabase
        .from("recipe_summary_expand_targets")
        .select("summary_id, target_item_id")
        .in("summary_id", summaryIds);
      if (targetErr) {
        return res.status(500).json({ error: targetErr.message });
      }
      for (const row of targetRows ?? []) {
        const existing = targetMap.get(row.summary_id) ?? [];
        existing.push(row.target_item_id);
        targetMap.set(row.summary_id, existing);
      }
    }

    const rows = (data ?? []).map((row) => ({
      ...row,
      source_item_name: itemNameMap.get(row.source_item_id) ?? null,
      expand_target_item_ids: targetMap.get(row.id) ?? [],
    }));

    return res.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.post("/", async (req, res) => {
  try {
    const summaryName = String(req.body?.summary_name ?? "").trim();
    const sourceItemId = String(req.body?.source_item_id ?? "").trim();
    const expandTargetItemIdsRaw = Array.isArray(req.body?.expand_target_item_ids)
      ? req.body.expand_target_item_ids
      : [];
    const expandTargetItemIds = [...new Set(expandTargetItemIdsRaw.map((v: unknown) => String(v).trim()).filter(Boolean))];

    if (!summaryName) {
      return res.status(400).json({ error: "summary_name is required" });
    }
    if (!sourceItemId) {
      return res.status(400).json({ error: "source_item_id is required" });
    }

    const selectedTenantId = req.user?.selected_tenant_id || req.user?.tenant_ids?.[0];
    if (!selectedTenantId) {
      return res.status(400).json({ error: "No tenant associated" });
    }

    const roleInTenant = req.user?.roles?.get(selectedTenantId);
    const canUseCrossTenant = await isCompanyOfficerOnTenant(req.user!.id, selectedTenantId);

    const sourceQuery = supabase
      .from("items")
      .select("id, item_kind, tenant_id, responsible_user_id")
      .eq("id", sourceItemId)
      .maybeSingle();
    // source は cross-tenant item も選択候補になり得るため tenant filter は掛けない
    const { data: sourceItem, error: sourceErr } = await sourceQuery;
    if (sourceErr) {
      return res.status(500).json({ error: sourceErr.message });
    }
    if (!sourceItem) {
      return res.status(404).json({ error: "source_item_id not found in tenant scope" });
    }
    if (sourceItem.item_kind !== "prepped") {
      return res.status(400).json({ error: "source_item_id must be a prepped item" });
    }

    const allIds = [sourceItemId, ...expandTargetItemIds];
    const { data: allCandidateItems, error: allItemsErr } = await supabase
      .from("items")
      .select("id, tenant_id")
      .in("id", allIds);
    if (allItemsErr) {
      return res.status(500).json({ error: allItemsErr.message });
    }
    const crossTenantCandidateIds = (allCandidateItems ?? [])
      .filter((it) => it.tenant_id !== selectedTenantId)
      .map((it) => it.id);
    const sharedCrossTenantItemIds = new Set<string>();
    if (crossTenantCandidateIds.length > 0) {
      const { data: tenantCompany, error: tenantCompanyErr } = await supabase
        .from("company_tenants")
        .select("company_id")
        .eq("tenant_id", selectedTenantId)
        .maybeSingle();
      if (tenantCompanyErr || !tenantCompany?.company_id) {
        return res.status(400).json({ error: "No company linked to selected tenant" });
      }

      const { data: shareRows, error: shareErr } = await supabase
        .from("cross_tenant_item_shares")
        .select("item_id, target_type, target_id, allowed_actions")
        .eq("company_id", tenantCompany.company_id)
        .in("item_id", crossTenantCandidateIds);
      if (shareErr) {
        return res.status(500).json({ error: shareErr.message });
      }
      for (const row of shareRows ?? []) {
        const allowed = Array.isArray(row.allowed_actions) && row.allowed_actions.includes("read");
        if (!allowed) continue;
        const hitsCompany = row.target_type === "company" && row.target_id === tenantCompany.company_id;
        const hitsTenant = row.target_type === "tenant" && row.target_id === selectedTenantId;
        if (hitsCompany || hitsTenant) {
          sharedCrossTenantItemIds.add(row.item_id);
        }
      }
    }
    const { data: managerShares } = await supabase
      .from("resource_shares")
      .select("resource_id, allowed_actions, is_exclusion")
      .eq("resource_type", "item")
      .eq("target_type", "role")
      .eq("target_id", "manager")
      .in("resource_id", allIds);

    const managerShareTypeByItemId = new Map<string, "hide" | "view-only" | "editable">();
    for (const row of managerShares ?? []) {
      if (row.is_exclusion) continue;
      const actions = row.allowed_actions ?? [];
      if (actions.length === 0) {
        managerShareTypeByItemId.set(row.resource_id, "hide");
      } else if (actions.length === 1 && actions[0] === "read") {
        managerShareTypeByItemId.set(row.resource_id, "view-only");
      } else if (actions.includes("read") && actions.includes("update")) {
        managerShareTypeByItemId.set(row.resource_id, "editable");
      }
    }

    const sourceAccess = evaluateAccessControl(
      roleInTenant,
      req.user!.id,
      {
        id: sourceItem.id,
        tenant_id: sourceItem.tenant_id,
        responsible_user_id: sourceItem.responsible_user_id ?? null,
      },
      selectedTenantId,
      managerShareTypeByItemId,
      canUseCrossTenant,
      sharedCrossTenantItemIds,
    );
    if (!sourceAccess.allowed) {
      return res.status(403).json({
        error: "source_item_id is not allowed for current role",
        reason: sourceAccess.reason,
      });
    }

    if (expandTargetItemIds.length > 0) {
      const targetQuery = supabase
        .from("items")
        .select("id, item_kind, tenant_id, responsible_user_id")
        .in("id", expandTargetItemIds);
      // expand target も cross-tenant item が入り得るため tenant filter は掛けない
      const { data: targetItems, error: targetErr } = await targetQuery;
      if (targetErr) {
        return res.status(500).json({ error: targetErr.message });
      }
      const validIds = new Set<string>();
      const deniedIds: string[] = [];
      for (const t of targetItems ?? []) {
        if (t.item_kind !== "prepped") continue;
        const access = evaluateAccessControl(
          roleInTenant,
          req.user!.id,
          {
            id: t.id,
            tenant_id: t.tenant_id,
            responsible_user_id: t.responsible_user_id ?? null,
          },
          selectedTenantId,
          managerShareTypeByItemId,
          canUseCrossTenant,
          sharedCrossTenantItemIds,
        );
        if (access.allowed) {
          validIds.add(t.id);
        } else {
          deniedIds.push(t.id);
        }
      }
      const invalidIds = expandTargetItemIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          error: "expand_target_item_ids contains non-prepped or out-of-scope items",
          invalid_item_ids: invalidIds,
          denied_item_ids: deniedIds,
        });
      }
    }

    const now = new Date().toISOString();
    const insertPayload = {
      tenant_id: selectedTenantId,
      summary_name: summaryName,
      source_item_id: sourceItemId,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("recipe_summaries")
      .insert(insertPayload)
      .select("id, tenant_id, summary_name, source_item_id, created_by, created_at, updated_at")
      .single<RecipeSummaryRow>();
    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    if (expandTargetItemIds.length > 0) {
      const targets = expandTargetItemIds.map((targetItemId) => ({
        summary_id: inserted.id,
        target_item_id: targetItemId,
      }));
      const { error: targetInsertErr } = await supabase
        .from("recipe_summary_expand_targets")
        .insert(targets);
      if (targetInsertErr) {
        return res.status(500).json({ error: targetInsertErr.message });
      }
    }

    return res.status(201).json({
      ...inserted,
      source_item_name: null,
      expand_target_item_ids: expandTargetItemIds,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const summaryId = String(req.params.id ?? "").trim();
    if (!summaryId) {
      return res.status(400).json({ error: "id is required" });
    }

    let deleteQuery = supabase.from("recipe_summaries").delete().eq("id", summaryId);
    deleteQuery = withTenantFilter(deleteQuery, req);
    const { error } = await deleteQuery;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.get("/:id/technical-sheet", async (req, res) => {
  try {
    const summaryId = String(req.params.id ?? "").trim();
    if (!summaryId) {
      return res.status(400).json({ error: "id is required" });
    }

    const selectedTenantId = req.user?.selected_tenant_id || req.user?.tenant_ids?.[0];
    if (!selectedTenantId) {
      return res.status(400).json({ error: "No tenant associated" });
    }

    let summaryQuery = supabase
      .from("recipe_summaries")
      .select("id, tenant_id, summary_name, source_item_id")
      .eq("id", summaryId)
      .maybeSingle();
    summaryQuery = withTenantFilter(summaryQuery, req);

    const { data: summary, error: summaryErr } = await summaryQuery;
    if (summaryErr) {
      return res.status(500).json({ error: summaryErr.message });
    }
    if (!summary) {
      return res.status(404).json({ error: "recipe summary not found" });
    }

    const { data: targets, error: targetsErr } = await supabase
      .from("recipe_summary_expand_targets")
      .select("target_item_id")
      .eq("summary_id", summary.id);
    if (targetsErr) {
      return res.status(500).json({ error: targetsErr.message });
    }
    const expandSet = new Set((targets ?? []).map((t) => t.target_item_id));

    const itemMap = new Map<string, Item>();
    const baseItemMap = new Map<string, BaseItem>();
    const recipeLineMap = new Map<string, RecipeLine[]>();
    const ingredientRows = new Map<string, IngredientAccumulator>();
    const steps: TechnicalSheetStep[] = [];
    const itemCostPerGram = new Map<string, number>();

    const ensureItem = async (itemId: string): Promise<Item> => {
      const cached = itemMap.get(itemId);
      if (cached) return cached;

      const { data, error } = await supabase.from("items").select("*").eq("id", itemId).maybeSingle();
      if (error || !data) {
        throw new Error(`Item not found: ${itemId}`);
      }
      itemMap.set(itemId, data as Item);
      return data as Item;
    };

    const ensureBaseItem = async (baseItemId: string): Promise<BaseItem | null> => {
      const cached = baseItemMap.get(baseItemId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from("base_items")
        .select("*")
        .eq("id", baseItemId)
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      if (!data) return null;
      baseItemMap.set(baseItemId, data as BaseItem);
      return data as BaseItem;
    };

    const ensureRecipeLines = async (parentId: string): Promise<RecipeLine[]> => {
      const cached = recipeLineMap.get(parentId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("parent_item_id", parentId)
        .eq("line_type", "ingredient");
      if (error) throw new Error(error.message);
      const lines = (data ?? []) as RecipeLine[];
      recipeLineMap.set(parentId, lines);
      return lines;
    };

    const ensureCostPerGram = async (itemId: string, tenantId: string): Promise<number> => {
      const cached = itemCostPerGram.get(itemId);
      if (cached != null) return cached;
      try {
        const value = await calculateCost(itemId, [tenantId]);
        itemCostPerGram.set(itemId, value);
        return value;
      } catch {
        itemCostPerGram.set(itemId, 0);
        return 0;
      }
    };

    const sourceItem = await ensureItem(summary.source_item_id);
    const sourceBaseItem = sourceItem.base_item_id ? await ensureBaseItem(sourceItem.base_item_id) : null;
    const sourceName = toDisplayName(sourceItem, sourceBaseItem);

    const allVendorProductsById = new Map<string, VendorProduct>();
    const { data: allVps } = await supabase
      .from("virtual_vendor_products")
      .select("*")
      .in("tenant_id", req.user?.tenant_ids ?? []);
    for (const vp of allVps ?? []) {
      allVendorProductsById.set(vp.id, vp as VendorProduct);
    }

    const allMappingsByBaseItemId = new Map<string, string[]>();
    const { data: allMappings } = await supabase
      .from("product_mappings")
      .select("base_item_id, virtual_product_id")
      .in("tenant_id", req.user?.tenant_ids ?? []);
    for (const mapping of allMappings ?? []) {
      const existing = allMappingsByBaseItemId.get(mapping.base_item_id) ?? [];
      existing.push(mapping.virtual_product_id);
      allMappingsByBaseItemId.set(mapping.base_item_id, existing);
    }

    const createStep = (item: Item, name: string): string => {
      const key = nextStepKey(steps.length);
      steps.push({
        step_key: key,
        title: `${key}. ${name} (Prepped)`,
        item_id: item.id,
        procedure: item.procedure ?? null,
      });
      return key;
    };

    const collect = async (itemId: string, stepKey: string, path: Set<string>): Promise<void> => {
      if (path.has(itemId)) return;
      path.add(itemId);
      try {
        const lines = await ensureRecipeLines(itemId);
        for (const line of lines) {
          if (!line.child_item_id) continue;
          const qty = normalizePositiveNumber(line.quantity);
          if (!qty || !line.unit) continue;

          const child = await ensureItem(line.child_item_id);
          const childBaseItem = child.base_item_id ? await ensureBaseItem(child.base_item_id) : null;
          const nature = toDisplayName(child, childBaseItem);
          const isExpandedPrepped = child.item_kind === "prepped" && expandSet.has(child.id);

          let grams = 0;
          try {
            grams = convertToGrams(
              line.unit,
              qty,
              child.id,
              itemMap,
              baseItemMap,
            );
          } catch {
            grams = 0;
          }

          // Nature rows should contain "terminal nodes" at this summary expansion level:
          // - raw/base nodes
          // - unexpanded prepped nodes
          // Expanded prepped nodes are shown in Procedure steps and replaced by their descendants in the table.
          if (!isExpandedPrepped) {
            const existing = ingredientRows.get(child.id) ?? {
              item_id: child.id,
              nature,
              vendor_item: child.item_kind === "prepped" ? "Prepped Item" : "Lowest",
              unit: "g",
              step_quantities: {},
              total: 0,
              pu: 0,
              pt: 0,
            };

            if (child.item_kind === "raw" && line.specific_child && line.specific_child !== "lowest") {
              const selectedVp = allVendorProductsById.get(line.specific_child);
              existing.vendor_item = selectedVp?.product_name?.trim() || selectedVp?.brand_name?.trim() || "Selected";
            } else if (child.item_kind === "raw" && child.base_item_id) {
              const mappedVpIds = allMappingsByBaseItemId.get(child.base_item_id) ?? [];
              const activeCandidates = mappedVpIds
                .map((vpId) => allVendorProductsById.get(vpId))
                .filter((vp): vp is VendorProduct => !!vp && !vp.deprecated);
              if (activeCandidates.length > 0) {
                const firstNamed = activeCandidates.find((vp) => (vp.product_name ?? "").trim().length > 0);
                existing.vendor_item = firstNamed?.product_name?.trim() || "Lowest";
              }
            }

            existing.step_quantities[stepKey] = (existing.step_quantities[stepKey] ?? 0) + grams;
            existing.total += grams;
            ingredientRows.set(child.id, existing);
          }

          if (isExpandedPrepped) {
            const childStepKey = createStep(child, nature);
            await collect(child.id, childStepKey, path);
          }
        }
      } finally {
        path.delete(itemId);
      }
    };

    const rootStepKey = createStep(sourceItem, sourceName);
    await collect(sourceItem.id, rootStepKey, new Set<string>());

    const rowList = Array.from(ingredientRows.values());
    for (const row of rowList) {
      const rowItem = itemMap.get(row.item_id);
      if (!rowItem) continue;
      const costPerGram = await ensureCostPerGram(row.item_id, rowItem.tenant_id);
      row.pu = costPerGram;
      row.pt = row.total * costPerGram;
    }
    const totalIngredientCost = rowList.reduce((sum, row) => sum + row.pt, 0);

    return res.json({
      summary_id: summary.id,
      summary_name: summary.summary_name,
      product: {
        item_id: sourceItem.id,
        name: sourceName,
        description: sourceItem.description ?? null,
      },
      steps,
      ingredient_rows: rowList.map((row) => ({
        item_id: row.item_id,
        nature: row.nature,
        vendor_item: row.vendor_item,
        unit: row.unit,
        step_quantities: row.step_quantities,
        total: row.total,
        pu: row.pu,
        pt: row.pt,
      })),
      total_ingredient_cost: totalIngredientCost,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
