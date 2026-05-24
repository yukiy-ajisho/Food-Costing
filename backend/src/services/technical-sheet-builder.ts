import { supabase } from "../config/supabase";
import { convertToGrams } from "./units";
import {
  getBaseItemsMap,
  getCost,
  getItemsMap,
  getLaborRolesMap,
  getVendorProductsMap,
} from "./cost";
import type {
  BaseItem,
  Item,
  LaborRole,
  RecipeLine,
  VendorProduct,
} from "../types/database";

export type TechnicalSheetStep = {
  step_key: string;
  title: string;
  item_id: string;
  procedure: string | null;
};

export type TechnicalSheetIngredientRow = {
  item_id: string;
  nature: string;
  vendor_item: string;
  /** Recipe-line quantity in `unit` (costing display). */
  quantity: number;
  unit: string;
  specific_child: string | null;
  step_quantities: Record<string, number>;
  /** Grams (for PU/PT and recipe sync). */
  total: number;
  pu: number | null;
  pt: number | null;
};

export type TechnicalSheetLaborRow = {
  row_key: string;
  labor_role: string;
  minutes: number;
  hourly_wage: number | null;
  cost: number | null;
};

export type TechnicalSheetPayload = {
  product: {
    item_id: string;
    name: string;
    description: string | null;
  };
  steps: TechnicalSheetStep[];
  ingredient_rows: TechnicalSheetIngredientRow[];
  total_ingredient_cost: number | null;
  labor_rows: TechnicalSheetLaborRow[];
  total_labor_cost: number | null;
};

export type IngredientSnapshotLine = {
  line_type?: "ingredient";
  child_item_id: string;
  quantity: number;
  unit: string;
  grams: number;
  specific_child: string | null;
};

export type LaborSnapshotLine = {
  line_type: "labor";
  row_key: string;
  labor_role: string;
  minutes: number;
};

export type RecipeSnapshotLine = IngredientSnapshotLine | LaborSnapshotLine;

export function isLaborSnapshotLine(
  line: RecipeSnapshotLine,
): line is LaborSnapshotLine {
  return line.line_type === "labor";
}

export function isIngredientSnapshotLine(
  line: RecipeSnapshotLine,
): line is IngredientSnapshotLine {
  return line.line_type !== "labor";
}

export type StandardSnapshot = {
  schema_version: 1;
  source_item_id: string;
  standard_display_depth: 2;
  sheet: {
    steps: TechnicalSheetStep[];
    ingredient_rows: TechnicalSheetIngredientRow[];
    total_ingredient_cost: number | null;
    labor_rows?: TechnicalSheetLaborRow[];
    total_labor_cost?: number | null;
  };
  recipe_snapshot: {
    lines: RecipeSnapshotLine[];
  };
  cost_inputs: {
    by_item_id: Record<
      string,
      {
        pu_per_gram: number | null;
        vvp_id: string | null;
      }
    >;
    by_labor_role?: Record<
      string,
      {
        hourly_wage: number | null;
      }
    >;
    captured_at: string;
  };
  /** @deprecated Legacy snapshots only; use row columns description/procedure. */
  display_meta?: {
    description: string | null;
    procedures: Record<string, string | null>;
  };
};

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

function toDisplayName(
  item: Pick<Item, "item_kind" | "name" | "base_item_id">,
  baseItem?: BaseItem | null,
): string {
  if (item.item_kind === "raw") {
    return (baseItem?.name ?? item.name ?? "").trim() || "(Unnamed)";
  }
  return (item.name ?? "").trim() || "(Unnamed)";
}

function normalizePositiveNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

async function fetchLaborRolesMap(
  tenantIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (tenantIds.length === 0) return map;
  const { data, error } = await supabase
    .from("labor_roles")
    .select("name, hourly_wage")
    .in("tenant_id", tenantIds);
  if (error) throw new Error(error.message);
  for (const role of data ?? []) {
    const name = (role.name ?? "").trim();
    const wage = Number(role.hourly_wage);
    if (name && Number.isFinite(wage) && wage > 0) {
      map.set(name, wage);
    }
  }
  return map;
}

export function laborCostFromWage(
  hourlyWage: number | null | undefined,
  minutes: number,
): number | null {
  if (hourlyWage == null || !Number.isFinite(hourlyWage) || hourlyWage <= 0) {
    return null;
  }
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return (hourlyWage / 60) * minutes;
}

