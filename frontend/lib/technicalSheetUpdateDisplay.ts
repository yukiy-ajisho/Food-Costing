import type {
  BaseItem,
  Item,
  StandardRecipeDiff,
  StandardSheetApplyMode,
  Vendor,
} from "@/lib/api";
import { childIdFromRowKey, snapshotRowKey } from "@/lib/technicalSheetRowKey";
import {
  puPerGramForRawVendorChoice,
  type VendorProductWithBase,
} from "@/lib/vendorProductPicker";

export type PuChoice = "sheet" | "live";

export type UpdateRowChoices = {
  vendor: PuChoice;
  total: PuChoice;
};

export type UpdateDiffType =
  | "added"
  | "removed"
  | "changed"
  | "unchanged"
  | "vendor_swap";

export type UpdateRowMeta = {
  row_key: string;
  child_item_id: string;
  diffType: UpdateDiffType;
  sheetGrams: number | null;
  liveGrams: number | null;
  sheetQuantity: number | null;
  sheetUnit: string | null;
  liveQuantity: number | null;
  liveUnit: string | null;
  sheetVendorLabel: string | null;
  liveVendorLabel: string | null;
  sheetSpecificChild: string | null;
  liveSpecificChild: string | null;
};

export type VendorSwapPair = {
  child_item_id: string;
  removedKey: string;
  addedKey: string;
};

export type UpdateDisplayPlan = {
  displayKeys: string[];
  vendorSwaps: Map<string, VendorSwapPair>;
  pairedRowKeys: Set<string>;
};

export function vendorSwapDisplayKey(childItemId: string): string {
  return `swap:${childItemId}`;
}

export function detectVendorSwapPairs(
  diff: StandardRecipeDiff,
): Map<string, VendorSwapPair> {
  const removedByChild = new Map<string, string[]>();
  const addedByChild = new Map<string, string[]>();

  for (const line of diff.lines) {
    if (line.type === "removed") {
      const list = removedByChild.get(line.child_item_id) ?? [];
      list.push(line.row_key);
      removedByChild.set(line.child_item_id, list);
    } else if (line.type === "added") {
      const list = addedByChild.get(line.child_item_id) ?? [];
      list.push(line.row_key);
      addedByChild.set(line.child_item_id, list);
    }
  }

  const pairs = new Map<string, VendorSwapPair>();
  for (const [childId, removedKeys] of removedByChild) {
    const addedKeys = addedByChild.get(childId) ?? [];
    if (removedKeys.length === 1 && addedKeys.length === 1) {
      pairs.set(childId, {
        child_item_id: childId,
        removedKey: removedKeys[0]!,
        addedKey: addedKeys[0]!,
      });
    }
  }
  return pairs;
}

export function buildUpdateDisplayPlan(
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string> = new Set(),
): UpdateDisplayPlan {
  const vendorSwaps = detectVendorSwapPairs(diff);
  const pairedRowKeys = new Set<string>();
  for (const pair of vendorSwaps.values()) {
    pairedRowKeys.add(pair.removedKey);
    pairedRowKeys.add(pair.addedKey);
  }

  const allKeys = new Set([
    ...diff.saved.map((l) => l.row_key),
    ...diff.live.map((l) => l.row_key),
  ]);
  const savedByKey = new Map(diff.saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(diff.live.map((l) => [l.row_key, l]));

  const displayKeys: string[] = [];
  const swapChildInserted = new Set<string>();

  const sorted = [...allKeys].sort((a, b) => {
    const nameA = savedByKey.get(a)?.name ?? liveByKey.get(a)?.name ?? a;
    const nameB = savedByKey.get(b)?.name ?? liveByKey.get(b)?.name ?? b;
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });

  for (const rowKey of sorted) {
    if (pairedRowKeys.has(rowKey)) {
      const childId = childIdFromRowKey(rowKey);
      const pair = vendorSwaps.get(childId);
      if (
        pair &&
        pair.removedKey === rowKey &&
        restoredRemovedKeys.has(rowKey)
      ) {
        displayKeys.push(rowKey);
        continue;
      }
      if (pair && !swapChildInserted.has(childId)) {
        swapChildInserted.add(childId);
        displayKeys.push(vendorSwapDisplayKey(childId));
      }
      continue;
    }
    displayKeys.push(rowKey);
  }

  return { displayKeys, vendorSwaps, pairedRowKeys };
}

export function buildUpdateMetaByRowKey(
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string> = new Set(),
): Map<string, UpdateRowMeta> {
  const plan = buildUpdateDisplayPlan(diff, restoredRemovedKeys);
  const diffByKey = new Map(diff.lines.map((l) => [l.row_key, l]));
  const savedByKey = new Map(diff.saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(diff.live.map((l) => [l.row_key, l]));
  const meta = new Map<string, UpdateRowMeta>();

  const allKeys = new Set([
    ...diff.saved.map((l) => l.row_key),
    ...diff.live.map((l) => l.row_key),
  ]);

  for (const rowKey of allKeys) {
    const diffLine = diffByKey.get(rowKey);
    const savedLine = savedByKey.get(rowKey);
    const liveLine = liveByKey.get(rowKey);
    const childId =
      savedLine?.child_item_id ??
      liveLine?.child_item_id ??
      childIdFromRowKey(rowKey);

    let diffType: UpdateDiffType = diffLine?.type ?? "unchanged";
    if (diffType === "removed" && restoredRemovedKeys.has(rowKey)) {
      diffType = "unchanged";
    }

    meta.set(rowKey, {
      row_key: rowKey,
      child_item_id: childId,
      diffType,
      sheetGrams: diffLine?.saved_grams ?? savedLine?.grams ?? null,
      liveGrams: diffLine?.live_grams ?? liveLine?.grams ?? null,
      sheetQuantity: diffLine?.saved_quantity ?? savedLine?.quantity ?? null,
      sheetUnit: diffLine?.saved_unit ?? savedLine?.unit ?? null,
      liveQuantity: diffLine?.live_quantity ?? liveLine?.quantity ?? null,
      liveUnit: diffLine?.live_unit ?? liveLine?.unit ?? null,
      sheetVendorLabel:
        diffLine?.saved_vendor_label ?? savedLine?.vendor_label ?? null,
      liveVendorLabel:
        diffLine?.live_vendor_label ?? liveLine?.vendor_label ?? null,
      sheetSpecificChild:
        diffLine?.saved_specific_child ?? savedLine?.specific_child ?? null,
      liveSpecificChild:
        diffLine?.live_specific_child ?? liveLine?.specific_child ?? null,
    });
  }

  for (const pair of plan.vendorSwaps.values()) {
    if (restoredRemovedKeys.has(pair.removedKey)) continue;
    meta.set(
      vendorSwapDisplayKey(pair.child_item_id),
      buildVendorSwapMeta(pair, meta, savedByKey, liveByKey),
    );
  }

  return meta;
}

export function defaultUpdateRowChoices(
  diff: StandardRecipeDiff,
  plan: UpdateDisplayPlan,
): Map<string, UpdateRowChoices> {
  const choices = new Map<string, UpdateRowChoices>();
  for (const key of plan.displayKeys) {
    choices.set(key, { vendor: "live", total: "live" });
  }
  for (const line of diff.lines) {
    if (line.type === "removed" && !plan.pairedRowKeys.has(line.row_key)) {
      choices.set(line.row_key, { vendor: "sheet", total: "sheet" });
    }
  }
  return choices;
}

/** Removed (pending Restore) rows: Override only — recipe has no line to overwrite. */
export function defaultIngredientApplyModes(
  diff: StandardRecipeDiff,
  plan: UpdateDisplayPlan,
): Map<string, StandardSheetApplyMode> {
  const modes = new Map<string, StandardSheetApplyMode>();
  for (const key of plan.displayKeys) {
    modes.set(key, "overwrite");
  }
  for (const line of diff.lines) {
    if (line.type === "removed" && !plan.pairedRowKeys.has(line.row_key)) {
      modes.set(line.row_key, "override");
    }
  }
  return modes;
}

export function mergedVersionAmountDisplay(
  meta: UpdateRowMeta,
  diffType: UpdateDiffType,
): string {
  if (diffType === "added") {
    return formatUpdateAmount(
      meta.liveQuantity,
      meta.liveUnit,
      meta.liveGrams,
    );
  }
  if (diffType === "removed") {
    return formatUpdateAmount(
      meta.sheetQuantity,
      meta.sheetUnit,
      meta.sheetGrams,
    );
  }
  return formatUpdateAmount(
    meta.sheetQuantity,
    meta.sheetUnit,
    meta.sheetGrams,
  );
}

function formatUpdateAmount(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  gramsFallback?: number | null,
): string {
  if (
    quantity != null &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    unit?.trim()
  ) {
    const u = unit.trim() || "g";
    const displayQty =
      u === "each"
        ? quantity
        : Number.isInteger(quantity)
          ? quantity
          : Number(quantity.toFixed(2));
    return `${displayQty} ${u}`;
  }
  if (gramsFallback != null && gramsFallback > 0) {
    const displayQty = Number.isInteger(gramsFallback)
      ? gramsFallback
      : Number(gramsFallback.toFixed(2));
    return `${displayQty} g`;
  }
  return "—";
}

export function buildVendorSwapMeta(
  pair: VendorSwapPair,
  metaByKey: Map<string, UpdateRowMeta>,
  savedByKey: Map<string, StandardRecipeDiff["saved"][number]>,
  liveByKey: Map<string, StandardRecipeDiff["live"][number]>,
): UpdateRowMeta {
  const removed = metaByKey.get(pair.removedKey);
  const added = metaByKey.get(pair.addedKey);
  const savedRemoved = savedByKey.get(pair.removedKey);
  const liveAdded = liveByKey.get(pair.addedKey);
  return {
    row_key: vendorSwapDisplayKey(pair.child_item_id),
    child_item_id: pair.child_item_id,
    diffType: "vendor_swap",
    sheetGrams: removed?.sheetGrams ?? null,
    liveGrams: added?.liveGrams ?? null,
    sheetQuantity: removed?.sheetQuantity ?? null,
    sheetUnit: removed?.sheetUnit ?? null,
    liveQuantity: added?.liveQuantity ?? null,
    liveUnit: added?.liveUnit ?? null,
    sheetVendorLabel: removed?.sheetVendorLabel ?? savedRemoved?.vendor_label ?? null,
    liveVendorLabel: added?.liveVendorLabel ?? liveAdded?.vendor_label ?? null,
    sheetSpecificChild: removed?.sheetSpecificChild ?? null,
    liveSpecificChild: added?.liveSpecificChild ?? null,
  };
}

export function resolveSnapshotKeysForChoice(
  displayKey: string,
  vendorSwaps: Map<string, VendorSwapPair>,
): { sheetKey: string; liveKey: string } {
  if (displayKey.startsWith("swap:")) {
    const childId = displayKey.slice(5);
    const pair = vendorSwaps.get(childId);
    if (pair) {
      return { sheetKey: pair.removedKey, liveKey: pair.addedKey };
    }
  }
  return { sheetKey: displayKey, liveKey: displayKey };
}

export function gramsEqualForMeta(meta: UpdateRowMeta): boolean {
  const s = meta.sheetGrams ?? 0;
  const l = meta.liveGrams ?? 0;
  return Math.abs(s - l) <= 0.001;
}

export function showTotalVersionSplit(diffType: UpdateDiffType, meta: UpdateRowMeta): boolean {
  if (diffType === "changed" || diffType === "vendor_swap") {
    return !gramsEqualForMeta(meta);
  }
  return false;
}

export function showVendorVersionSplit(diffType: UpdateDiffType): boolean {
  return diffType === "vendor_swap";
}

export function showChoiceRadios(diffType: UpdateDiffType, meta: UpdateRowMeta): boolean {
  return showTotalVersionSplit(diffType, meta) || showVendorVersionSplit(diffType);
}

export type EditFieldRadioResolve = {
  showRadios: boolean;
  displayChoice: PuChoice;
};

function normalizeSpecificChild(value: string | null | undefined): string {
  if (!value || value === "lowest") return "lowest";
  return value;
}

function gramsMatch(
  a: number | null | undefined,
  b: number | null | undefined,
): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= 0.001;
}

export function vendorMatchesSheet(
  meta: UpdateRowMeta,
  specificChild: string | null | undefined,
): boolean {
  return (
    normalizeSpecificChild(specificChild) ===
    normalizeSpecificChild(meta.sheetSpecificChild)
  );
}

export function vendorMatchesLive(
  meta: UpdateRowMeta,
  specificChild: string | null | undefined,
): boolean {
  return (
    normalizeSpecificChild(specificChild) ===
    normalizeSpecificChild(meta.liveSpecificChild)
  );
}

export function totalMatchesSheet(
  meta: UpdateRowMeta,
  totalGrams: number,
): boolean {
  return gramsMatch(totalGrams, meta.sheetGrams);
}

export function totalMatchesLive(
  meta: UpdateRowMeta,
  totalGrams: number,
): boolean {
  return gramsMatch(totalGrams, meta.liveGrams);
}

/** True when New recipe column values differ from both Current version and Recipe database. */
export function ingredientNewRecipeDiffersFromVersions(
  meta: UpdateRowMeta,
  row: { specific_child?: string | null; total: number },
  item: Pick<Item, "item_kind" | "is_menu_item"> | null | undefined,
): boolean {
  if (item?.item_kind === "raw" && !item.is_menu_item) {
    if (!vendorMatchesSheet(meta, row.specific_child)) return true;
    if (!vendorMatchesLive(meta, row.specific_child)) return true;
  }
  if (!totalMatchesSheet(meta, row.total)) return true;
  if (!totalMatchesLive(meta, row.total)) return true;
  return false;
}

export function isIngredientApplyChoiceNeeded(
  diffType: UpdateDiffType | undefined,
  meta: UpdateRowMeta | undefined,
  row: { specific_child?: string | null; total: number },
  item: Pick<Item, "item_kind" | "is_menu_item"> | null | undefined,
  opts?: { isManualNewRow?: boolean; isPendingNew?: boolean },
): boolean {
  if (opts?.isManualNewRow || opts?.isPendingNew || meta == null) return true;
  if (diffType !== "unchanged") return true;
  return ingredientNewRecipeDiffersFromVersions(meta, row, item);
}

export function resolveIngredientApplyMode(
  rowKey: string,
  choiceNeeded: boolean,
  modes: Map<string, StandardSheetApplyMode> | undefined,
): StandardSheetApplyMode {
  if (!choiceNeeded) return "override";
  return modes?.get(rowKey) ?? "overwrite";
}

function resolveEditFieldRadios(
  matchesSheet: boolean,
  matchesLive: boolean,
  stored: PuChoice | undefined,
  diffType: UpdateDiffType,
): EditFieldRadioResolve {
  const fallback = effectivePuChoice(diffType, stored);
  if (matchesSheet && !matchesLive) {
    return { showRadios: true, displayChoice: "sheet" };
  }
  if (matchesLive && !matchesSheet) {
    return { showRadios: true, displayChoice: "live" };
  }
  if (matchesSheet && matchesLive) {
    return { showRadios: true, displayChoice: fallback };
  }
  return { showRadios: false, displayChoice: fallback };
}

export function resolveEditVendorRadios(
  meta: UpdateRowMeta,
  diffType: UpdateDiffType,
  specificChild: string | null | undefined,
  stored?: PuChoice,
): EditFieldRadioResolve {
  return resolveEditFieldRadios(
    vendorMatchesSheet(meta, specificChild),
    vendorMatchesLive(meta, specificChild),
    stored,
    diffType,
  );
}

export function resolveEditTotalRadios(
  meta: UpdateRowMeta,
  diffType: UpdateDiffType,
  totalGrams: number,
  stored?: PuChoice,
): EditFieldRadioResolve {
  return resolveEditFieldRadios(
    totalMatchesSheet(meta, totalGrams),
    totalMatchesLive(meta, totalGrams),
    stored,
    diffType,
  );
}

export function effectivePuChoice(
  diffType: UpdateDiffType,
  stored: PuChoice | undefined,
): PuChoice {
  if (diffType === "added") return "live";
  if (diffType === "removed") return "sheet";
  return stored ?? "live";
}

export function finalGramsForChoice(
  meta: UpdateRowMeta,
  choice: PuChoice,
): number | null {
  return choice === "live" ? meta.liveGrams : meta.sheetGrams;
}

export function rowKeyForIngredientRow(
  row: { item_id: string; specific_child?: string | null },
  itemById: Map<string, Item>,
): string {
  const item = itemById.get(row.item_id);
  return snapshotRowKey(
    row.item_id,
    row.specific_child ?? null,
    item?.item_kind === "prepped",
  );
}

export function puFromSheetRows(
  sheetRows: Array<{ item_id: string; specific_child?: string | null; pu: number | null }>,
  snapshotKey: string,
  itemById: Map<string, Item>,
): number | null {
  const match = sheetRows.find(
    (r) => rowKeyForIngredientRow(r, itemById) === snapshotKey,
  );
  return match?.pu ?? null;
}

export function resolvePuForUpdateRow(
  item: Item | undefined,
  specificChild: string | null | undefined,
  sheetRows: Array<{ item_id: string; specific_child?: string | null; pu: number | null }>,
  snapshotKey: string,
  itemById: Map<string, Item>,
  pickerItems: Item[],
  vendorProducts: VendorProductWithBase[],
  vendors: Vendor[],
  baseItems: BaseItem[],
): number | null {
  if (item?.item_kind === "raw" && !item.is_menu_item) {
    const computed = puPerGramForRawVendorChoice(
      item,
      specificChild,
      pickerItems,
      vendorProducts,
      vendors,
      baseItems,
    );
    if (computed != null) return computed;
  }
  return puFromSheetRows(sheetRows, snapshotKey, itemById);
}