export async function buildLaborRowsForSource(
  sourceItemId: string,
  tenantIds: string[],
): Promise<{ rows: TechnicalSheetLaborRow[]; total: number | null }> {
  const { data: lines, error } = await supabase
    .from("recipe_lines")
    .select("id, labor_role, minutes")
    .eq("parent_item_id", sourceItemId)
    .eq("line_type", "labor");
  if (error) throw new Error(error.message);

  const wageMap = await fetchLaborRolesMap(tenantIds);
  const rows: TechnicalSheetLaborRow[] = [];
  let total = 0;
  let hasUnpriced = false;

  for (const line of (lines ?? []) as RecipeLine[]) {
    const role = (line.labor_role ?? "").trim();
    const minutes = normalizePositiveNumber(line.minutes);
    if (!role || minutes <= 0) continue;
    const hourly_wage = wageMap.get(role) ?? null;
    const cost = laborCostFromWage(hourly_wage, minutes);
    if (cost == null) hasUnpriced = true;
    else total += cost;
    rows.push({
      row_key: line.id,
      labor_role: role,
      minutes,
      hourly_wage,
      cost,
    });
  }

  rows.sort(
    (a, b) =>
      a.labor_role.localeCompare(b.labor_role) ||
      a.row_key.localeCompare(b.row_key),
  );
  return {
    rows,
    total: hasUnpriced && total === 0 ? null : total,
  };
}

export async function buildLaborSnapshotLines(
  sourceItemId: string,
): Promise<LaborSnapshotLine[]> {
  const { data, error } = await supabase
    .from("recipe_lines")
    .select("id, labor_role, minutes")
    .eq("parent_item_id", sourceItemId)
    .eq("line_type", "labor");
  if (error) throw new Error(error.message);

  const lines: LaborSnapshotLine[] = [];
  for (const line of (data ?? []) as RecipeLine[]) {
    const role = (line.labor_role ?? "").trim();
    const minutes = normalizePositiveNumber(line.minutes);
    if (!role || minutes <= 0) continue;
    lines.push({
      line_type: "labor",
      row_key: line.id,
      labor_role: role,
      minutes,
    });
  }
  lines.sort(
    (a, b) =>
      a.labor_role.localeCompare(b.labor_role) ||
      a.row_key.localeCompare(b.row_key),
  );
  return lines;
}

type IngredientAccumulator = {
  item_id: string;
  nature: string;
  vendor_item: string;
  quantity: number;
  unit: string;
  specific_child: string | null;
  step_quantities: Record<string, number>;
  total: number;
  pu: number | null;
  pt: number | null;
};

export type BuildTechnicalSheetOptions = {
  sourceItemId: string;
  tenantIds: string[];
  expandItemIds?: Set<string>;
};

function vendorChoiceForCost(
  item: Item,
  specificChild: string | null | undefined,
): string | "lowest" | null {
  if (item.item_kind === "raw" && !item.is_menu_item) {
    if (!specificChild || specificChild === "lowest") return "lowest";
    return specificChild;
  }
  return null;
}

function costCacheKey(
  itemId: string,
  vendorChoice: string | "lowest" | null,
): string {
  return vendorChoice != null ? `${itemId}|${vendorChoice}` : itemId;
}

async function puPerGramForIngredientRow(
  row: Pick<TechnicalSheetIngredientRow, "item_id" | "specific_child">,
  item: Item,
  tenantIds: string[],
  itemMap: Map<string, Item>,
  baseItemMap: Map<string, BaseItem>,
  vendorProductsMap: Map<string, VendorProduct>,
  laborRoles: Map<string, LaborRole>,
  cache: Map<string, number | null>,
): Promise<number | null> {
  const vendorChoice = vendorChoiceForCost(item, row.specific_child);
  const key = costCacheKey(row.item_id, vendorChoice);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const value = await getCost(
      row.item_id,
      tenantIds,
      new Set(),
      baseItemMap,
      itemMap,
      vendorProductsMap,
      laborRoles,
      vendorChoice,
    );
    const pu = Number.isFinite(value) && value > 0 ? value : null;
    cache.set(key, pu);
    return pu;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export async function buildTechnicalSheet(
  options: BuildTechnicalSheetOptions,
): Promise<TechnicalSheetPayload> {
  const { sourceItemId, tenantIds, expandItemIds = new Set<string>() } = options;

  const itemMap = new Map<string, Item>();
  const baseItemMap = new Map<string, BaseItem>();
  const recipeLineMap = new Map<string, RecipeLine[]>();
  const ingredientRows = new Map<string, IngredientAccumulator>();
  const steps: TechnicalSheetStep[] = [];

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
    if (error) throw new Error(error.message);
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

  const sourceItem = await ensureItem(sourceItemId);
  if (sourceItem.item_kind !== "prepped") {
    throw new Error("source_item_id must be a prepped item");
  }
  const sourceBaseItem = sourceItem.base_item_id
    ? await ensureBaseItem(sourceItem.base_item_id)
    : null;
  const sourceName = toDisplayName(sourceItem, sourceBaseItem);

  const allVendorProductsById = new Map<string, VendorProduct>();
  const { data: allVps } = await supabase
    .from("virtual_vendor_products")
    .select("*")
    .in("tenant_id", tenantIds);
  for (const vp of allVps ?? []) {
    allVendorProductsById.set(vp.id, vp as VendorProduct);
  }

  const allMappingsByBaseItemId = new Map<string, string[]>();
  const { data: allMappings } = await supabase
    .from("product_mappings")
    .select("base_item_id, virtual_product_id")
    .in("tenant_id", tenantIds);
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
        const isExpandedPrepped = child.item_kind === "prepped" && expandItemIds.has(child.id);

        let grams = 0;
        try {
          grams = convertToGrams(line.unit, qty, child.id, itemMap, baseItemMap);
        } catch {
          grams = 0;
        }

        if (!isExpandedPrepped) {
          const existing = ingredientRows.get(child.id) ?? {
            item_id: child.id,
            nature,
            vendor_item: "-",
            quantity: qty,
            unit: line.unit,
            specific_child: line.specific_child ?? null,
            step_quantities: {},
            total: 0,
            pu: null,
            pt: null,
          };

          if (child.item_kind === "raw") {
            existing.specific_child = line.specific_child ?? null;
          }
          existing.vendor_item = vendorSelectionLabel(
            existing.specific_child,
            child,
            allVendorProductsById,
          );

          if (ingredientRows.has(child.id)) {
            if (existing.unit === line.unit) {
              existing.quantity += qty;
            } else {
              existing.quantity = existing.total + grams;
              existing.unit = "g";
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
  const laborRoles = await getLaborRolesMap(tenantIds);
  const puCache = new Map<string, number | null>();
  let totalIngredientCost: number | null = 0;
  for (const row of rowList) {
    const rowItem = itemMap.get(row.item_id);
    if (!rowItem) continue;
    const costPerGram = await puPerGramForIngredientRow(
      row,
      rowItem,
      tenantIds,
      itemMap,
      baseItemMap,
      allVendorProductsById,
      laborRoles,
      puCache,
    );
    row.pu = costPerGram;
    if (costPerGram == null || row.total <= 0) {
      row.pt = null;
      totalIngredientCost = null;
    } else {
      row.pt = row.total * costPerGram;
      if (totalIngredientCost != null) {
        totalIngredientCost += row.pt;
      }
    }
  }

  const laborBundle = await buildLaborRowsForSource(sourceItemId, tenantIds);
  return {
    product: {
      item_id: sourceItem.id,
      name: sourceName,
      description: sourceItem.description ?? null,
    },
    steps,
    ingredient_rows: rowList,
    total_ingredient_cost: totalIngredientCost,
    labor_rows: laborBundle.rows,
    total_labor_cost: laborBundle.total,
  };
}

export async function buildRecipeSnapshotLines(
  sourceItemId: string,
  _tenantIds: string[],
): Promise<IngredientSnapshotLine[]> {
  const itemMap = new Map<string, Item>();
  const baseItemMap = new Map<string, BaseItem>();

  const ensureItem = async (itemId: string): Promise<Item> => {
    const cached = itemMap.get(itemId);
    if (cached) return cached;
    const { data, error } = await supabase.from("items").select("*").eq("id", itemId).maybeSingle();
    if (error || !data) throw new Error(`Item not found: ${itemId}`);
    itemMap.set(itemId, data as Item);
    return data as Item;
  };

  const ensureBaseItem = async (baseItemId: string): Promise<BaseItem | null> => {
    const cached = baseItemMap.get(baseItemId);
    if (cached) return cached;
    const { data } = await supabase.from("base_items").select("*").eq("id", baseItemId).maybeSingle();
    if (!data) return null;
    baseItemMap.set(baseItemId, data as BaseItem);
    return data as BaseItem;
  };

  const { data, error } = await supabase
    .from("recipe_lines")
    .select("*")
    .eq("parent_item_id", sourceItemId)
    .eq("line_type", "ingredient");
  if (error) throw new Error(error.message);

  const lines: IngredientSnapshotLine[] = [];
  for (const line of (data ?? []) as RecipeLine[]) {
    if (!line.child_item_id) continue;
    const qty = normalizePositiveNumber(line.quantity);
    if (!qty || !line.unit) continue;
    const child = await ensureItem(line.child_item_id);
    await ensureBaseItem(child.base_item_id ?? "");
    let grams = 0;
    try {
      grams = convertToGrams(line.unit, qty, child.id, itemMap, baseItemMap);
    } catch {
      grams = 0;
    }
    lines.push({
      line_type: "ingredient",
      child_item_id: line.child_item_id,
      quantity: qty,
      unit: line.unit,
      grams,
      specific_child: line.specific_child ?? null,
    });
  }
  lines.sort((a, b) => a.child_item_id.localeCompare(b.child_item_id));
  return lines;
}

export function normalizeSpecificChild(
  specific: string | null | undefined,
): string {
  if (!specific || specific === "lowest") return "lowest";
  return specific;
}

type IndexedSnapshotLine = {
  child_item_id: string;
  grams: number;
  quantity: number;
  unit: string;
  specific_child: string | null;
};

function snapshotLineKey(
  childId: string,
  specific: string | null,
  isPrepped: boolean,
): string {
  if (isPrepped) return childId;
  return `${childId}|${normalizeSpecificChild(specific)}`;
}

function indexSnapshotLines(
  lines: IngredientSnapshotLine[],
  childMeta: Map<string, ChildItemMeta>,
): Map<string, IndexedSnapshotLine> {
  const map = new Map<string, IndexedSnapshotLine>();
  for (const line of lines) {
    const meta = childMeta.get(line.child_item_id) ?? defaultChildMeta();
    const isPrepped = meta.item_kind === "prepped";
    const key = snapshotLineKey(line.child_item_id, line.specific_child, isPrepped);
    const existing = map.get(key);
    if (existing) {
      existing.grams += line.grams;
      if (existing.unit === line.unit) {
        existing.quantity += line.quantity;
      } else {
        existing.quantity = existing.grams;
        existing.unit = "g";
      }
    } else {
      map.set(key, {
        child_item_id: line.child_item_id,
        grams: line.grams,
        quantity: line.quantity,
        unit: line.unit,
        specific_child: line.specific_child ?? null,
      });
    }
  }
  return map;
}

export type ChildItemMeta = {
  item_kind: Item["item_kind"];
  is_menu_item: boolean;
};

export function vendorSelectionLabel(
  specific: string | null,
  child: Pick<Item, "item_kind" | "is_menu_item">,
  vpById: Map<string, VendorProduct>,
): string {
  if (child.item_kind === "prepped" || child.is_menu_item) return "-";
  const norm = normalizeSpecificChild(specific);
  if (norm === "lowest") return "Lowest";
  const vp = vpById.get(norm);
  if (!vp) return "Selected";
  return (vp.product_name ?? "").trim() || (vp.brand_name ?? "").trim() || "Selected";
}

async function childMetaForChildIds(
  childIds: string[],
): Promise<Map<string, ChildItemMeta>> {
  const metaById = new Map<string, ChildItemMeta>();
  if (childIds.length === 0) return metaById;
  const { data: items } = await supabase
    .from("items")
    .select("id, item_kind, is_menu_item")
    .in("id", childIds);
  for (const item of items ?? []) {
    metaById.set(item.id, {
      item_kind: item.item_kind as Item["item_kind"],
      is_menu_item: !!item.is_menu_item,
    });
  }
  return metaById;
}

function defaultChildMeta(): ChildItemMeta {
  return { item_kind: "raw", is_menu_item: false };
}

export async function compareIngredientSnapshotsAsync(
  saved: IngredientSnapshotLine[],
  live: IngredientSnapshotLine[],
): Promise<boolean> {
  const childIds = [
    ...new Set([
      ...saved.map((l) => l.child_item_id),
      ...live.map((l) => l.child_item_id),
    ]),
  ];
  const childMeta = await childMetaForChildIds(childIds);
  const savedIdx = indexSnapshotLines(saved, childMeta);
  const liveIdx = indexSnapshotLines(live, childMeta);
  const keys = new Set([...savedIdx.keys(), ...liveIdx.keys()]);
  for (const key of keys) {
    const s = savedIdx.get(key);
    const l = liveIdx.get(key);
    if (!s && l && l.grams > 0.001) return true;
    if (s && !l && s.grams > 0.001) return true;
    if (s && l && Math.abs(s.grams - l.grams) > 0.001) return true;
  }
  return false;
}

export function compareLaborSnapshots(
  saved: LaborSnapshotLine[],
  live: LaborSnapshotLine[],
): boolean {
  const savedByKey = new Map(saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(live.map((l) => [l.row_key, l]));
  const keys = new Set([...savedByKey.keys(), ...liveByKey.keys()]);
  for (const key of keys) {
    const s = savedByKey.get(key);
    const l = liveByKey.get(key);
    if (!s && l) return true;
    if (s && !l) return true;
    if (
      s &&
      l &&
      (s.labor_role !== l.labor_role ||
        Math.abs(s.minutes - l.minutes) > 0.001)
    ) {
      return true;
    }
  }
  return false;
}

export async function compareRecipeSnapshotsAsync(
  saved: RecipeSnapshotLine[],
  live: RecipeSnapshotLine[],
): Promise<boolean> {
  const savedIngredients = saved.filter(isIngredientSnapshotLine);
  const liveIngredients = live.filter(isIngredientSnapshotLine);
  if (await compareIngredientSnapshotsAsync(savedIngredients, liveIngredients)) {
    return true;
  }
  return compareLaborSnapshots(
    saved.filter(isLaborSnapshotLine),
    live.filter(isLaborSnapshotLine),
  );
}

/** @deprecated Use compareRecipeSnapshotsAsync — sync helper assumes prepped keys by child id only. */
export function compareRecipeSnapshots(
  saved: RecipeSnapshotLine[],
  live: RecipeSnapshotLine[],
): boolean {
  const savedIngredients = saved.filter(isIngredientSnapshotLine);
  const liveIngredients = live.filter(isIngredientSnapshotLine);
  const childIds = [
    ...new Set([
      ...savedIngredients.map((l) => l.child_item_id),
      ...liveIngredients.map((l) => l.child_item_id),
    ]),
  ];
  const childMeta = new Map<string, ChildItemMeta>();
  for (const id of childIds) {
    childMeta.set(id, defaultChildMeta());
  }
  const savedIdx = indexSnapshotLines(savedIngredients, childMeta);
  const liveIdx = indexSnapshotLines(liveIngredients, childMeta);
  const keys = new Set([...savedIdx.keys(), ...liveIdx.keys()]);
  for (const key of keys) {
    const s = savedIdx.get(key);
    const l = liveIdx.get(key);
    if (!s && l && l.grams > 0.001) return true;
    if (s && !l && s.grams > 0.001) return true;
    if (s && l && Math.abs(s.grams - l.grams) > 0.001) return true;
  }
  return false;
}

export type RecipeDiffLine = {
  type: "added" | "removed" | "changed";
  row_key: string;
  child_item_id: string;
  name: string;
  saved_grams: number | null;
  live_grams: number | null;
  saved_quantity: number | null;
  live_quantity: number | null;
  saved_unit: string | null;
  live_unit: string | null;
  saved_specific_child: string | null;
  live_specific_child: string | null;
  saved_vendor_label: string | null;
  live_vendor_label: string | null;
};

export async function buildRecipeDiffLines(
  saved: RecipeSnapshotLine[],
  live: RecipeSnapshotLine[],
): Promise<RecipeDiffLine[]> {
  const savedIngredients = saved.filter(isIngredientSnapshotLine);
  const liveIngredients = live.filter(isIngredientSnapshotLine);
  const childIds = [
    ...new Set([
      ...savedIngredients.map((l) => l.child_item_id),
      ...liveIngredients.map((l) => l.child_item_id),
    ]),
  ];

  const itemNames = new Map<string, string>();
  const childMeta = await childMetaForChildIds(childIds);
  if (childIds.length > 0) {
    const { data: items } = await supabase
      .from("items")
      .select("id, name, item_kind, base_item_id, is_menu_item")
      .in("id", childIds);
    const baseIds = new Set(
      (items ?? []).map((i) => i.base_item_id).filter((id): id is string => !!id),
    );
    const baseNameMap = new Map<string, string>();
    if (baseIds.size > 0) {
      const { data: bases } = await supabase
        .from("base_items")
        .select("id, name")
        .in("id", [...baseIds]);
      for (const b of bases ?? []) {
        baseNameMap.set(b.id, (b.name ?? "").trim() || "(Unnamed)");
      }
    }
    for (const item of items ?? []) {
      childMeta.set(item.id, {
        item_kind: item.item_kind as Item["item_kind"],
        is_menu_item: !!item.is_menu_item,
      });
      const name =
        item.item_kind === "raw" && item.base_item_id
          ? baseNameMap.get(item.base_item_id) ?? (item.name ?? "").trim()
          : (item.name ?? "").trim();
      itemNames.set(item.id, name || "(Unnamed)");
    }
  }

  const vpById = new Map<string, VendorProduct>();
  const { data: vps } = await supabase.from("virtual_vendor_products").select("*");
  for (const vp of vps ?? []) {
    vpById.set(vp.id, vp as VendorProduct);
  }

  const savedIdx = indexSnapshotLines(savedIngredients, childMeta);
  const liveIdx = indexSnapshotLines(liveIngredients, childMeta);
  const keys = [...new Set([...savedIdx.keys(), ...liveIdx.keys()])].sort((a, b) => {
    const childA = a.split("|")[0];
    const childB = b.split("|")[0];
    const nameA = itemNames.get(childA) ?? childA;
    const nameB = itemNames.get(childB) ?? childB;
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });

  const result: RecipeDiffLine[] = [];
  for (const key of keys) {
    const s = savedIdx.get(key);
    const l = liveIdx.get(key);
    const childId = s?.child_item_id ?? l!.child_item_id;
    const meta = childMeta.get(childId) ?? defaultChildMeta();
    const hasSaved = s != null && s.grams > 0.001;
    const hasLive = l != null && l.grams > 0.001;

    let type: RecipeDiffLine["type"];
    if (hasSaved && !hasLive) type = "removed";
    else if (!hasSaved && hasLive) type = "added";
    else if (
      hasSaved &&
      hasLive &&
      Math.abs(s.grams - l.grams) > 0.001
    ) {
      type = "changed";
    } else {
      continue;
    }

    result.push({
      type,
      row_key: key,
      child_item_id: childId,
      name: itemNames.get(childId) ?? childId,
      saved_grams: hasSaved ? s.grams : null,
      live_grams: hasLive ? l.grams : null,
      saved_quantity: hasSaved ? s.quantity : null,
      live_quantity: hasLive ? l.quantity : null,
      saved_unit: hasSaved ? s.unit : null,
      live_unit: hasLive ? l.unit : null,
      saved_specific_child: hasSaved ? s.specific_child : null,
      live_specific_child: hasLive ? l.specific_child : null,
      saved_vendor_label: hasSaved
        ? vendorSelectionLabel(s.specific_child, meta, vpById)
        : null,
      live_vendor_label: hasLive
        ? vendorSelectionLabel(l.specific_child, meta, vpById)
        : null,
    });
  }
  return result;
}

export type LaborDiffLine = {
  type: "added" | "removed" | "changed";
  row_key: string;
  saved_labor_role: string | null;
  live_labor_role: string | null;
  saved_minutes: number | null;
  live_minutes: number | null;
};

export type LaborSnapshotDisplayLine = {
  row_key: string;
  labor_role: string;
  minutes: number;
};

export function laborSnapshotLinesToDisplay(
  lines: LaborSnapshotLine[],
): LaborSnapshotDisplayLine[] {
  return lines.map((line) => ({
    row_key: line.row_key,
    labor_role: line.labor_role,
    minutes: line.minutes,
  }));
}

export function buildLaborDiffLines(
  saved: LaborSnapshotLine[],
  live: LaborSnapshotLine[],
): LaborDiffLine[] {
  const savedByKey = new Map(saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(live.map((l) => [l.row_key, l]));
  const keys = [...new Set([...savedByKey.keys(), ...liveByKey.keys()])].sort(
    (a, b) => {
      const roleA =
        savedByKey.get(a)?.labor_role ?? liveByKey.get(a)?.labor_role ?? a;
      const roleB =
        savedByKey.get(b)?.labor_role ?? liveByKey.get(b)?.labor_role ?? b;
      const byRole = roleA.localeCompare(roleB);
      if (byRole !== 0) return byRole;
      return a.localeCompare(b);
    },
  );

  const result: LaborDiffLine[] = [];
  for (const key of keys) {
    const s = savedByKey.get(key);
    const l = liveByKey.get(key);
    if (!s && l) {
      result.push({
        type: "added",
        row_key: key,
        saved_labor_role: null,
        live_labor_role: l.labor_role,
        saved_minutes: null,
        live_minutes: l.minutes,
      });
    } else if (s && !l) {
      result.push({
        type: "removed",
        row_key: key,
        saved_labor_role: s.labor_role,
        live_labor_role: null,
        saved_minutes: s.minutes,
        live_minutes: null,
      });
    } else if (
      s &&
      l &&
      (s.labor_role !== l.labor_role ||
        Math.abs(s.minutes - l.minutes) > 0.001)
    ) {
      result.push({
        type: "changed",
        row_key: key,
        saved_labor_role: s.labor_role,
        live_labor_role: l.labor_role,
        saved_minutes: s.minutes,
        live_minutes: l.minutes,
      });
    }
  }
  return result;
}

export async function applyLatestPricesToSheet(
  sheet: StandardSnapshot["sheet"],
  tenantIds: string[],
): Promise<{
  ingredient_rows: TechnicalSheetIngredientRow[];
  total_ingredient_cost: number | null;
  labor_rows: TechnicalSheetLaborRow[];
  total_labor_cost: number | null;
  has_unpriced_lines: boolean;
}> {
  const rows = sheet.ingredient_rows.map((row) => ({
    ...row,
    step_quantities: { ...row.step_quantities },
  }));
  let total = 0;
  let hasUnpriced = false;

  const [baseItemsMap, itemsMap, vendorProductsMap, laborRoles] =
    await Promise.all([
      getBaseItemsMap(tenantIds),
      getItemsMap(tenantIds),
      getVendorProductsMap(tenantIds),
      getLaborRolesMap(tenantIds),
    ]);
  const puCache = new Map<string, number | null>();

  for (const row of rows) {
    const item = itemsMap.get(row.item_id);
    if (!item) {
      row.pu = null;
      row.pt = null;
      hasUnpriced = true;
      continue;
    }
    const pu = await puPerGramForIngredientRow(
      row,
      item,
      tenantIds,
      itemsMap,
      baseItemsMap,
      vendorProductsMap,
      laborRoles,
      puCache,
    );
    row.pu = pu;
    if (pu == null || row.total <= 0) {
      row.pt = null;
      hasUnpriced = true;
    } else {
      row.pt = row.total * pu;
      total += row.pt;
    }
  }

  const laborRows = (sheet.labor_rows ?? []).map((row) => ({ ...row }));
  const wageMap = await fetchLaborRolesMap(tenantIds);
  let laborTotal = 0;
  let laborUnpriced = false;
  for (const row of laborRows) {
    const hourly_wage = wageMap.get(row.labor_role) ?? null;
    row.hourly_wage = hourly_wage;
    const cost = laborCostFromWage(hourly_wage, row.minutes);
    row.cost = cost;
    if (cost == null) laborUnpriced = true;
    else laborTotal += cost;
  }

  return {
    ingredient_rows: rows,
    total_ingredient_cost: hasUnpriced && total === 0 ? null : total,
    labor_rows: laborRows,
    total_labor_cost: laborUnpriced && laborTotal === 0 ? null : laborTotal,
    has_unpriced_lines: hasUnpriced || laborUnpriced,
  };
}

export type RecipeSnapshotDisplayLine = {
  row_key: string;
  child_item_id: string;
  name: string;
  grams: number;
  quantity: number;
  unit: string;
  specific_child: string | null;
  vendor_label: string;
};

export async function recipeSnapshotLinesToDisplay(
  lines: RecipeSnapshotLine[],
): Promise<RecipeSnapshotDisplayLine[]> {
  const ingredientLines = lines.filter(isIngredientSnapshotLine);
  const childIds = [...new Set(ingredientLines.map((l) => l.child_item_id))];
  const itemNames = new Map<string, string>();
  const childMeta = await childMetaForChildIds(childIds);

  if (childIds.length > 0) {
    const { data: items } = await supabase
      .from("items")
      .select("id, name, item_kind, base_item_id, is_menu_item")
      .in("id", childIds);
    const baseIds = new Set(
      (items ?? []).map((i) => i.base_item_id).filter((id): id is string => !!id),
    );
    const baseNameMap = new Map<string, string>();
    if (baseIds.size > 0) {
      const { data: bases } = await supabase
        .from("base_items")
        .select("id, name")
        .in("id", [...baseIds]);
      for (const b of bases ?? []) {
        baseNameMap.set(b.id, (b.name ?? "").trim() || "(Unnamed)");
      }
    }
    for (const item of items ?? []) {
      childMeta.set(item.id, {
        item_kind: item.item_kind as Item["item_kind"],
        is_menu_item: !!item.is_menu_item,
      });
      const name =
        item.item_kind === "raw" && item.base_item_id
          ? baseNameMap.get(item.base_item_id) ?? (item.name ?? "").trim()
          : (item.name ?? "").trim();
      itemNames.set(item.id, name || "(Unnamed)");
    }
  }

  const vpById = new Map<string, VendorProduct>();
  const { data: vps } = await supabase.from("virtual_vendor_products").select("*");
  for (const vp of vps ?? []) {
    vpById.set(vp.id, vp as VendorProduct);
  }

  const indexed = indexSnapshotLines(ingredientLines, childMeta);
  return [...indexed.entries()]
    .sort(([keyA], [keyB]) => {
      const childA = keyA.split("|")[0];
      const childB = keyB.split("|")[0];
      const nameA = itemNames.get(childA) ?? childA;
      const nameB = itemNames.get(childB) ?? childB;
      const byName = nameA.localeCompare(nameB);
      if (byName !== 0) return byName;
      return keyA.localeCompare(keyB);
    })
    .map(([rowKey, row]) => {
      const meta = childMeta.get(row.child_item_id) ?? defaultChildMeta();
      return {
        row_key: rowKey,
        child_item_id: row.child_item_id,
        name: itemNames.get(row.child_item_id) ?? row.child_item_id,
        grams: row.grams,
        quantity: row.quantity,
        unit: row.unit,
        specific_child: row.specific_child,
        vendor_label: vendorSelectionLabel(
          row.specific_child,
          meta,
          vpById,
        ),
      };
    });
}

export async function buildStandardSnapshot(
  options: BuildTechnicalSheetOptions,
): Promise<StandardSnapshot> {
  const sheet = await buildTechnicalSheet(options);
  const [ingredientLines, laborLines] = await Promise.all([
    buildRecipeSnapshotLines(options.sourceItemId, options.tenantIds),
    buildLaborSnapshotLines(options.sourceItemId),
  ]);
  const capturedAt = new Date().toISOString();
  const byItemId: StandardSnapshot["cost_inputs"]["by_item_id"] = {};
  for (const row of sheet.ingredient_rows) {
    byItemId[row.item_id] = {
      pu_per_gram: row.pu,
      vvp_id:
        row.specific_child && row.specific_child !== "lowest"
          ? row.specific_child
          : null,
    };
  }
  const byLaborRole: NonNullable<
    StandardSnapshot["cost_inputs"]["by_labor_role"]
  > = {};
  for (const row of sheet.labor_rows) {
    byLaborRole[row.labor_role] = { hourly_wage: row.hourly_wage };
  }
  return {
    schema_version: 1,
    source_item_id: options.sourceItemId,
    standard_display_depth: 2,
    sheet: {
      steps: sheet.steps.map((step) => ({ ...step, procedure: null })),
      ingredient_rows: sheet.ingredient_rows,
      total_ingredient_cost: sheet.total_ingredient_cost,
      labor_rows: sheet.labor_rows,
      total_labor_cost: sheet.total_labor_cost,
    },
    recipe_snapshot: { lines: [...ingredientLines, ...laborLines] },
    cost_inputs: {
      by_item_id: byItemId,
      by_labor_role: byLaborRole,
      captured_at: capturedAt,
    },
  };
}
