"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CornerUpLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useTenant } from "@/contexts/TenantContext";
import {
  StandardTechnicalSheetLaborTable,
  type LaborDraftRow,
} from "@/components/StandardTechnicalSheetLaborTable";
import {
  baseItemsAPI,
  costAPI,
  crossTenantItemSharesAPI,
  getItemDisplayName,
  itemsAPI,
  laborRolesAPI,
  productMappingsAPI,
  vendorProductsAPI,
  vendorsAPI,
  type BaseItem,
  type Item,
  type LaborRole,
  type RecipeSummaryTechnicalSheet,
  type RecipeSummaryTechnicalSheetIngredientRow,
  type RecipeSummaryTechnicalSheetLaborRow,
  standardTechnicalSheetsAPI,
  type StandardSheetApplyMode,
  type StandardSheetSaveMode,
  type StandardRecipeDiff,
  type StandardRecipeSnapshotDisplayLine,
  type StandardTechnicalSheetDetail,
  type StandardTechnicalSheetPriceMode,
  type StandardTechnicalSheetVersionMeta,
  type Vendor,
} from "@/lib/api";
import {
  convertIngredientToGrams,
  getAvailableUnitsForItem,
  ensureUnitInList,
} from "@/lib/ingredientUnits";
import {
  buildIngredientItemSelectOptions,
  crossTenantEntryToItem,
  crossTenantOwnerTenants,
  deriveIngredientPickerType,
  type CrossTenantPickerEntry,
  type IngredientPickerType,
} from "@/lib/ingredientItemPicker";
import {
  childIdFromRowKey,
  snapshotRowKey,
} from "@/lib/technicalSheetRowKey";
import {
  buildUpdateDisplayPlan,
  buildUpdateMetaByRowKey,
  defaultIngredientApplyModes,
  defaultUpdateRowChoices,
  effectivePuChoice,
  finalGramsForChoice,
  isIngredientApplyChoiceNeeded,
  resolveEditTotalRadios,
  resolveEditVendorRadios,
  resolveIngredientApplyMode,
  resolvePuForUpdateRow,
  resolveSnapshotKeysForChoice,
  showTotalVersionSplit,
  showVendorVersionSplit,
  type PuChoice,
  type UpdateDiffType,
  type UpdateRowChoices,
  type UpdateRowMeta,
} from "@/lib/technicalSheetUpdateDisplay";
import {
  enrichVendorProductsWithBase,
  getAvailableVendorProducts,
  puPerGramForRawVendorChoice,
  vendorProductSelectOptionLabel,
  type VendorProductWithBase,
} from "@/lib/vendorProductPicker";
import {
  vendorSelectionDisplay,
  vendorSelectionLabelFromEdit,
} from "@/lib/vendorSelectionDisplay";
import {
  buildLaborUpdateDisplayPlan,
  buildLaborUpdateMetaByRowKey,
  defaultLaborApplyModes,
  defaultLaborUpdateRowChoices,
  laborRoleForDisplay,
  effectiveLaborChoice,
  isLaborApplyChoiceNeeded,
  laborCostFromWage,
  resolveEditMinutesRadios,
  resolveLaborApplyMode,
  resolveLaborSnapshotKeysForChoice,
  type LaborUpdateRowChoices,
  type LaborUpdateRowMeta,
} from "@/lib/technicalSheetLaborUpdateDisplay";
import {
  formatDualPtDollars,
  formatDualPuPerKg,
  formatDualTotalCostLines,
  formatPtDollars,
  formatPuPerKg,
} from "@/lib/technicalSheetFormat";

type StandardTechnicalSheetViewProps = {
  isDark: boolean;
  sourceItemId: string;
  baseRecipeName: string;
  onClose: () => void;
};

type SheetData = Omit<
  RecipeSummaryTechnicalSheet,
  "summary_id" | "summary_name"
>;
type ViewMode = "sheet" | "editUpdate";
type DraftRow = RecipeSummaryTechnicalSheetIngredientRow & {
  row_key: string;
  puLoading?: boolean;
  isNew?: boolean;
  pickerType?: IngredientPickerType;
  crossTenantOwnerFilter?: string;
};

function ptFromRow(grams: number, pu: number | null): number | null {
  if (pu == null || !Number.isFinite(pu) || grams <= 0) return null;
  return grams * pu;
}

function puCacheKey(itemId: string, specificChild?: string | null): string {
  const sc =
    !specificChild || specificChild === "lowest" ? "lowest" : specificChild;
  return `${itemId}:${sc}`;
}

function diffTypeForRowKey(
  diff: StandardRecipeDiff,
  rowKey: string,
): UpdateDiffType {
  return (
    (diff.lines.find((l) => l.row_key === rowKey)?.type as
      | UpdateDiffType
      | undefined) ?? "unchanged"
  );
}

function rowKeyForIngredientRow(
  row: RecipeSummaryTechnicalSheetIngredientRow,
  itemById: Map<string, Item>,
): string {
  const item = itemById.get(row.item_id);
  return snapshotRowKey(
    row.item_id,
    row.specific_child ?? null,
    item?.item_kind === "prepped",
  );
}

function displayLineToDraftRow(
  line: StandardRecipeSnapshotDisplayLine,
  sheetRow: RecipeSummaryTechnicalSheetIngredientRow | undefined,
  liveRow: RecipeSummaryTechnicalSheetIngredientRow | undefined,
): DraftRow {
  const base = sheetRow ?? liveRow;
  return {
    row_key: line.row_key,
    item_id: line.child_item_id,
    nature: line.name,
    vendor_item: line.vendor_label,
    quantity: line.quantity,
    unit: line.unit,
    specific_child: line.specific_child,
    step_quantities: base
      ? { ...base.step_quantities }
      : { A: line.grams },
    total: line.grams,
    pu: liveRow?.pu ?? sheetRow?.pu ?? null,
    pt: null,
  };
}

function technicalSheetTableHeaderClass(isDark: boolean): string {
  return isDark ? "bg-slate-950 text-slate-200" : "bg-gray-300 text-gray-900";
}

function technicalSheetTableBodyRowClass(isDark: boolean): string {
  return isDark ? "bg-slate-900 text-slate-200" : "bg-white text-gray-900";
}

function technicalSheetPanelBackgroundClass(isDark: boolean): string {
  return isDark ? "bg-slate-800" : "bg-gray-50";
}

function technicalSheetActionColumnCellClass(isDark: boolean): string {
  return `w-8 border-0 p-0 pl-1 align-middle text-center ${technicalSheetPanelBackgroundClass(isDark)}`;
}

function technicalSheetTripleCellTdClass(rowBgClass: string): string {
  return `border p-0 h-px ${rowBgClass}`;
}

function updateRowClass(diffType: UpdateDiffType, isDark: boolean): string {
  if (diffType === "added") return isDark ? "bg-green-950/40" : "bg-green-50";
  if (diffType === "removed") return isDark ? "bg-red-950/40" : "bg-red-50";
  if (diffType === "changed" || diffType === "vendor_swap") {
    return isDark ? "bg-amber-950/40" : "bg-amber-50";
  }
  return technicalSheetTableBodyRowClass(isDark);
}

function updateRowClassForDisplay(
  diffType: UpdateDiffType,
  isDark: boolean,
  rowKey: string,
  restoredRemovedKeys?: ReadonlySet<string>,
): string {
  if (
    diffType === "removed" &&
    restoredRemovedKeys &&
    !restoredRemovedKeys.has(rowKey)
  ) {
    return isDark ? "bg-red-950/40" : "bg-red-50";
  }
  return updateRowClass(
    diffType === "removed" ? "unchanged" : diffType,
    isDark,
  );
}

function isRemovedRowPendingRestore(
  diffType: UpdateDiffType | undefined,
  rowKey: string,
  restoredRemovedKeys?: ReadonlySet<string>,
): boolean {
  return (
    diffType === "removed" &&
    !!restoredRemovedKeys &&
    !restoredRemovedKeys.has(rowKey)
  );
}

/** Restored removed row + trash: recipe has no line — same Apply lock as pre-Restore. */
function isRemovedRestoredPendingTrash(
  rowKey: string,
  isPendingTrash: boolean,
  restoredRemovedKeys?: ReadonlySet<string>,
): boolean {
  return (
    isPendingTrash &&
    !!restoredRemovedKeys &&
    restoredRemovedKeys.has(rowKey)
  );
}

function isIngredientApplyModeLocked(
  diffType: UpdateDiffType | undefined,
  rowKey: string,
  isPendingTrash: boolean,
  restoredRemovedKeys?: ReadonlySet<string>,
): boolean {
  return (
    isRemovedRowPendingRestore(diffType, rowKey, restoredRemovedKeys) ||
    isRemovedRestoredPendingTrash(rowKey, isPendingTrash, restoredRemovedKeys)
  );
}

function rowQuantity(row: RecipeSummaryTechnicalSheetIngredientRow): number {
  if (
    row.quantity != null &&
    Number.isFinite(row.quantity) &&
    row.quantity > 0
  ) {
    return row.quantity;
  }
  if (row.total > 0 && (row.unit === "g" || !row.unit)) return row.total;
  return row.total > 0 ? row.total : 0;
}

function formatQuantityUnit(quantity: number, unit: string): string {
  const u = unit.trim() || "g";
  const displayQty =
    u === "each"
      ? quantity
      : Number.isInteger(quantity)
        ? quantity
        : Number(quantity.toFixed(2));
  return `${displayQty} ${u}`;
}

function formatRowAmount(row: RecipeSummaryTechnicalSheetIngredientRow): string {
  const q = rowQuantity(row);
  if (q <= 0) return "—";
  return formatQuantityUnit(q, row.unit);
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
    return formatQuantityUnit(quantity, unit);
  }
  if (gramsFallback != null && gramsFallback > 0) {
    return formatQuantityUnit(gramsFallback, "g");
  }
  return "—";
}

function formatUpdateVendorLabel(
  label: string | null | undefined,
  diffType: UpdateDiffType | undefined,
  column: "sheet" | "live",
  fallback: string,
  isManualNewRow = false,
): string {
  if (isManualNewRow) return "—";
  if (column === "sheet" && diffType === "added") return "—";
  if (column === "live" && diffType === "removed") return "—";
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  // Recipe database: never fall back to draft/sheet values when live has no vendor
  if (column === "live") return "—";
  return fallback;
}

function migrateRowKeyInSet(
  keys: Set<string>,
  oldKey: string,
  newKey: string,
): Set<string> {
  if (oldKey === newKey || !keys.has(oldKey)) return keys;
  const next = new Set(keys);
  next.delete(oldKey);
  next.add(newKey);
  return next;
}

function migrateRowKeyInApplyModes(
  modes: Map<string, StandardSheetApplyMode>,
  oldKey: string,
  newKey: string,
): Map<string, StandardSheetApplyMode> {
  if (oldKey === newKey || !modes.has(oldKey)) return modes;
  const next = new Map(modes);
  const mode = next.get(oldKey)!;
  next.delete(oldKey);
  next.set(newKey, mode);
  return next;
}

function buildUpdateDisplayRows(
  sheet: SheetData,
  liveSheet: SheetData,
  diff: StandardRecipeDiff,
  updateMetaByRowKey: Map<string, UpdateRowMeta>,
  updateRowChoices: Map<string, UpdateRowChoices>,
  restoredRemovedKeys: ReadonlySet<string>,
  itemById: Map<string, Item>,
  pickerItems: Item[],
  vendorProducts: VendorProductWithBase[],
  vendors: Vendor[],
  baseItems: BaseItem[],
): DraftRow[] {
  const plan = buildUpdateDisplayPlan(diff, restoredRemovedKeys);
  const savedByKey = new Map(diff.saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(diff.live.map((l) => [l.row_key, l]));

  return plan.displayKeys.map((displayKey) => {
    const meta = updateMetaByRowKey.get(displayKey)!;
    const stored = updateRowChoices.get(displayKey);
    const vendorChoice = effectivePuChoice(meta.diffType, stored?.vendor);
    const totalChoice = effectivePuChoice(meta.diffType, stored?.total);
    const { sheetKey, liveKey } = resolveSnapshotKeysForChoice(
      displayKey,
      plan.vendorSwaps,
    );
    const savedLine = savedByKey.get(sheetKey);
    const liveLine = liveByKey.get(liveKey);
    const childId = meta.child_item_id;
    const totalLine = totalChoice === "live" ? liveLine : savedLine;

    const base = displayLineToDraftRow(
      totalLine ??
        savedLine ??
        liveLine ?? {
          row_key: displayKey,
          child_item_id: childId,
          name: childId,
          grams: finalGramsForChoice(meta, totalChoice) ?? 0,
          quantity: 0,
          unit: "g",
          specific_child: null,
          vendor_label: "—",
        },
      undefined,
      undefined,
    );

    const total = finalGramsForChoice(meta, totalChoice) ?? 0;
    const qty =
      totalChoice === "live"
        ? (meta.liveQuantity ?? rowQuantity(base))
        : (meta.sheetQuantity ?? rowQuantity(base));
    const unit =
      (totalChoice === "live" ? meta.liveUnit : meta.sheetUnit) ??
      base.unit ??
      "g";
    const specific =
      vendorChoice === "live"
        ? meta.liveSpecificChild
        : meta.sheetSpecificChild;
    const vendorLabel =
      vendorChoice === "live"
        ? meta.liveVendorLabel
        : meta.sheetVendorLabel;
    const chosenSpecific =
      vendorChoice === "live"
        ? meta.liveSpecificChild
        : meta.sheetSpecificChild;
    const puSourceRows =
      vendorChoice === "live"
        ? liveSheet.ingredient_rows
        : sheet.ingredient_rows;
    const puSnapshotKey = vendorChoice === "live" ? liveKey : sheetKey;
    const item = itemById.get(childId);
    const pu = resolvePuForUpdateRow(
      item,
      chosenSpecific,
      puSourceRows,
      puSnapshotKey,
      itemById,
      pickerItems,
      vendorProducts,
      vendors,
      baseItems,
    );

    return {
      ...base,
      row_key: displayKey,
      item_id: childId,
      nature: savedLine?.name ?? liveLine?.name ?? base.nature,
      quantity: qty,
      unit,
      specific_child: specific,
      vendor_item: vendorLabel ?? base.vendor_item,
      total,
      pu,
      pt: ptFromRow(total, pu),
    };
  });
}

function buildEditRowsFromChoices(
  sheet: SheetData,
  liveSheet: SheetData,
  choices: Map<string, UpdateRowChoices>,
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string>,
  itemById: Map<string, Item>,
  pickerItems: Item[],
  vendorProducts: VendorProductWithBase[],
  vendors: Vendor[],
  baseItems: BaseItem[],
): DraftRow[] {
  return buildUpdateDisplayRows(
    sheet,
    liveSheet,
    diff,
    buildUpdateMetaByRowKey(diff, restoredRemovedKeys),
    choices,
    restoredRemovedKeys,
    itemById,
    pickerItems,
    vendorProducts,
    vendors,
    baseItems,
  );
}

function buildUpdateDisplayLaborRows(
  sheet: SheetData,
  liveSheet: SheetData,
  diff: StandardRecipeDiff,
  laborUpdateMetaByRowKey: Map<string, LaborUpdateRowMeta>,
  laborUpdateRowChoices: Map<string, LaborUpdateRowChoices>,
  restoredRemovedLaborKeys: ReadonlySet<string>,
  laborRoles: LaborRole[],
): LaborDraftRow[] {
  const plan = buildLaborUpdateDisplayPlan(diff, restoredRemovedLaborKeys);
  const roleSwaps = plan.roleSwaps;
  const wageByRole = new Map(laborRoles.map((r) => [r.name, r.hourly_wage]));
  const sheetLaborByKey = new Map(
    (sheet.labor_rows ?? []).map((l) => [l.row_key, l]),
  );
  const liveLaborByKey = new Map(
    (liveSheet.labor_rows ?? []).map((l) => [l.row_key, l]),
  );

  return plan.displayKeys.map((displayKey) => {
    const meta = laborUpdateMetaByRowKey.get(displayKey)!;
    const stored = laborUpdateRowChoices.get(displayKey);
    const minutesChoice = effectiveLaborChoice(meta.diffType, stored?.minutes);
    const { sheetKey, liveKey } = resolveLaborSnapshotKeysForChoice(
      displayKey,
      roleSwaps,
    );

    const roleName = laborRoleForDisplay(meta);
    const minutes =
      (minutesChoice === "live" ? meta.liveMinutes : meta.sheetMinutes) ?? 0;

    const wageSourceRow =
      meta.diffType === "removed"
        ? sheetLaborByKey.get(sheetKey)
        : liveLaborByKey.get(liveKey);
    const hourly_wage =
      wageByRole.get(roleName) ?? wageSourceRow?.hourly_wage ?? null;
    const cost = laborCostFromWage(hourly_wage, minutes);
    return {
      row_key: displayKey,
      labor_role: roleName,
      minutes,
      hourly_wage,
      cost,
    };
  });
}

function buildEditLaborRowsFromChoices(
  sheet: SheetData,
  liveSheet: SheetData,
  choices: Map<string, LaborUpdateRowChoices>,
  diff: StandardRecipeDiff,
  restoredRemovedLaborKeys: ReadonlySet<string>,
  laborRoles: LaborRole[],
): LaborDraftRow[] {
  return buildUpdateDisplayLaborRows(
    sheet,
    liveSheet,
    diff,
    buildLaborUpdateMetaByRowKey(diff, restoredRemovedLaborKeys),
    choices,
    restoredRemovedLaborKeys,
    laborRoles,
  );
}

function recomputeLaborTotals(
  rows: LaborDraftRow[],
  laborRoles: LaborRole[],
): { total: number | null; hasUnpriced: boolean } {
  const wageByRole = new Map(laborRoles.map((r) => [r.name, r.hourly_wage]));
  let total = 0;
  let hasUnpriced = false;
  for (const row of rows) {
    const wage = wageByRole.get(row.labor_role) ?? row.hourly_wage;
    row.hourly_wage = wage ?? null;
    const cost = laborCostFromWage(row.hourly_wage, row.minutes);
    row.cost = cost;
    if (cost == null) hasUnpriced = true;
    else total += cost;
  }
  return { total: hasUnpriced && total === 0 ? null : total, hasUnpriced };
}

function cloneLaborRows(
  rows: RecipeSummaryTechnicalSheetLaborRow[],
): LaborDraftRow[] {
  return rows.map((r) => ({ ...r }));
}

function defaultApplyModes(
  keys: Iterable<string>,
): Map<string, StandardSheetApplyMode> {
  const m = new Map<string, StandardSheetApplyMode>();
  for (const key of keys) {
    m.set(key, "overwrite");
  }
  return m;
}

function clearUpdateSession(
  setters: {
    setRecipeDiff: (v: StandardRecipeDiff | null) => void;
    setUpdateRowChoices: (v: Map<string, UpdateRowChoices>) => void;
    setRestoredRemovedKeys: (v: Set<string>) => void;
    setLaborUpdateRowChoices: (v: Map<string, LaborUpdateRowChoices>) => void;
    setRestoredRemovedLaborKeys: (v: Set<string>) => void;
    setIngredientApplyModes: (v: Map<string, StandardSheetApplyMode>) => void;
    setLaborApplyModes: (v: Map<string, StandardSheetApplyMode>) => void;
    setPendingTrashIngredientKeys: (v: Set<string>) => void;
    setPendingTrashLaborKeys: (v: Set<string>) => void;
  },
) {
  setters.setRecipeDiff(null);
  setters.setUpdateRowChoices(new Map());
  setters.setRestoredRemovedKeys(new Set());
  setters.setLaborUpdateRowChoices(new Map());
  setters.setRestoredRemovedLaborKeys(new Set());
  setters.setIngredientApplyModes(new Map());
  setters.setLaborApplyModes(new Map());
  setters.setPendingTrashIngredientKeys(new Set());
  setters.setPendingTrashLaborKeys(new Set());
}

function formatSheetNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "";
  return value.toFixed(digits);
}

function formatVersionCreatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}/${d.getFullYear()}`;
}

function recomputeTotals(rows: DraftRow[]): {
  total: number | null;
  hasUnpriced: boolean;
} {
  let total = 0;
  let hasUnpriced = false;
  for (const row of rows) {
    if (row.pu == null || !Number.isFinite(row.pu) || row.total <= 0) {
      row.pt = null;
      hasUnpriced = true;
      continue;
    }
    row.pt = row.total * row.pu;
    total += row.pt;
  }
  return { total: hasUnpriced && total === 0 ? null : total, hasUnpriced };
}

function applyPuToRow(row: DraftRow, pu: number | null): void {
  row.pu = pu;
  if (pu == null || !Number.isFinite(pu) || row.total <= 0) {
    row.pt = null;
  } else {
    row.pt = row.total * pu;
  }
}

function applyAmountToDraftRow(
  row: DraftRow,
  quantity: number,
  unit: string,
  item: Item | undefined,
  baseItems: BaseItem[],
  pu: number | null,
): DraftRow {
  const grams = convertIngredientToGrams(quantity, unit, item, baseItems);
  const stepKey = Object.keys(row.step_quantities)[0] ?? "A";
  const step_quantities = { ...row.step_quantities };
  for (const k of Object.keys(step_quantities)) {
    step_quantities[k] = 0;
  }
  step_quantities[stepKey] = grams;
  const updated: DraftRow = {
    ...row,
    quantity,
    unit,
    total: grams,
    step_quantities,
  };
  applyPuToRow(updated, pu);
  return updated;
}

function applyTotalChoiceToEditRow(
  row: DraftRow,
  meta: UpdateRowMeta,
  choice: PuChoice,
  item: Item | undefined,
  baseItems: BaseItem[],
  pu: number | null,
): DraftRow {
  const qty = choice === "live" ? meta.liveQuantity : meta.sheetQuantity;
  const unit =
    (choice === "live" ? meta.liveUnit : meta.sheetUnit)?.trim() || "g";
  if (qty != null && Number.isFinite(qty) && qty > 0) {
    return applyAmountToDraftRow(row, qty, unit, item, baseItems, pu);
  }
  const grams = choice === "live" ? meta.liveGrams : meta.sheetGrams;
  if (grams != null && grams > 0) {
    return applyAmountToDraftRow(row, grams, "g", item, baseItems, pu);
  }
  return row;
}

function cloneIngredientRows(
  rows: RecipeSummaryTechnicalSheetIngredientRow[],
  itemById: Map<string, Item>,
): DraftRow[] {
  return rows.map((r) => ({
    ...r,
    row_key: rowKeyForIngredientRow(r, itemById),
    step_quantities: { ...r.step_quantities },
  }));
}

function Panel({
  title,
  isDark,
  className = "",
  headerRight,
  children,
}: {
  title: string;
  isDark: boolean;
  className?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded border p-4 ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"} ${className}`}
    >
      {title || headerRight ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {title ? (
            <h4 className="text-sm font-semibold uppercase tracking-wide">
              {title}
            </h4>
          ) : (
            <span />
          )}
          {headerRight}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function TechnicalSheetBody({
  sheet,
  isDark,
  description,
  procedure,
  onDescriptionChange,
  onProcedureChange,
  editRows,
  onAmountChange,
  onRemoveRow,
  pickerItems,
  baseItems,
  vendorProducts,
  vendors,
  hasUnpricedLines,
  updateMode,
  updateEditMode,
  updateMetaByRowKey,
  pairedRemovedKeys,
  restoredRemovedKeys,
  onRestoreRemoved,
  pendingTrashKeys,
  updateRowChoices,
  onVendorChoiceChange,
  onTotalChoiceChange,
  onFinalAmountChange,
  onVendorChange,
  ingredientApplyModes,
  onIngredientApplyModeChange,
  crossTenantAvailableItems,
  onAddIngredientRow,
  onNewRowPickerTypeChange,
  onNewRowCrossTenantFilterChange,
  onNewRowItemSelect,
  priceMode = "latest",
  onPriceModeChange,
  snapshotPriceByRowKey,
  snapshotTotalCost,
  priceLoading,
  updateLoading,
  laborRoles,
  editLaborRows,
  hasUnpricedLaborLines,
  laborUpdateMetaByRowKey,
  pairedRemovedLaborKeys,
  restoredRemovedLaborKeys,
  onRestoreRemovedLabor,
  pendingTrashLaborKeys,
  laborUpdateRowChoices,
  onLaborMinutesChoiceChange,
  onLaborRoleChange,
  onLaborMinutesChange,
  onRemoveLaborRow,
  onAddLaborRow,
  laborApplyModes,
  onLaborApplyModeChange,
  snapshotLaborCostByRowKey,
  snapshotLaborTotalCost,
}: {
  sheet: SheetData;
  isDark: boolean;
  description: string;
  procedure: string;
  onDescriptionChange?: (value: string) => void;
  onProcedureChange?: (value: string) => void;
  editRows?: DraftRow[] | null;
  onAmountChange?: (rowKey: string, quantity: number, unit: string) => void;
  onRemoveRow?: (rowKey: string) => void;
  onVendorChange?: (rowKey: string, specificChild: string | null) => void;
  pickerItems: Item[];
  baseItems: BaseItem[];
  vendorProducts: VendorProductWithBase[];
  vendors: Vendor[];
  crossTenantAvailableItems: CrossTenantPickerEntry[];
  onAddIngredientRow?: () => void;
  onNewRowPickerTypeChange?: (rowKey: string, type: IngredientPickerType) => void;
  onNewRowCrossTenantFilterChange?: (rowKey: string, filter: string) => void;
  onNewRowItemSelect?: (rowKey: string, itemId: string) => void;
  hasUnpricedLines?: boolean;
  updateMode?: boolean;
  updateEditMode?: boolean;
  updateMetaByRowKey?: Map<string, UpdateRowMeta>;
  pairedRemovedKeys?: Set<string>;
  restoredRemovedKeys?: Set<string>;
  onRestoreRemoved?: (rowKey: string) => void;
  pendingTrashKeys?: Set<string>;
  updateRowChoices?: Map<string, UpdateRowChoices>;
  onVendorChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onTotalChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onFinalAmountChange?: (
    rowKey: string,
    quantity: number,
    unit: string,
  ) => void;
  ingredientApplyModes?: Map<string, StandardSheetApplyMode>;
  onIngredientApplyModeChange?: (
    rowKey: string,
    mode: StandardSheetApplyMode,
  ) => void;
  priceMode?: StandardTechnicalSheetPriceMode;
  onPriceModeChange?: (mode: StandardTechnicalSheetPriceMode) => void;
  snapshotPriceByRowKey?: Map<
    string,
    { pu: number | null; pt: number | null }
  >;
  snapshotTotalCost?: number | null;
  priceLoading?: boolean;
  updateLoading?: boolean;
  laborRoles: LaborRole[];
  editLaborRows?: LaborDraftRow[] | null;
  hasUnpricedLaborLines?: boolean;
  laborUpdateMetaByRowKey?: Map<string, LaborUpdateRowMeta>;
  pairedRemovedLaborKeys?: Set<string>;
  restoredRemovedLaborKeys?: Set<string>;
  onRestoreRemovedLabor?: (rowKey: string) => void;
  pendingTrashLaborKeys?: Set<string>;
  laborUpdateRowChoices?: Map<string, LaborUpdateRowChoices>;
  onLaborMinutesChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onLaborRoleChange?: (rowKey: string, role: string) => void;
  onLaborMinutesChange?: (rowKey: string, minutes: number) => void;
  onRemoveLaborRow?: (rowKey: string) => void;
  onAddLaborRow?: () => void;
  laborApplyModes?: Map<string, StandardSheetApplyMode>;
  onLaborApplyModeChange?: (
    rowKey: string,
    mode: StandardSheetApplyMode,
  ) => void;
  snapshotLaborCostByRowKey?: Map<
    string,
    { hourly_wage: number | null; cost: number | null }
  >;
  snapshotLaborTotalCost?: number | null;
}) {
  const rows = editRows ?? sheet.ingredient_rows;
  const laborRows = editLaborRows ?? sheet.labor_rows ?? [];
  const showBothPrices = priceMode === "both" && snapshotPriceByRowKey != null;
  const showBothLaborPrices =
    priceMode === "both" && snapshotLaborCostByRowKey != null;
  const totalLabel =
    sheet.total_ingredient_cost != null &&
    Number.isFinite(sheet.total_ingredient_cost)
      ? `$${sheet.total_ingredient_cost.toFixed(2)}`
      : "—";
  const dualTotal = showBothPrices
    ? formatDualTotalCostLines(snapshotTotalCost, sheet.total_ingredient_cost)
    : null;
  const laborTotalLabel =
    sheet.total_labor_cost != null && Number.isFinite(sheet.total_labor_cost)
      ? `$${sheet.total_labor_cost.toFixed(2)}`
      : "—";
  const dualLaborTotal = showBothLaborPrices
    ? formatDualTotalCostLines(
        snapshotLaborTotalCost,
        sheet.total_labor_cost,
      )
    : null;

  return (
    <>
      <Panel title="Description" isDark={isDark}>
        {onDescriptionChange ? (
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            className={`w-full rounded border px-2 py-1 text-sm ${
              isDark
                ? "border-slate-600 bg-slate-900 text-slate-100"
                : "border-gray-300 bg-white text-gray-900"
            }`}
          />
        ) : (
          <p
            className={`whitespace-pre-wrap text-sm ${isDark ? "text-slate-200" : "text-gray-700"}`}
          >
            {description.trim() || "—"}
          </p>
        )}
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Procedure" isDark={isDark}>
          {onProcedureChange ? (
            <textarea
              value={procedure}
              onChange={(e) => onProcedureChange(e.target.value)}
              rows={4}
              className={`w-full rounded border px-2 py-1 text-sm ${
                isDark
                  ? "border-slate-600 bg-slate-900 text-slate-100"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
            />
          ) : (
            <p
              className={`whitespace-pre-wrap text-sm ${isDark ? "text-slate-200" : "text-gray-700"}`}
            >
              {procedure.trim() || "—"}
            </p>
          )}
        </Panel>

        {onPriceModeChange ? (
          <div className="flex justify-end">
            <PriceModeRadio
              priceMode={priceMode}
              setPriceMode={onPriceModeChange}
              isDark={isDark}
              disabled={priceLoading}
            />
          </div>
        ) : null}

        <Panel title="Ingredients" isDark={isDark}>
          {updateLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin opacity-60" />
            </div>
          ) : (
            <>
            <IngredientTable
              rows={rows}
              isDark={isDark}
              editable={!!editRows}
              pickerItems={pickerItems}
              baseItems={baseItems}
              vendorProducts={vendorProducts}
              vendors={vendors}
              crossTenantAvailableItems={crossTenantAvailableItems}
              onAmountChange={onAmountChange}
              onRemoveRow={onRemoveRow}
              onVendorChange={onVendorChange}
              onAddIngredientRow={onAddIngredientRow}
              onNewRowPickerTypeChange={onNewRowPickerTypeChange}
              onNewRowCrossTenantFilterChange={onNewRowCrossTenantFilterChange}
              onNewRowItemSelect={onNewRowItemSelect}
              updateMode={updateMode}
              updateEditMode={updateEditMode}
              updateMetaByRowKey={updateMetaByRowKey}
              pairedRemovedKeys={pairedRemovedKeys}
              restoredRemovedKeys={restoredRemovedKeys}
              onRestoreRemoved={onRestoreRemoved}
              pendingTrashKeys={pendingTrashKeys}
              updateRowChoices={updateRowChoices}
              onVendorChoiceChange={onVendorChoiceChange}
              onTotalChoiceChange={onTotalChoiceChange}
              onFinalAmountChange={onFinalAmountChange}
              ingredientApplyModes={ingredientApplyModes}
              onIngredientApplyModeChange={onIngredientApplyModeChange}
              priceMode={priceMode}
              snapshotPriceByRowKey={snapshotPriceByRowKey}
              priceLoading={priceLoading}
            />
              <div className="mt-3 flex justify-end text-right text-sm font-semibold">
                {priceLoading ? (
                  <Loader2 className="inline h-4 w-4 animate-spin" />
                ) : dualTotal ? (
                  <span className="inline-flex flex-col items-end align-top">
                    <span>{dualTotal.snapshotLine}</span>
                    <span>Total ingredient cost: {dualTotal.currentLine}</span>
                  </span>
                ) : (
                  <>Total Ingredient Cost: {totalLabel}</>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      {hasUnpricedLines ? <UnpricedBanner isDark={isDark} /> : null}

      <Panel title="Labor" isDark={isDark}>
        {updateLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin opacity-60" />
          </div>
        ) : (
          <>
            <StandardTechnicalSheetLaborTable
              rows={laborRows}
              isDark={isDark}
              editable={!!editLaborRows}
              laborRoles={laborRoles}
              updateMode={updateMode}
              updateEditMode={updateEditMode}
              updateMetaByRowKey={laborUpdateMetaByRowKey}
              pairedRemovedKeys={pairedRemovedLaborKeys}
              restoredRemovedKeys={restoredRemovedLaborKeys}
              onRestoreRemoved={onRestoreRemovedLabor}
              pendingTrashKeys={pendingTrashLaborKeys}
              updateRowChoices={laborUpdateRowChoices}
              onMinutesChoiceChange={onLaborMinutesChoiceChange}
              onRoleChange={onLaborRoleChange}
              onMinutesChange={onLaborMinutesChange}
              onRemoveRow={onRemoveLaborRow}
              onAddLaborRow={onAddLaborRow}
              laborApplyModes={laborApplyModes}
              onLaborApplyModeChange={onLaborApplyModeChange}
              priceMode={priceMode}
              snapshotCostByRowKey={snapshotLaborCostByRowKey}
              priceLoading={priceLoading}
            />
            <div className="mt-3 flex justify-end text-right text-sm font-semibold">
              {updateLoading || priceLoading ? (
                <Loader2 className="inline h-4 w-4 animate-spin" />
              ) : dualLaborTotal ? (
                <span className="inline-flex flex-col items-end align-top">
                  <span>{dualLaborTotal.snapshotLine}</span>
                  <span>Total labor cost: {dualLaborTotal.currentLine}</span>
                </span>
              ) : (
                <>Total Labor Cost: {laborTotalLabel}</>
              )}
            </div>
          </>
        )}
      </Panel>

      {hasUnpricedLaborLines ? <UnpricedBanner isDark={isDark} /> : null}
    </>
  );
}

function AmountEditor({
  quantity,
  unit,
  units,
  isDark,
  onChange,
  compact,
}: {
  quantity: number;
  unit: string;
  units: string[];
  isDark: boolean;
  onChange: (quantity: number, unit: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-end gap-1 ${compact ? "min-w-0" : ""}`}
    >
      <input
        type="number"
        min={0}
        step={unit === "each" ? 1 : 0.1}
        value={quantity > 0 ? quantity : ""}
        onChange={(e) => onChange(Number(e.target.value) || 0, unit)}
        className={`${compact ? "w-14" : "w-16"} rounded border px-1 py-0.5 text-right text-xs ${
          isDark
            ? "border-slate-600 bg-slate-900 text-slate-100"
            : "border-gray-300 bg-white text-gray-900"
        }`}
      />
      <select
        value={unit}
        onChange={(e) => onChange(quantity, e.target.value)}
        className={`min-w-[5.5rem] rounded border px-0.5 py-0.5 text-xs ${
          isDark
            ? "border-slate-600 bg-slate-900 text-slate-100"
            : "border-gray-300 bg-white text-gray-900"
        }`}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}

function VendorEditor({
  row,
  item,
  vendorProducts,
  vendors,
  pickerItems,
  baseItems,
  isDark,
  compact = false,
  onChange,
}: {
  row: DraftRow;
  item: Item | undefined;
  vendorProducts: VendorProductWithBase[];
  vendors: Vendor[];
  pickerItems: Item[];
  baseItems: BaseItem[];
  isDark: boolean;
  compact?: boolean;
  onChange: (specificChild: string | null) => void;
}) {
  if (!item || item.item_kind === "prepped" || item.is_menu_item) {
    return <span className="text-xs">-</span>;
  }

  const specific = row.specific_child ?? "lowest";
  const available = getAvailableVendorProducts(
    row.item_id,
    pickerItems,
    vendorProducts,
    vendors,
    row.specific_child,
  );

  const selectClass = `w-full ${compact ? "min-w-0" : "min-w-[200px]"} px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
    isDark
      ? "bg-slate-700 border-slate-600 text-slate-100"
      : "bg-white border-gray-300 text-gray-900"
  }`;
  const labelClass = `text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`;

  return (
    <div className={`space-y-2 ${compact ? "min-w-0" : "min-w-[200px]"}`}>
      <div className={`flex items-center ${compact ? "gap-2" : "gap-4"}`}>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`vendor-${row.row_key}`}
            checked={specific === "lowest" || specific === null}
            onChange={() => onChange("lowest")}
            className="w-4 h-4"
          />
          <span className={labelClass}>Lowest</span>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`vendor-${row.row_key}`}
            checked={specific !== "lowest" && specific !== null}
            onChange={() => {
              if (available.length > 0) {
                onChange(available[0].id);
              }
            }}
            className="w-4 h-4"
          />
          <span className={labelClass}>Specific</span>
        </label>
      </div>
      {specific !== "lowest" && specific !== null ? (
        <select
          value={specific}
          onChange={(e) => onChange(e.target.value)}
          className={selectClass}
        >
          {available.map((vp) => {
            const isDeprecated = !!vp.deprecated;
            return (
              <option
                key={vp.id}
                value={vp.id}
                disabled={isDeprecated}
                style={{
                  opacity: isDeprecated ? 0.5 : 1,
                  color: isDeprecated ? "#9ca3af" : undefined,
                }}
              >
                {vendorProductSelectOptionLabel(vp, vendors, item, baseItems)}
              </option>
            );
          })}
        </select>
      ) : null}
    </div>
  );
}

function IngredientPickerCell({
  row,
  isDark,
  pickerItems,
  baseItems,
  vendorProducts,
  crossTenantAvailableItems,
  onPickerTypeChange,
  onCrossTenantFilterChange,
  onItemSelect,
}: {
  row: DraftRow;
  isDark: boolean;
  pickerItems: Item[];
  baseItems: BaseItem[];
  vendorProducts: VendorProductWithBase[];
  crossTenantAvailableItems: CrossTenantPickerEntry[];
  onPickerTypeChange: (rowKey: string, type: IngredientPickerType) => void;
  onCrossTenantFilterChange: (rowKey: string, filter: string) => void;
  onItemSelect: (rowKey: string, itemId: string) => void;
}) {
  const pickerType =
    row.pickerType ??
    deriveIngredientPickerType(
      row.item_id || undefined,
      pickerItems,
      crossTenantAvailableItems,
    );
  const ownerFilter = row.crossTenantOwnerFilter ?? "all";
  const ownerTenants = crossTenantOwnerTenants(crossTenantAvailableItems);
  const options = buildIngredientItemSelectOptions({
    availableItems: pickerItems,
    baseItems,
    vendorProducts,
    crossTenantAvailableItems,
    typeFilter: pickerType,
    ownerTenantFilter: ownerFilter,
    currentChildItemId: row.item_id || undefined,
  });
  const radioLabelClass = `text-xs ${isDark ? "text-slate-300" : "text-gray-600"}`;
  const selectClass = `text-xs border rounded px-1 py-0.5 ${
    isDark
      ? "bg-slate-700 border-slate-600 text-slate-300"
      : "bg-white border-gray-300 text-gray-700"
  }`;

  return (
    <div className="space-y-1 min-w-[220px]">
      <div className="flex items-center gap-2 flex-wrap">
        {(["raw", "prepped", "cross-tenant"] as const).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`ingredient-type-${row.row_key}`}
                checked={pickerType === type}
                onChange={() => {
                  if (pickerType !== type) onPickerTypeChange(row.row_key, type);
                }}
                className="w-3 h-3 accent-blue-500"
              />
              <span className={radioLabelClass}>
                {type === "raw"
                  ? "Base Item"
                  : type === "prepped"
                    ? "Prepped Item"
                    : "Other tenant item"}
              </span>
            </label>
            {type === "cross-tenant" &&
              pickerType === "cross-tenant" &&
              ownerTenants.length > 0 ? (
              <select
                value={ownerFilter}
                onChange={(e) =>
                  onCrossTenantFilterChange(row.row_key, e.target.value)
                }
                className={selectClass}
              >
                <option value="all">All</option>
                {ownerTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
      </div>
      <SearchableSelect
        options={options}
        value={row.item_id || ""}
        onChange={(value) => onItemSelect(row.row_key, value)}
        placeholder="Select item..."
      />
    </div>
  );
}

function UpdateTripleHeader({
  title,
  isDark,
  showFinalColumn = true,
}: {
  title: string;
  isDark: boolean;
  showFinalColumn?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b px-2 py-1 font-semibold">{title}</div>
      <div
        className={`grid ${showFinalColumn ? "grid-cols-3" : "grid-cols-2"} text-[10px] font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}
      >
        <div className="border-r px-1 py-1">Current version</div>
        <div className={`px-1 py-1 ${showFinalColumn ? "border-r" : ""}`}>
          Recipe database
        </div>
        {showFinalColumn ? <div className="px-1 py-1">New recipe</div> : null}
      </div>
    </div>
  );
}

function VersionTripleCell({
  rowKey,
  radioGroup,
  isDark,
  showRadios,
  showFinalColumn = true,
  effectiveChoice,
  onChoiceChange,
  sheetContent,
  liveContent,
  finalContent,
}: {
  rowKey: string;
  radioGroup: string;
  isDark: boolean;
  showRadios: boolean;
  showFinalColumn?: boolean;
  effectiveChoice: PuChoice;
  onChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  sheetContent: ReactNode;
  liveContent: ReactNode;
  finalContent: ReactNode;
}) {
  const cellClass = `flex h-full items-center justify-end gap-0.5 border-r px-1 py-1 ${
    isDark ? "text-slate-200" : "text-gray-800"
  }`;
  const radioName = `version-choice-${radioGroup}-${rowKey}`;

  const gridCols = showFinalColumn ? "grid-cols-3" : "grid-cols-2";
  const liveCellClass = showFinalColumn
    ? cellClass
    : `${cellClass.replace(" border-r", "")} px-1 py-1`;
  const finalCellClass = `flex h-full items-center justify-end px-1 py-1 text-right ${
    isDark ? "text-slate-200" : "text-gray-800"
  }`;

  return (
    <div className={`grid h-full min-h-full ${gridCols} text-right`}>
      <div className={cellClass}>
        {showRadios ? (
          <input
            type="radio"
            name={radioName}
            checked={effectiveChoice === "sheet"}
            onChange={() => onChoiceChange?.(rowKey, "sheet")}
            className="h-3 w-3 shrink-0"
          />
        ) : null}
        <span>{sheetContent}</span>
      </div>
      <div className={liveCellClass}>
        {showRadios ? (
          <input
            type="radio"
            name={radioName}
            checked={effectiveChoice === "live"}
            onChange={() => onChoiceChange?.(rowKey, "live")}
            className="h-3 w-3 shrink-0"
          />
        ) : null}
        <span>{liveContent}</span>
      </div>
      {showFinalColumn ? (
        <div className={finalCellClass}>{finalContent}</div>
      ) : null}
    </div>
  );
}

function ApplyModeRadios({
  rowKey,
  value,
  isDark,
  onChange,
  showOverwrite = true,
  inactive = false,
}: {
  rowKey: string;
  value: StandardSheetApplyMode;
  isDark: boolean;
  onChange: (mode: StandardSheetApplyMode) => void;
  showOverwrite?: boolean;
  /** No changes in New recipe — neither option applies. */
  inactive?: boolean;
}) {
  const name = `apply-mode-${rowKey}`;
  const labelClass = `flex items-center gap-1 whitespace-nowrap text-xs ${
    isDark ? "text-slate-200" : "text-gray-900"
  }`;

  if (inactive) {
    return (
      <div
        className="mx-auto flex w-fit flex-col items-start gap-1"
        title="No changes in New recipe — Apply not needed"
      >
        <label className={`${labelClass} cursor-default opacity-60`}>
          <input
            type="radio"
            name={name}
            checked={false}
            disabled
            readOnly
            className="h-3 w-3 shrink-0 cursor-default"
          />
          <span>Override</span>
        </label>
        <label className={`${labelClass} cursor-default opacity-60`}>
          <input
            type="radio"
            name={name}
            checked={false}
            disabled
            readOnly
            className="h-3 w-3 shrink-0 cursor-default"
          />
          <span>Overwrite</span>
        </label>
      </div>
    );
  }

  const locked = !showOverwrite;
  const effectiveValue: StandardSheetApplyMode = locked ? "override" : value;

  return (
    <div
      className="mx-auto flex w-fit flex-col items-start gap-1"
      title={locked ? "Recipe has no line — TS only" : undefined}
    >
      <label
        className={`${labelClass}${locked ? " cursor-default" : ""}`}
      >
        <input
          type="radio"
          name={name}
          checked={effectiveValue === "override"}
          disabled={locked}
          readOnly={locked}
          onChange={() => onChange("override")}
          className={`h-3 w-3 shrink-0${locked ? " cursor-default" : ""}`}
        />
        <span>Override</span>
      </label>
      <label
        className={`${labelClass}${locked ? " cursor-default opacity-60" : ""}`}
      >
        <input
          type="radio"
          name={name}
          checked={effectiveValue === "overwrite"}
          disabled={locked}
          readOnly={locked}
          onChange={() => onChange("overwrite")}
          className={`h-3 w-3 shrink-0${locked ? " cursor-default" : ""}`}
        />
        <span>Overwrite</span>
      </label>
    </div>
  );
}

function IngredientTable({
  rows,
  isDark,
  editable,
  pickerItems,
  baseItems,
  vendorProducts,
  vendors,
  crossTenantAvailableItems,
  onAmountChange,
  onRemoveRow,
  onVendorChange,
  onAddIngredientRow,
  onNewRowPickerTypeChange,
  onNewRowCrossTenantFilterChange,
  onNewRowItemSelect,
  updateMode,
  updateEditMode,
  updateMetaByRowKey,
  pairedRemovedKeys,
  restoredRemovedKeys,
  onRestoreRemoved,
  pendingTrashKeys,
  updateRowChoices,
  onVendorChoiceChange,
  onTotalChoiceChange,
  onFinalAmountChange,
  ingredientApplyModes,
  onIngredientApplyModeChange,
  priceMode = "latest",
  snapshotPriceByRowKey,
  priceLoading,
}: {
  rows: (RecipeSummaryTechnicalSheetIngredientRow & { row_key?: string })[];
  isDark: boolean;
  editable?: boolean;
  pickerItems: Item[];
  baseItems: BaseItem[];
  vendorProducts: VendorProductWithBase[];
  vendors: Vendor[];
  crossTenantAvailableItems: CrossTenantPickerEntry[];
  onAmountChange?: (rowKey: string, quantity: number, unit: string) => void;
  onRemoveRow?: (rowKey: string) => void;
  onVendorChange?: (rowKey: string, specificChild: string | null) => void;
  onAddIngredientRow?: () => void;
  onNewRowPickerTypeChange?: (rowKey: string, type: IngredientPickerType) => void;
  onNewRowCrossTenantFilterChange?: (rowKey: string, filter: string) => void;
  onNewRowItemSelect?: (rowKey: string, itemId: string) => void;
  updateMode?: boolean;
  updateEditMode?: boolean;
  updateMetaByRowKey?: Map<string, UpdateRowMeta>;
  pairedRemovedKeys?: Set<string>;
  restoredRemovedKeys?: Set<string>;
  onRestoreRemoved?: (rowKey: string) => void;
  pendingTrashKeys?: Set<string>;
  updateRowChoices?: Map<string, UpdateRowChoices>;
  onVendorChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onTotalChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onFinalAmountChange?: (
    rowKey: string,
    quantity: number,
    unit: string,
  ) => void;
  ingredientApplyModes?: Map<string, StandardSheetApplyMode>;
  onIngredientApplyModeChange?: (
    rowKey: string,
    mode: StandardSheetApplyMode,
  ) => void;
  priceMode?: StandardTechnicalSheetPriceMode;
  snapshotPriceByRowKey?: Map<
    string,
    { pu: number | null; pt: number | null }
  >;
  priceLoading?: boolean;
}) {
  const showBothPrices = priceMode === "both" && snapshotPriceByRowKey != null;
  const showUpdateTotal = updateMode && updateMetaByRowKey && updateRowChoices;
  const showFinalColumn = !!updateEditMode;
  const showApplyModeColumn =
    !!updateEditMode &&
    !!ingredientApplyModes &&
    !!onIngredientApplyModeChange;
  const updateCompareMinW = showFinalColumn ? "min-w-[260px]" : "min-w-[180px]";
  const showActionColumn =
    (!!editable && !!onRemoveRow) || (!!showUpdateTotal && !!onRestoreRemoved);
  const itemById = useMemo(() => {
    const m = new Map(pickerItems.map((i) => [i.id, i]));
    for (const entry of crossTenantAvailableItems) {
      m.set(entry.item.id, crossTenantEntryToItem(entry));
    }
    return m;
  }, [pickerItems, crossTenantAvailableItems]);

  const unitsForRow = (itemId: string) =>
    getAvailableUnitsForItem(
      itemById.get(itemId),
      baseItems,
      vendorProducts,
    );

  const rowKeyOf = (row: (typeof rows)[number]) =>
    row.row_key ?? rowKeyForIngredientRow(row, itemById);

  return (
    <div className="space-y-2">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr className={technicalSheetTableHeaderClass(isDark)}>
            <th className="border px-2 py-1 text-left">Nature</th>
            <th
              className={
                showUpdateTotal
                  ? `border px-0 py-0 text-center align-bottom ${updateCompareMinW}`
                  : "border px-2 py-1 text-left min-w-[100px]"
              }
            >
              {showUpdateTotal ? (
                <UpdateTripleHeader
                  title="Vendor Selection"
                  isDark={isDark}
                  showFinalColumn={showFinalColumn}
                />
              ) : (
                "Vendor Selection"
              )}
            </th>
            {showUpdateTotal ? (
              <th
                className={`border px-0 py-0 text-center align-bottom ${updateCompareMinW}`}
              >
                <UpdateTripleHeader
                  title="Net Weight"
                  isDark={isDark}
                  showFinalColumn={showFinalColumn}
                />
              </th>
            ) : (
              <th className="border px-2 py-1 text-right">Net Weight</th>
            )}
            <th className="border px-2 py-1 text-right">PU (kg)</th>
            <th className="border px-2 py-1 text-right">PT</th>
            {showApplyModeColumn ? (
              <th className="border px-2 py-1 text-center min-w-[88px]">
                Apply
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = row as DraftRow;
            const stableRowKey = draft.row_key;
            const rowKey = stableRowKey || rowKeyOf(row);
            const meta = updateMetaByRowKey?.get(rowKey);
            const diffType = meta?.diffType ?? "unchanged";
            const isPendingNew = editable && !row.item_id;
            const isManualNewRow =
              (draft.isNew || isPendingNew) && meta == null;
            const isPendingTrash = pendingTrashKeys?.has(rowKey) ?? false;
            const storedChoices = updateRowChoices?.get(rowKey);
            const effectiveVendorChoice = effectivePuChoice(
              diffType,
              storedChoices?.vendor,
            );
            const effectiveTotalChoice = effectivePuChoice(
              diffType,
              storedChoices?.total,
            );
            const vendorRadioResolve =
              updateEditMode && meta && showVendorVersionSplit(diffType)
                ? resolveEditVendorRadios(
                    meta,
                    diffType,
                    row.specific_child,
                    storedChoices?.vendor,
                  )
                : null;
            const totalRadioResolve =
              updateEditMode && meta && showTotalVersionSplit(diffType, meta)
                ? resolveEditTotalRadios(
                    meta,
                    diffType,
                    row.total,
                    storedChoices?.total,
                  )
                : null;
            const showVendorRadios =
              !!onVendorChoiceChange && !!vendorRadioResolve?.showRadios;
            const showTotalRadios =
              !!onTotalChoiceChange && !!totalRadioResolve?.showRadios;
            const vendorChoiceForRadios = vendorRadioResolve?.showRadios
              ? vendorRadioResolve.displayChoice
              : effectiveVendorChoice;
            const totalChoiceForRadios = totalRadioResolve?.showRadios
              ? totalRadioResolve.displayChoice
              : effectiveTotalChoice;
            const useUpdateTriple =
              !!showUpdateTotal &&
              (meta != null ||
                (updateEditMode && !!editable && (draft.isNew || isPendingNew)));
            const isRemovedPendingRestore = isRemovedRowPendingRestore(
              diffType,
              rowKey,
              restoredRemovedKeys,
            );
            const isApplyModeLocked = isIngredientApplyModeLocked(
              diffType,
              rowKey,
              isPendingTrash,
              restoredRemovedKeys,
            );
            const isRowLockedForEdit = isRemovedPendingRestore || isPendingTrash;
            const canRestoreRemoved =
              !!onRestoreRemoved &&
              meta != null &&
              isRemovedPendingRestore &&
              (pairedRemovedKeys == null || !pairedRemovedKeys.has(rowKey));
            const rowUnits = row.item_id
              ? unitsForRow(row.item_id)
              : ["g"];
            const item = row.item_id ? itemById.get(row.item_id) : undefined;
            const isApplyChoiceNeeded = isIngredientApplyChoiceNeeded(
              diffType,
              meta,
              row,
              item,
              { isManualNewRow, isPendingNew },
            );
            const isApplyInactive =
              !!updateEditMode && !isApplyModeLocked && !isApplyChoiceNeeded;
            const qty = rowQuantity(row);
            const unit = row.unit?.trim() || "g";
            const amountChangeHandler =
              updateEditMode && onFinalAmountChange
                ? onFinalAmountChange
                : onAmountChange;
            const showVendorFinalEdit =
              updateEditMode &&
              editable &&
              !isRowLockedForEdit &&
              onVendorChange &&
              !!item &&
              item.item_kind === "raw" &&
              !item.is_menu_item;
            const showVendorEdit =
              editable &&
              onVendorChange &&
              !!item &&
              item.item_kind === "raw" &&
              !item.is_menu_item &&
              !updateEditMode;
            const vendorLabelFromMeta =
              meta != null
                ? effectiveVendorChoice === "live"
                  ? meta.liveVendorLabel
                  : meta.sheetVendorLabel
                : null;
            const vendorDisplay = vendorSelectionDisplay(
              item,
              row.specific_child,
              vendorLabelFromMeta ?? row.vendor_item,
            );

            const finalDisplay =
              meta != null
                ? formatUpdateAmount(
                    effectiveTotalChoice === "live"
                      ? meta.liveQuantity
                      : meta.sheetQuantity,
                    effectiveTotalChoice === "live"
                      ? meta.liveUnit
                      : meta.sheetUnit,
                    finalGramsForChoice(meta, effectiveTotalChoice),
                  )
                : formatRowAmount(row);

            const finalAmountEditor =
              updateEditMode && amountChangeHandler && !isRowLockedForEdit ? (
                <AmountEditor
                  quantity={qty}
                  unit={unit}
                  units={ensureUnitInList(
                    rowUnits.length > 0 ? rowUnits : [unit || "g"],
                    unit,
                  )}
                  isDark={isDark}
                  compact={!!useUpdateTriple}
                  onChange={(q, u) => amountChangeHandler(rowKey, q, u)}
                />
              ) : null;

            const finalCellContent = finalAmountEditor ?? finalDisplay;

            const rowBgClass =
              showUpdateTotal
                ? updateRowClassForDisplay(
                    diffType,
                    isDark,
                    rowKey,
                    restoredRemovedKeys,
                  )
                : technicalSheetTableBodyRowClass(isDark);

            return (
              <tr
                key={stableRowKey || rowKey}
                className={isDark ? "text-slate-200" : "text-gray-900"}
              >
                <td className={`border px-2 py-1 align-top ${rowBgClass}`}>
                  {isPendingNew &&
                  !isPendingTrash &&
                  onNewRowItemSelect &&
                  onNewRowPickerTypeChange &&
                  onNewRowCrossTenantFilterChange ? (
                    <IngredientPickerCell
                      row={draft}
                      isDark={isDark}
                      pickerItems={pickerItems}
                      baseItems={baseItems}
                      vendorProducts={vendorProducts}
                      crossTenantAvailableItems={crossTenantAvailableItems}
                      onPickerTypeChange={onNewRowPickerTypeChange}
                      onCrossTenantFilterChange={onNewRowCrossTenantFilterChange}
                      onItemSelect={onNewRowItemSelect}
                    />
                  ) : (
                    <span>{row.nature}</span>
                  )}
                </td>
                <td
                  className={
                    useUpdateTriple
                      ? technicalSheetTripleCellTdClass(rowBgClass)
                      : `border px-2 py-1 align-top ${rowBgClass}`
                  }
                >
                  {showVendorEdit ? (
                    <VendorEditor
                      row={draft}
                      item={item}
                      vendorProducts={vendorProducts}
                      vendors={vendors}
                      pickerItems={pickerItems}
                      baseItems={baseItems}
                      isDark={isDark}
                      onChange={(sc) => onVendorChange(stableRowKey || rowKey, sc)}
                    />
                  ) : useUpdateTriple ? (
                    <div className="h-full">
                      <VersionTripleCell
                        rowKey={rowKey}
                        radioGroup="vendor"
                        isDark={isDark}
                        showFinalColumn={showFinalColumn}
                        showRadios={showVendorRadios}
                        effectiveChoice={vendorChoiceForRadios}
                        onChoiceChange={onVendorChoiceChange}
                        sheetContent={
                          <span className="text-xs">
                            {formatUpdateVendorLabel(
                              meta?.sheetVendorLabel,
                              meta?.diffType,
                              "sheet",
                              vendorDisplay,
                              isManualNewRow,
                            )}
                          </span>
                        }
                        liveContent={
                          <span className="text-xs">
                            {formatUpdateVendorLabel(
                              meta?.liveVendorLabel,
                              meta?.diffType,
                              "live",
                              vendorDisplay,
                              isManualNewRow,
                            )}
                          </span>
                        }
                        finalContent={
                          isPendingTrash || isRemovedPendingRestore ? (
                            <span className="text-xs">—</span>
                          ) : showVendorFinalEdit ? (
                            <VendorEditor
                              row={draft}
                              item={item}
                              vendorProducts={vendorProducts}
                              vendors={vendors}
                              pickerItems={pickerItems}
                              baseItems={baseItems}
                              isDark={isDark}
                              compact
                              onChange={(sc) =>
                                onVendorChange!(stableRowKey || rowKey, sc)
                              }
                            />
                          ) : (
                            <span className="text-xs">{vendorDisplay}</span>
                          )
                        }
                      />
                    </div>
                  ) : (
                    <span className="text-xs">{vendorDisplay}</span>
                  )}
                </td>
                {useUpdateTriple ? (
                  <td className={technicalSheetTripleCellTdClass(rowBgClass)}>
                    <div className="h-full">
                      <VersionTripleCell
                        rowKey={rowKey}
                        radioGroup="total"
                        isDark={isDark}
                        showFinalColumn={showFinalColumn}
                        showRadios={showTotalRadios}
                        effectiveChoice={totalChoiceForRadios}
                        onChoiceChange={onTotalChoiceChange}
                        sheetContent={
                          isManualNewRow ? (
                            <span className="text-xs">—</span>
                          ) : meta ? (
                            formatUpdateAmount(
                              meta.sheetQuantity,
                              meta.sheetUnit,
                              meta.sheetGrams,
                            )
                          ) : (
                            formatRowAmount(row)
                          )
                        }
                        liveContent={
                          isManualNewRow ? (
                            <span className="text-xs">—</span>
                          ) : meta ? (
                            formatUpdateAmount(
                              meta.liveQuantity,
                              meta.liveUnit,
                              meta.liveGrams,
                            )
                          ) : (
                            formatRowAmount(row)
                          )
                        }
                        finalContent={
                          isPendingTrash || isRemovedPendingRestore ? (
                            <span className="text-xs">—</span>
                          ) : (
                            finalCellContent
                          )
                        }
                      />
                    </div>
                  </td>
                ) : (
                  <td className={`border px-2 py-1 text-right ${rowBgClass}`}>
                    {editable &&
                    amountChangeHandler &&
                    !isRowLockedForEdit ? (
                      <AmountEditor
                        quantity={qty}
                        unit={unit}
                        units={ensureUnitInList(
                    rowUnits.length > 0 ? rowUnits : [unit || "g"],
                    unit,
                  )}
                        isDark={isDark}
                        onChange={(q, u) =>
                          amountChangeHandler(rowKey, q, u)
                        }
                      />
                    ) : (
                      formatRowAmount(row)
                    )}
                  </td>
                )}
                <td className={`border px-2 py-1 text-right ${rowBgClass}`}>
                  {priceLoading ||
                  ("puLoading" in row && (row as DraftRow).puLoading) ? (
                    <Loader2 className="inline h-3 w-3 animate-spin" />
                  ) : showBothPrices ? (
                    formatDualPuPerKg(
                      snapshotPriceByRowKey.get(rowKey)?.pu,
                      row.pu,
                    )
                  ) : (
                    formatPuPerKg(row.pu)
                  )}
                </td>
                <td className={`border px-2 py-1 text-right ${rowBgClass}`}>
                  {priceLoading ? (
                    <Loader2 className="inline h-3 w-3 animate-spin" />
                  ) : showBothPrices ? (
                    formatDualPtDollars(
                      snapshotPriceByRowKey.get(rowKey)?.pt,
                      row.pt,
                    )
                  ) : (
                    formatPtDollars(row.pt)
                  )}
                </td>
                {showApplyModeColumn ? (
                  <td
                    className={`border px-2 py-1 text-center align-middle ${rowBgClass}`}
                  >
                    <ApplyModeRadios
                      rowKey={rowKey}
                      value={
                        isApplyModeLocked
                          ? "override"
                          : (ingredientApplyModes!.get(rowKey) ?? "overwrite")
                      }
                      isDark={isDark}
                      inactive={isApplyInactive}
                      showOverwrite={!isApplyModeLocked}
                      onChange={(mode) =>
                        onIngredientApplyModeChange!(rowKey, mode)
                      }
                    />
                  </td>
                ) : null}
                {showActionColumn ? (
                  <td className={technicalSheetActionColumnCellClass(isDark)}>
                    {canRestoreRemoved ? (
                      <button
                        type="button"
                        onClick={() => onRestoreRemoved!(rowKey)}
                        className={
                          isDark
                            ? "text-blue-400 hover:text-blue-300"
                            : "text-blue-600 hover:text-blue-700"
                        }
                        title="Restore ingredient"
                        aria-label="Restore ingredient"
                      >
                        <CornerUpLeft className="mx-auto h-4 w-4" />
                      </button>
                    ) : editable && onRemoveRow ? (
                      <button
                        type="button"
                        onClick={() => onRemoveRow(rowKey)}
                        className={
                          isPendingTrash
                            ? "rounded p-1 bg-red-600 text-white hover:bg-red-700"
                            : "text-red-500 hover:text-red-600"
                        }
                        title={
                          isPendingTrash
                            ? "Marked for removal — click to undo"
                            : "Mark for removal"
                        }
                        aria-label={
                          isPendingTrash
                            ? "Undo mark for removal"
                            : "Mark for removal"
                        }
                        aria-pressed={isPendingTrash}
                      >
                        <Trash2 className="mx-auto h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {editable && onAddIngredientRow ? (
      <button
        type="button"
        onClick={onAddIngredientRow}
        className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
          isDark
            ? "text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
            : "text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        }`}
      >
        <Plus className="h-4 w-4" />
        <span className="text-sm">Add ingredient</span>
      </button>
    ) : null}
    </div>
  );
}


export function StandardTechnicalSheetView({
  isDark,
  sourceItemId,
  baseRecipeName,
  onClose,
}: StandardTechnicalSheetViewProps) {
  const [versions, setVersions] = useState<StandardTechnicalSheetVersionMeta[]>(
    [],
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<StandardTechnicalSheetDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const [priceMode, setPriceMode] =
    useState<StandardTechnicalSheetPriceMode>("latest");
  const prevPriceModeRef = useRef<StandardTechnicalSheetPriceMode | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sheet");
  const [recipeDiff, setRecipeDiff] = useState<StandardRecipeDiff | null>(null);
  const [updateRowChoices, setUpdateRowChoices] = useState<
    Map<string, UpdateRowChoices>
  >(new Map());
  const [restoredRemovedKeys, setRestoredRemovedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [laborUpdateRowChoices, setLaborUpdateRowChoices] = useState<
    Map<string, LaborUpdateRowChoices>
  >(new Map());
  const [restoredRemovedLaborKeys, setRestoredRemovedLaborKeys] = useState<
    Set<string>
  >(() => new Set());
  const [updateLoading, setUpdateLoading] = useState(false);
  const [ingredientApplyModes, setIngredientApplyModes] = useState<
    Map<string, StandardSheetApplyMode>
  >(() => new Map());
  const [laborApplyModes, setLaborApplyModes] = useState<
    Map<string, StandardSheetApplyMode>
  >(() => new Map());
  const [pendingTrashIngredientKeys, setPendingTrashIngredientKeys] =
    useState<Set<string>>(() => new Set());
  const [pendingTrashLaborKeys, setPendingTrashLaborKeys] = useState<
    Set<string>
  >(() => new Set());

  const [editRows, setEditRows] = useState<DraftRow[] | null>(null);
  const [editLaborRows, setEditLaborRows] = useState<LaborDraftRow[] | null>(
    null,
  );
  const [editLaborHasUnpriced, setEditLaborHasUnpriced] = useState(false);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [editDescription, setEditDescription] = useState("");
  const [editProcedure, setEditProcedure] = useState("");
  const [editHasUnpriced, setEditHasUnpriced] = useState(false);
  const [costCache, setCostCache] = useState<Map<string, number | null>>(
    new Map(),
  );
  const [pickerItems, setPickerItems] = useState<Item[]>([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [baseItems, setBaseItems] = useState<BaseItem[]>([]);
  const [vendorProducts, setVendorProducts] = useState<VendorProductWithBase[]>(
    [],
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [crossTenantShareRows, setCrossTenantShareRows] = useState<
    Awaited<ReturnType<typeof crossTenantItemSharesAPI.getAvailable>>
  >([]);
  const { selectedTenantId, tenants: contextTenants } = useTenant();

  const loadVersions = useCallback(async () => {
    await standardTechnicalSheetsAPI.ensureV0([sourceItemId]);
    const { versions: v } =
      await standardTechnicalSheetsAPI.listVersions(sourceItemId);
    setVersions(v);
    const latest = v.find((x) => x.is_latest) ?? v[v.length - 1];
    if (latest) setSelectedVersionId(latest.id);
    return v;
  }, [sourceItemId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadVersions();
      } catch (e) {
        console.error(e);
        alert("Failed to load standard technical sheet versions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadVersions]);

  useEffect(() => {
    void Promise.all([
      itemsAPI.getAll(),
      baseItemsAPI.getAll(),
      vendorProductsAPI.getAll(),
      vendorsAPI.getAll(),
      productMappingsAPI.getAll(),
      laborRolesAPI.getAll(),
    ])
      .then(([items, bases, vps, vends, mappings, roles]) => {
        setCatalogItems(items);
        setPickerItems(
          items.filter(
            (i) =>
              !i.deprecated &&
              (i.item_kind === "raw" || i.item_kind === "prepped") &&
              i.id !== sourceItemId,
          ),
        );
        setBaseItems(bases);
        setVendorProducts(enrichVendorProductsWithBase(vps, mappings));
        setVendors(vends);
        setLaborRoles(roles);
      })
      .catch(console.error);
  }, [sourceItemId]);

  useEffect(() => {
    if (!selectedTenantId) {
      setCrossTenantShareRows([]);
      return;
    }
    crossTenantItemSharesAPI
      .getAvailable(selectedTenantId)
      .then(setCrossTenantShareRows)
      .catch(console.error);
  }, [selectedTenantId]);

  const crossTenantAvailableItems = useMemo((): CrossTenantPickerEntry[] => {
    return crossTenantShareRows
      .filter((row) => row.items)
      .map((row) => ({
        item: row.items!,
        ownerTenantName:
          contextTenants.find((t) => t.id === row.items!.tenant_id)?.name ??
          row.owner_tenant_id,
      }));
  }, [crossTenantShareRows, contextTenants]);

  const loadDetail = useCallback(
    async (versionId: string, mode: StandardTechnicalSheetPriceMode) => {
      const apiMode = mode === "both" ? "latest" : mode;
      const d = await standardTechnicalSheetsAPI.getById(versionId, {
        price_mode: apiMode,
      });
      setDetail(d);
      return d;
    },
    [],
  );

  useEffect(() => {
    if (!selectedVersionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSheetLoading(true);
      try {
        const d = await loadDetail(selectedVersionId, priceMode);
        if (!cancelled) setDetail(d);
      } catch (e) {
        console.error(e);
        alert("Failed to load technical sheet");
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // priceMode intentionally omitted — version change uses current selection; price switches reload separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId, loadDetail]);

  useEffect(() => {
    if (
      !selectedVersionId ||
      !detail ||
      viewMode !== "sheet" ||
      updateLoading
    ) {
      return;
    }

    if (prevPriceModeRef.current === null) {
      prevPriceModeRef.current = priceMode;
      return;
    }

    if (prevPriceModeRef.current === priceMode) {
      return;
    }

    prevPriceModeRef.current = priceMode;

    let cancelled = false;
    (async () => {
      setPriceLoading(true);
      try {
        const d = await loadDetail(selectedVersionId, priceMode);
        if (!cancelled) setDetail(d);
      } catch (e) {
        console.error(e);
        alert("Failed to load technical sheet");
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [priceMode, viewMode, updateLoading, selectedVersionId, detail, loadDetail]);

  useEffect(() => {
    setViewMode("sheet");
    setEditRows(null);
    setEditLaborRows(null);
    setEditHasUnpriced(false);
    setEditLaborHasUnpriced(false);
    setEditDescription("");
    setEditProcedure("");
    clearUpdateSession({
      setRecipeDiff,
      setUpdateRowChoices,
      setRestoredRemovedKeys,
      setLaborUpdateRowChoices,
      setRestoredRemovedLaborKeys,
      setIngredientApplyModes,
      setLaborApplyModes,
      setPendingTrashIngredientKeys,
      setPendingTrashLaborKeys,
    });
  }, [selectedVersionId]);

  const updateDisplayPlan = useMemo(
    () =>
      recipeDiff
        ? buildUpdateDisplayPlan(recipeDiff, restoredRemovedKeys)
        : null,
    [recipeDiff, restoredRemovedKeys],
  );

  const updateMetaByRowKey = useMemo(() => {
    if (!recipeDiff) return null;
    return buildUpdateMetaByRowKey(recipeDiff, restoredRemovedKeys);
  }, [recipeDiff, restoredRemovedKeys]);

  const pairedRemovedKeys = updateDisplayPlan?.pairedRowKeys ?? new Set();

  const laborUpdateDisplayPlan = useMemo(
    () =>
      recipeDiff
        ? buildLaborUpdateDisplayPlan(recipeDiff, restoredRemovedLaborKeys)
        : null,
    [recipeDiff, restoredRemovedLaborKeys],
  );

  const laborUpdateMetaByRowKey = useMemo(() => {
    if (!recipeDiff) return null;
    return buildLaborUpdateMetaByRowKey(recipeDiff, restoredRemovedLaborKeys);
  }, [recipeDiff, restoredRemovedLaborKeys]);

  const pairedRemovedLaborKeys =
    laborUpdateDisplayPlan?.pairedRemovedKeys ?? new Set();

  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of catalogItems) {
      if (i.deprecated) continue;
      if (i.item_kind !== "raw" && i.item_kind !== "prepped") continue;
      m.set(i.id, i);
    }
    for (const entry of crossTenantAvailableItems) {
      m.set(entry.item.id, crossTenantEntryToItem(entry));
    }
    return m;
  }, [catalogItems, crossTenantAvailableItems]);

  const snapshotPriceByRowKey = useMemo(() => {
    const snapRows = detail?.snapshot?.sheet?.ingredient_rows;
    if (!snapRows) return undefined;
    const m = new Map<string, { pu: number | null; pt: number | null }>();
    for (const row of snapRows) {
      const key = rowKeyForIngredientRow(row, itemById);
      m.set(key, { pu: row.pu, pt: row.pt });
    }
    return m;
  }, [detail, itemById]);

  const snapshotTotalCost =
    detail?.snapshot?.sheet?.total_ingredient_cost ?? null;

  const snapshotLaborCostByRowKey = useMemo(() => {
    const snapRows = detail?.snapshot?.sheet?.labor_rows;
    if (!snapRows) return undefined;
    const m = new Map<
      string,
      { hourly_wage: number | null; cost: number | null }
    >();
    for (const row of snapRows) {
      m.set(row.row_key, { hourly_wage: row.hourly_wage, cost: row.cost });
    }
    return m;
  }, [detail]);

  const snapshotLaborTotalCost =
    detail?.snapshot?.sheet?.total_labor_cost ?? null;

  const isEditUpdate = viewMode === "editUpdate";
  const showRestoreRemoved = isEditUpdate;

  const displayDescription =
    isEditUpdate ? editDescription : (detail?.description ?? "");
  const displayProcedure =
    isEditUpdate ? editProcedure : (detail?.procedure ?? "");

  const displaySheet = useMemo((): SheetData | null => {
    if (!detail) return null;
    const baseSheet = {
      ...detail.sheet,
      labor_rows: detail.sheet.labor_rows ?? [],
      total_labor_cost: detail.sheet.total_labor_cost ?? null,
    };
    if (isEditUpdate && editRows) {
      const ingredientRowsForTotal =
        updateMetaByRowKey
          ? editRows.filter((r) => {
              const key = r.row_key;
              if (!key) return true;
              const meta = updateMetaByRowKey.get(key);
              return !(
                meta?.diffType === "removed" && !restoredRemovedKeys.has(key)
              ) && !pendingTrashIngredientKeys.has(key);
            })
          : editRows;
      const { total } = recomputeTotals(ingredientRowsForTotal);
      const laborRowsForTotal =
        editLaborRows != null && laborUpdateMetaByRowKey
          ? editLaborRows.filter((r) => {
              const meta = laborUpdateMetaByRowKey.get(r.row_key);
              return !(
                meta?.diffType === "removed" &&
                !restoredRemovedLaborKeys.has(r.row_key)
              ) && !pendingTrashLaborKeys.has(r.row_key);
            })
          : editLaborRows;
      const laborResult =
        laborRowsForTotal != null
          ? recomputeLaborTotals(laborRowsForTotal, laborRoles)
          : {
              total: baseSheet.total_labor_cost,
              hasUnpriced: false,
            };
      return {
        ...baseSheet,
        ingredient_rows: editRows,
        total_ingredient_cost: total,
        labor_rows: editLaborRows ?? baseSheet.labor_rows,
        total_labor_cost: laborResult.total,
      };
    }
    return baseSheet;
  }, [
    detail,
    isEditUpdate,
    editRows,
    editLaborRows,
    laborRoles,
    updateMetaByRowKey,
    laborUpdateMetaByRowKey,
    restoredRemovedKeys,
    restoredRemovedLaborKeys,
    pendingTrashIngredientKeys,
    pendingTrashLaborKeys,
  ]);

  const openEditUpdate = async () => {
    if (!selectedVersionId || !detail?.sheet) return;
    setUpdateLoading(true);
    setPriceMode("latest");
    try {
      const d = await loadDetail(selectedVersionId, "latest");
      const [diff, live] = await Promise.all([
        standardTechnicalSheetsAPI.getRecipeDiff(selectedVersionId),
        standardTechnicalSheetsAPI.previewFromLatestRecipe(sourceItemId),
      ]);
      setRecipeDiff(diff);
      setEditDescription(d.description ?? "");
      setEditProcedure(d.procedure ?? "");
      setRestoredRemovedKeys(new Set());
      setRestoredRemovedLaborKeys(new Set());
      const plan = buildUpdateDisplayPlan(diff);
      const choices = defaultUpdateRowChoices(diff, plan);
      const laborPlan = buildLaborUpdateDisplayPlan(diff);
      const laborChoices = defaultLaborUpdateRowChoices(diff, laborPlan);
      setUpdateRowChoices(choices);
      setLaborUpdateRowChoices(laborChoices);
      setIngredientApplyModes(defaultIngredientApplyModes(diff, plan));
      setLaborApplyModes(defaultLaborApplyModes(diff, laborPlan));

      const clonedRows = buildEditRowsFromChoices(
        d.sheet,
        live,
        choices,
        diff,
        new Set(),
        itemById,
        catalogItems,
        vendorProducts,
        vendors,
        baseItems,
      );
      const clonedLabor = buildEditLaborRowsFromChoices(
        d.sheet,
        live,
        laborChoices,
        diff,
        new Set(),
        laborRoles,
      );
      setEditRows(clonedRows);
      setEditLaborRows(clonedLabor);
      const cache = new Map<string, number | null>();
      for (const row of clonedRows) {
        cache.set(puCacheKey(row.item_id, row.specific_child), row.pu);
      }
      setCostCache(cache);
      setEditHasUnpriced(recomputeTotals(clonedRows).hasUnpriced);
      setEditLaborHasUnpriced(
        recomputeLaborTotals(clonedLabor, laborRoles).hasUnpriced,
      );
      setViewMode("editUpdate");

      try {
        const [items, bases] = await Promise.all([
          itemsAPI.getAll(),
          baseItemsAPI.getAll(),
        ]);
        setPickerItems(
          items.filter(
            (i) =>
              !i.deprecated &&
              (i.item_kind === "raw" || i.item_kind === "prepped") &&
              i.id !== sourceItemId,
          ),
        );
        setBaseItems(bases);
      } catch (e) {
        console.error(e);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to open Edit/Update");
    } finally {
      setUpdateLoading(false);
    }
  };

  const cancelEditUpdate = () => {
    setViewMode("sheet");
    setEditRows(null);
    setEditLaborRows(null);
    setEditHasUnpriced(false);
    setEditLaborHasUnpriced(false);
    setCostCache(new Map());
    setEditDescription("");
    setEditProcedure("");
    clearUpdateSession({
      setRecipeDiff,
      setUpdateRowChoices,
      setRestoredRemovedKeys,
      setLaborUpdateRowChoices,
      setRestoredRemovedLaborKeys,
      setIngredientApplyModes,
      setLaborApplyModes,
      setPendingTrashIngredientKeys,
      setPendingTrashLaborKeys,
    });
  };

  const handleRestoreRemoved = (rowKey: string) => {
    setRestoredRemovedKeys((prev) => new Set(prev).add(rowKey));
    setUpdateRowChoices((prev) => {
      const next = new Map(prev);
      next.set(rowKey, { vendor: "sheet", total: "sheet" });
      return next;
    });
  };

  const handleRestoreRemovedLabor = (rowKey: string) => {
    setRestoredRemovedLaborKeys((prev) => new Set(prev).add(rowKey));
    setLaborUpdateRowChoices((prev) => {
      const next = new Map(prev);
      next.set(rowKey, { minutes: "sheet" });
      return next;
    });
  };

  const handleAmountChange = (
    rowKey: string,
    quantity: number,
    unit: string,
  ) => {
    let fetchItemId: string | null = null;
    let syncedTotalGrams: number | null = null;
    updateEditRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        const updated = applyAmountToDraftRow(
          row,
          quantity,
          unit,
          itemById.get(row.item_id),
          baseItems,
          costCache.get(puCacheKey(row.item_id, row.specific_child)) ?? row.pu,
        );
        syncedTotalGrams = updated.total;
        if (
          updated.item_id &&
          updated.total > 0 &&
          (costCache.get(
            puCacheKey(updated.item_id, updated.specific_child),
          ) ??
            updated.pu) == null
        ) {
          fetchItemId = updated.item_id;
          return { ...updated, puLoading: true };
        }
        return updated;
      }),
    );
    if (isEditUpdate && updateMetaByRowKey && syncedTotalGrams != null) {
      const meta = updateMetaByRowKey.get(rowKey);
      if (meta) {
        const resolved = resolveEditTotalRadios(
          meta,
          meta.diffType,
          syncedTotalGrams,
          updateRowChoices.get(rowKey)?.total,
        );
        if (resolved.showRadios) {
          setUpdateRowChoices((prev) => {
            const next = new Map(prev);
            const current = next.get(rowKey) ?? {
              vendor: "live",
              total: "live",
            };
            next.set(rowKey, { ...current, total: resolved.displayChoice });
            return next;
          });
        }
      }
    }
    if (fetchItemId) {
      const specific =
        editRows?.find((r) => r.row_key === rowKey)?.specific_child ?? null;
      void fetchPuForItem(fetchItemId, specific).then((pu) => {
        updateEditRows((prev) =>
          prev.map((row) => {
            if (row.row_key !== rowKey) return row;
            const next: DraftRow = { ...row, puLoading: false };
            applyPuToRow(next, pu);
            return next;
          }),
        );
      });
    }
  };

  const resolvePuForItem = useCallback(
    (itemId: string, specificChild?: string | null): number | null => {
      const item = itemById.get(itemId);
      if (item?.item_kind === "raw" && !item.is_menu_item) {
        return puPerGramForRawVendorChoice(
          item,
          specificChild,
          catalogItems,
          vendorProducts,
          vendors,
          baseItems,
        );
      }
      return null;
    },
    [itemById, catalogItems, vendorProducts, vendors, baseItems],
  );

  const handleVendorChange = (
    rowKey: string,
    specificChild: string | null,
  ) => {
    const norm =
      !specificChild || specificChild === "lowest" ? "lowest" : specificChild;
    let preppedFetch: { itemId: string; cacheKey: string } | null = null;

    updateEditRows((prev) => {
      const idx = prev.findIndex((r) => r.row_key === rowKey);
      if (idx < 0) return prev;
      const row = prev[idx]!;
      const item = itemById.get(row.item_id);
      const vendorLabel = vendorSelectionLabelFromEdit(
        item,
        norm === "lowest" ? "lowest" : norm,
        vendorProducts,
      );
      const updated: DraftRow = {
        ...row,
        specific_child: norm === "lowest" ? "lowest" : norm,
        vendor_item: vendorLabel,
        puLoading: false,
      };

      if (item?.item_kind === "raw" && !item.is_menu_item) {
        const pu = resolvePuForItem(row.item_id, norm);
        applyPuToRow(updated, pu);
        const cacheKey = puCacheKey(row.item_id, norm);
        setCostCache((c) => new Map(c).set(cacheKey, pu));
      } else if (item) {
        updated.puLoading = true;
        preppedFetch = {
          itemId: row.item_id,
          cacheKey: puCacheKey(row.item_id, norm),
        };
      }

      const next = [...prev];
      next[idx] = updated;
      return next;
    });

    if (isEditUpdate && updateMetaByRowKey) {
      const meta = updateMetaByRowKey.get(rowKey);
      if (meta) {
        const resolved = resolveEditVendorRadios(
          meta,
          meta.diffType,
          norm,
          updateRowChoices.get(rowKey)?.vendor,
        );
        if (resolved.showRadios) {
          setUpdateRowChoices((prev) => {
            const next = new Map(prev);
            const current = next.get(rowKey) ?? {
              vendor: "live",
              total: "live",
            };
            next.set(rowKey, { ...current, vendor: resolved.displayChoice });
            return next;
          });
        }
      }
    }

    if (!preppedFetch) return;
    const { itemId, cacheKey } = preppedFetch;
    void fetchPuForItem(itemId, norm, { skipRawCache: true }).then((pu) => {
      setCostCache((c) => new Map(c).set(cacheKey, pu));
      updateEditRows((prev) =>
        prev.map((row) => {
          if (row.row_key !== rowKey) return row;
          const next: DraftRow = { ...row, puLoading: false };
          applyPuToRow(next, pu);
          return next;
        }),
      );
    }).catch(() => {
      updateEditRows((prev) =>
        prev.map((row) =>
          row.row_key === rowKey ? { ...row, puLoading: false } : row,
        ),
      );
    });
  };

  const handleFinalAmountChange = handleAmountChange;

  const updateEditRows = (updater: (prev: DraftRow[]) => DraftRow[]) => {
    setEditRows((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      const { hasUnpriced } = recomputeTotals(next);
      setEditHasUnpriced(hasUnpriced);
      return [...next];
    });
  };

  const handleRemoveRow = (rowKey: string) => {
    setPendingTrashIngredientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const updateEditLaborRows = (updater: (prev: LaborDraftRow[]) => LaborDraftRow[]) => {
    setEditLaborRows((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      const { hasUnpriced } = recomputeLaborTotals(next, laborRoles);
      setEditLaborHasUnpriced(hasUnpriced);
      return [...next];
    });
  };

  const handleLaborRoleChange = (rowKey: string, role: string) => {
    updateEditLaborRows((prev) =>
      prev.map((row) =>
        row.row_key === rowKey ? { ...row, labor_role: role } : row,
      ),
    );
  };

  const handleLaborMinutesChange = (rowKey: string, minutes: number) => {
    updateEditLaborRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        return {
          ...row,
          minutes,
          cost: laborCostFromWage(row.hourly_wage, minutes),
        };
      }),
    );
    if (isEditUpdate && laborUpdateMetaByRowKey) {
      const meta = laborUpdateMetaByRowKey.get(rowKey);
      if (meta) {
        const resolved = resolveEditMinutesRadios(
          meta,
          meta.diffType,
          minutes,
          laborUpdateRowChoices.get(rowKey)?.minutes,
        );
        if (resolved.showRadios) {
          setLaborUpdateRowChoices((prev) => {
            const next = new Map(prev);
            const current = next.get(rowKey) ?? { minutes: "live" };
            next.set(rowKey, {
              ...current,
              minutes: resolved.displayChoice,
            });
            return next;
          });
        }
      }
    }
  };

  const handleVendorChoiceChange = (rowKey: string, choice: PuChoice) => {
    setUpdateRowChoices((prev) => {
      const next = new Map(prev);
      const current = next.get(rowKey) ?? { vendor: "live", total: "live" };
      next.set(rowKey, { ...current, vendor: choice });
      return next;
    });
    if (!isEditUpdate) return;
    const meta = updateMetaByRowKey?.get(rowKey);
    if (!meta) return;
    const sc =
      choice === "live" ? meta.liveSpecificChild : meta.sheetSpecificChild;
    handleVendorChange(rowKey, sc);
  };

  const handleTotalChoiceChange = (rowKey: string, choice: PuChoice) => {
    setUpdateRowChoices((prev) => {
      const next = new Map(prev);
      const current = next.get(rowKey) ?? { vendor: "live", total: "live" };
      next.set(rowKey, { ...current, total: choice });
      return next;
    });
    if (!isEditUpdate) return;
    const meta = updateMetaByRowKey?.get(rowKey);
    if (!meta) return;
    const row = editRows?.find((r) => r.row_key === rowKey);
    if (!row) return;
    const pu =
      costCache.get(puCacheKey(row.item_id, row.specific_child)) ?? row.pu;
    updateEditRows((prev) =>
      prev.map((r) => {
        if (r.row_key !== rowKey) return r;
        return applyTotalChoiceToEditRow(
          r,
          meta,
          choice,
          itemById.get(r.item_id),
          baseItems,
          pu,
        );
      }),
    );
  };

  const handleLaborMinutesChoiceChange = (rowKey: string, choice: PuChoice) => {
    setLaborUpdateRowChoices((prev) => {
      const next = new Map(prev);
      const current = next.get(rowKey) ?? { minutes: "live" };
      next.set(rowKey, { ...current, minutes: choice });
      return next;
    });
    if (!isEditUpdate) return;
    const meta = laborUpdateMetaByRowKey?.get(rowKey);
    if (!meta) return;
    const minutes =
      (choice === "live" ? meta.liveMinutes : meta.sheetMinutes) ?? 0;
    handleLaborMinutesChange(rowKey, minutes);
  };

  const handleRemoveLaborRow = (rowKey: string) => {
    setPendingTrashLaborKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const handleAddLaborRow = () => {
    const rowKey = `new-${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`;
    const newRow: LaborDraftRow = {
      row_key: rowKey,
      labor_role: "",
      minutes: 0,
      hourly_wage: null,
      cost: null,
      isNew: true,
    };
    updateEditLaborRows((prev) => [...prev, newRow]);
    setLaborApplyModes((prev) => new Map(prev).set(rowKey, "overwrite"));
  };

  const handleIngredientApplyModeChange = (
    rowKey: string,
    mode: StandardSheetApplyMode,
  ) => {
    setIngredientApplyModes((prev) => new Map(prev).set(rowKey, mode));
  };

  const handleLaborApplyModeChange = (
    rowKey: string,
    mode: StandardSheetApplyMode,
  ) => {
    setLaborApplyModes((prev) => new Map(prev).set(rowKey, mode));
  };

  const fetchPuForItem = async (
    itemId: string,
    specificChild?: string | null,
    options?: { skipRawCache?: boolean },
  ): Promise<number | null> => {
    const cacheKey = puCacheKey(itemId, specificChild);
    const item = itemById.get(itemId);

    if (item?.item_kind === "raw" && !item.is_menu_item) {
      if (!options?.skipRawCache && costCache.has(cacheKey)) {
        return costCache.get(cacheKey) ?? null;
      }
      const pu = puPerGramForRawVendorChoice(
        item,
        specificChild,
        catalogItems,
        vendorProducts,
        vendors,
        baseItems,
      );
      setCostCache((prev) => new Map(prev).set(cacheKey, pu));
      return pu;
    }

    if (costCache.has(cacheKey)) return costCache.get(cacheKey) ?? null;

    try {
      const { costs } = await costAPI.getCostsBreakdownMissing([itemId]);
      const entry = costs[itemId];
      const pu =
        entry &&
        Number.isFinite(entry.total_cost_per_gram) &&
        entry.total_cost_per_gram > 0
          ? entry.total_cost_per_gram
          : null;
      setCostCache((prev) => new Map(prev).set(cacheKey, pu));
      return pu;
    } catch {
      setCostCache((prev) => new Map(prev).set(cacheKey, null));
      return null;
    }
  };

  const handleAddIngredientRow = () => {
    const stepKey = detail?.sheet.steps[0]?.step_key ?? "A";
    const rowKey = `new-${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`;
    const newRow: DraftRow = {
      row_key: rowKey,
      item_id: "",
      nature: "",
      vendor_item: "-",
      specific_child: null,
      quantity: 0,
      unit: "g",
      step_quantities: { [stepKey]: 0 },
      total: 0,
      pu: null,
      pt: null,
      isNew: true,
      pickerType: "raw",
    };
    updateEditRows((prev) => [...prev, newRow]);
    setIngredientApplyModes((prev) => new Map(prev).set(rowKey, "overwrite"));
  };

  const handleNewRowPickerTypeChange = (
    rowKey: string,
    type: IngredientPickerType,
  ) => {
    updateEditRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        return {
          ...row,
          pickerType: type,
          item_id: "",
          nature: "",
          specific_child: null,
          vendor_item: "-",
          pu: null,
          pt: null,
          puLoading: false,
          crossTenantOwnerFilter:
            type === "cross-tenant" ? row.crossTenantOwnerFilter : undefined,
        };
      }),
    );
  };

  const handleNewRowCrossTenantFilterChange = (
    rowKey: string,
    filter: string,
  ) => {
    updateEditRows((prev) =>
      prev.map((row) =>
        row.row_key === rowKey
          ? { ...row, crossTenantOwnerFilter: filter }
          : row,
      ),
    );
  };

  const applyItemToDraftRow = async (rowKey: string, itemId: string) => {
    const item = itemById.get(itemId);
    if (!item) return;

    const duplicate = editRows?.some(
      (r) => r.row_key !== rowKey && r.item_id === itemId,
    );
    if (duplicate) {
      alert("This ingredient is already in the sheet.");
      return;
    }

    const specific =
      item.item_kind === "raw" && !item.is_menu_item ? "lowest" : null;
    const newRowKey = snapshotRowKey(
      itemId,
      specific,
      item.item_kind === "prepped",
    );
    const vendorLabel = vendorSelectionLabelFromEdit(
      item,
      specific === "lowest" ? "lowest" : specific,
      vendorProducts,
    );

    updateEditRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        return {
          ...row,
          row_key: newRowKey,
          item_id: itemId,
          nature: getItemDisplayName(item, baseItems),
          specific_child: specific,
          vendor_item: vendorLabel,
          pickerType: deriveIngredientPickerType(
            itemId,
            pickerItems,
            crossTenantAvailableItems,
          ),
          isNew: true,
          pu: null,
          pt: null,
          puLoading: row.total > 0,
        };
      }),
    );
    setPendingTrashIngredientKeys((prev) =>
      migrateRowKeyInSet(prev, rowKey, newRowKey),
    );
    setIngredientApplyModes((prev) =>
      migrateRowKeyInApplyModes(prev, rowKey, newRowKey),
    );

    const grams = editRows?.find((r) => r.row_key === rowKey)?.total ?? 0;
    if (grams > 0) {
      const pu = await fetchPuForItem(itemId, specific);
      updateEditRows((prev) =>
        prev.map((row) => {
          if (row.row_key !== newRowKey) return row;
          const updated: DraftRow = { ...row, puLoading: false };
          applyPuToRow(updated, pu);
          return updated;
        }),
      );
    }
  };

  const handleNewRowItemSelect = (rowKey: string, itemId: string) => {
    if (!itemId) return;
    void applyItemToDraftRow(rowKey, itemId);
  };

  const handleSave = async (saveMode: StandardSheetSaveMode) => {
    if (!selectedVersionId || !editRows || !detail) return;

    const hasOverwrite =
      [...ingredientApplyModes.values()].some((m) => m === "overwrite") ||
      [...laborApplyModes.values()].some((m) => m === "overwrite");

    if (saveMode === "this_version" && !detail.is_latest && hasOverwrite) {
      const ok = window.confirm(
        "Saving will update the current recipe based on this past version's content. " +
          "The latest technical sheet may no longer match the recipe. Continue?",
      );
      if (!ok) return;
    }

    setSavePending(true);
    try {
      const includeIngredientRow = (r: DraftRow) => {
        if (!r.item_id || r.total <= 0) return false;
        const key = r.row_key;
        if (key && pendingTrashIngredientKeys.has(key)) return false;
        if (updateMetaByRowKey) {
          if (!key) return true;
          const meta = updateMetaByRowKey.get(key);
          if (meta?.diffType === "removed" && !restoredRemovedKeys.has(key)) {
            return false;
          }
        }
        return true;
      };
      const includeLaborRow = (r: LaborDraftRow) => {
        if (!r.labor_role.trim() || r.minutes <= 0) return false;
        if (pendingTrashLaborKeys.has(r.row_key)) return false;
        if (laborUpdateMetaByRowKey) {
          const meta = laborUpdateMetaByRowKey.get(r.row_key);
          if (
            meta?.diffType === "removed" &&
            !restoredRemovedLaborKeys.has(r.row_key)
          ) {
            return false;
          }
        }
        return true;
      };

      const excluded_ingredients: Array<{
        item_id: string;
        apply_mode: StandardSheetApplyMode;
      }> = [];
      if (updateMetaByRowKey) {
        for (const [rowKey, meta] of updateMetaByRowKey) {
          if (
            meta.diffType === "removed" &&
            !restoredRemovedKeys.has(rowKey)
          ) {
            excluded_ingredients.push({
              item_id: meta.child_item_id,
              apply_mode: "override",
            });
          }
        }
      }

      const liveIngredientChildIds = new Set(
        (recipeDiff?.live ?? []).map((line) => line.child_item_id),
      );
      for (const rowKey of pendingTrashIngredientKeys) {
        const row = editRows.find((r) => r.row_key === rowKey);
        if (!row?.item_id || !liveIngredientChildIds.has(row.item_id)) continue;
        if (excluded_ingredients.some((e) => e.item_id === row.item_id)) continue;
        excluded_ingredients.push({
          item_id: row.item_id,
          apply_mode: ingredientApplyModes.get(rowKey) ?? "overwrite",
        });
      }

      const excluded_labor: Array<{
        row_key: string;
        apply_mode: StandardSheetApplyMode;
      }> = [];
      if (laborUpdateMetaByRowKey) {
        for (const [rowKey, meta] of laborUpdateMetaByRowKey) {
          if (
            meta.diffType === "removed" &&
            !restoredRemovedLaborKeys.has(rowKey)
          ) {
            excluded_labor.push({
              row_key: rowKey,
              apply_mode: "override",
            });
          }
        }
      }

      const liveLaborRowKeys = new Set(
        (recipeDiff?.labor_live ?? []).map((line) => line.row_key),
      );
      for (const rowKey of pendingTrashLaborKeys) {
        if (!liveLaborRowKeys.has(rowKey)) continue;
        if (excluded_labor.some((e) => e.row_key === rowKey)) continue;
        excluded_labor.push({
          row_key: rowKey,
          apply_mode: laborApplyModes.get(rowKey) ?? "overwrite",
        });
      }

      const saved = await standardTechnicalSheetsAPI.saveSheet(
        selectedVersionId,
        {
          save_mode: saveMode,
          ingredient_rows: editRows.filter(includeIngredientRow).map((r) => {
            const meta = updateMetaByRowKey?.get(r.row_key);
            const item = r.item_id ? itemById.get(r.item_id) : undefined;
            const choiceNeeded = isIngredientApplyChoiceNeeded(
              meta?.diffType,
              meta,
              r,
              item,
              {
                isManualNewRow: meta == null && !r.item_id,
                isPendingNew: !r.item_id,
              },
            );
            return {
              item_id: r.item_id,
              total_grams: r.total,
              specific_child: r.specific_child ?? undefined,
              step_quantities: r.step_quantities,
              apply_mode: resolveIngredientApplyMode(
                r.row_key,
                choiceNeeded,
                ingredientApplyModes,
              ),
            };
          }),
          labor_rows: (editLaborRows ?? [])
            .filter(includeLaborRow)
            .map((r) => {
              const meta = laborUpdateMetaByRowKey?.get(r.row_key);
              const choiceNeeded = isLaborApplyChoiceNeeded(
                meta?.diffType,
                meta,
                r,
                { isNew: r.isNew },
              );
              return {
                ...(r.isNew ||
                r.row_key.startsWith("new-") ||
                r.row_key.startsWith("labor-swap:")
                  ? {}
                  : { row_key: r.row_key }),
                labor_role: r.labor_role.trim(),
                minutes: r.minutes,
                apply_mode: resolveLaborApplyMode(
                  r.row_key,
                  choiceNeeded,
                  laborApplyModes,
                ),
              };
            }),
          excluded_ingredients:
            excluded_ingredients.length > 0 ? excluded_ingredients : undefined,
          excluded_labor:
            excluded_labor.length > 0 ? excluded_labor : undefined,
          description: editDescription.trim() ? editDescription.trim() : null,
          procedure: editProcedure.trim() ? editProcedure.trim() : null,
        },
      );
      const v = await loadVersions();
      const match = v.find((x) => x.id === saved.id);
      const savedId = match?.id ?? saved.id;
      setSelectedVersionId(savedId);
      cancelEditUpdate();
      await loadDetail(savedId, priceMode);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      alert(message || "Failed to save technical sheet");
    } finally {
      setSavePending(false);
    }
  };

  const sheet = displaySheet;
  const modalClass = isDark
    ? "border-slate-700 bg-slate-900 text-slate-100"
    : "border-gray-200 bg-white text-gray-900";

  const btnSecondary = `rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark
      ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "bg-gray-200 text-gray-800 hover:bg-gray-300"
  }`;
  const btnPrimary =
    "rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnEdit =
    "rounded-lg bg-gray-600 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50";

  const showDiffBanner =
    !!detail?.has_recipe_diff &&
    !!detail?.is_latest &&
    viewMode === "sheet" &&
    !loading &&
    !sheetLoading &&
    !!sheet;

  return (
    <>
      <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/50 p-1.5">
        <div
          className={`flex h-[100vh] w-[100vw] max-w-none flex-col overflow-hidden rounded-xl border shadow-2xl ${modalClass}`}
          role="dialog"
        >
          <ModalHeader
            isDark={isDark}
            title={`Standard Technical Sheet — ${baseRecipeName}`}
            onClose={onClose}
          />

          <div
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-3 ${isDark ? "border-slate-700" : "border-gray-200"}`}
          >
            <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium">Version</label>
            <select
              value={selectedVersionId ?? ""}
              onChange={(e) => setSelectedVersionId(e.target.value || null)}
              disabled={
                loading ||
                versions.length === 0 ||
                isEditUpdate
              }
              className={`rounded border px-3 py-1.5 text-sm ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-300"}`}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number}
                  {v.is_latest ? " (latest)" : ""}
                </option>
              ))}
            </select>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {updateLoading ? null : isEditUpdate ? (
                <>
                  <button
                    type="button"
                    className={btnEdit}
                    disabled={savePending}
                    onClick={() => void handleSave("this_version")}
                  >
                    {savePending ? "Saving…" : "Save this version"}
                  </button>
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={savePending || !detail?.is_latest}
                    title={
                      !detail?.is_latest
                        ? "Only available when viewing the latest version"
                        : undefined
                    }
                    onClick={() => void handleSave("new_version")}
                  >
                    Save as new version
                  </button>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={cancelEditUpdate}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void openEditUpdate()}
                >
                  Edit/Update
                </button>
              )}
            </div>
          </div>

          {showDiffBanner ? <DiffBanner isDark={isDark} /> : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
            {loading || sheetLoading || !sheet || !detail ? (
              <LoadingBox isDark={isDark} />
            ) : (
              <>
                  {detail.has_unpriced_lines &&
                  (priceMode === "latest" || priceMode === "both") &&
                  viewMode === "sheet" &&
                  !priceLoading ? (
                    <UnpricedBanner isDark={isDark} />
                  ) : null}
                  <div
                    className={`grid grid-cols-2 gap-x-4 gap-y-2 rounded border p-4 text-sm ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold">Product:</span>{" "}
                      {sheet.product.name}
                    </div>
                    <p className={isDark ? "text-slate-300" : "text-gray-600"}>
                      <span className="font-semibold">Version created:</span>{" "}
                      {formatVersionCreatedAt(detail.created_at)}
                      <span className="ml-2 text-xs opacity-80">
                        (v{detail.version_number}
                        {detail.is_latest ? ", latest" : ""})
                      </span>
                    </p>
                  </div>
                <TechnicalSheetBody
                  sheet={sheet}
                  isDark={isDark}
                  description={displayDescription}
                  procedure={displayProcedure}
                  onDescriptionChange={
                    isEditUpdate ? setEditDescription : undefined
                  }
                  onProcedureChange={
                    isEditUpdate ? setEditProcedure : undefined
                  }
                  editRows={isEditUpdate ? editRows : null}
                  onAmountChange={
                    isEditUpdate ? handleAmountChange : undefined
                  }
                  onRemoveRow={
                    isEditUpdate ? handleRemoveRow : undefined
                  }
                  pickerItems={pickerItems}
                  baseItems={baseItems}
                  vendorProducts={vendorProducts}
                  vendors={vendors}
                  onVendorChange={
                    isEditUpdate ? handleVendorChange : undefined
                  }
                  hasUnpricedLines={
                    isEditUpdate
                      ? editHasUnpriced
                      : viewMode === "sheet" &&
                        detail.has_unpriced_lines &&
                        (priceMode === "latest" || priceMode === "both")
                  }
                  priceMode={viewMode === "sheet" ? priceMode : "latest"}
                  onPriceModeChange={
                    viewMode === "sheet" ? setPriceMode : undefined
                  }
                  snapshotPriceByRowKey={
                    viewMode === "sheet" ? snapshotPriceByRowKey : undefined
                  }
                  snapshotTotalCost={
                    viewMode === "sheet" ? snapshotTotalCost : undefined
                  }
                  priceLoading={viewMode === "sheet" ? priceLoading : false}
                  updateLoading={updateLoading}
                  updateMode={isEditUpdate}
                  updateEditMode={isEditUpdate}
                  updateMetaByRowKey={updateMetaByRowKey ?? undefined}
                  pairedRemovedKeys={
                    isEditUpdate ? pairedRemovedKeys : undefined
                  }
                  restoredRemovedKeys={
                    isEditUpdate ? restoredRemovedKeys : undefined
                  }
                  onRestoreRemoved={
                    showRestoreRemoved ? handleRestoreRemoved : undefined
                  }
                  pendingTrashKeys={
                    isEditUpdate ? pendingTrashIngredientKeys : undefined
                  }
                  updateRowChoices={updateRowChoices}
                  onVendorChoiceChange={
                    isEditUpdate ? handleVendorChoiceChange : undefined
                  }
                  onTotalChoiceChange={
                    isEditUpdate ? handleTotalChoiceChange : undefined
                  }
                  onFinalAmountChange={
                    isEditUpdate ? handleFinalAmountChange : undefined
                  }
                  ingredientApplyModes={
                    isEditUpdate ? ingredientApplyModes : undefined
                  }
                  onIngredientApplyModeChange={
                    isEditUpdate ? handleIngredientApplyModeChange : undefined
                  }
                  crossTenantAvailableItems={crossTenantAvailableItems}
                  onAddIngredientRow={
                    isEditUpdate ? handleAddIngredientRow : undefined
                  }
                  onNewRowPickerTypeChange={
                    isEditUpdate ? handleNewRowPickerTypeChange : undefined
                  }
                  onNewRowCrossTenantFilterChange={
                    isEditUpdate
                      ? handleNewRowCrossTenantFilterChange
                      : undefined
                  }
                  onNewRowItemSelect={
                    isEditUpdate ? handleNewRowItemSelect : undefined
                  }
                  laborRoles={laborRoles}
                  editLaborRows={isEditUpdate ? editLaborRows : null}
                  hasUnpricedLaborLines={
                    isEditUpdate
                      ? editLaborHasUnpriced
                      : viewMode === "sheet" &&
                        detail.has_unpriced_lines &&
                        (priceMode === "latest" || priceMode === "both")
                  }
                  laborUpdateMetaByRowKey={laborUpdateMetaByRowKey ?? undefined}
                  pairedRemovedLaborKeys={
                    isEditUpdate ? pairedRemovedLaborKeys : undefined
                  }
                  restoredRemovedLaborKeys={
                    isEditUpdate ? restoredRemovedLaborKeys : undefined
                  }
                  onRestoreRemovedLabor={
                    showRestoreRemoved ? handleRestoreRemovedLabor : undefined
                  }
                  pendingTrashLaborKeys={
                    isEditUpdate ? pendingTrashLaborKeys : undefined
                  }
                  laborUpdateRowChoices={laborUpdateRowChoices}
                  onLaborMinutesChoiceChange={
                    isEditUpdate ? handleLaborMinutesChoiceChange : undefined
                  }
                  onLaborRoleChange={
                    isEditUpdate ? handleLaborRoleChange : undefined
                  }
                  onLaborMinutesChange={
                    isEditUpdate ? handleLaborMinutesChange : undefined
                  }
                  onRemoveLaborRow={
                    isEditUpdate ? handleRemoveLaborRow : undefined
                  }
                  onAddLaborRow={
                    isEditUpdate ? handleAddLaborRow : undefined
                  }
                  laborApplyModes={isEditUpdate ? laborApplyModes : undefined}
                  onLaborApplyModeChange={
                    isEditUpdate ? handleLaborApplyModeChange : undefined
                  }
                  snapshotLaborCostByRowKey={
                    viewMode === "sheet" ? snapshotLaborCostByRowKey : undefined
                  }
                  snapshotLaborTotalCost={
                    viewMode === "sheet" ? snapshotLaborTotalCost : undefined
                  }
                />
                </>
              )}
          </div>
        </div>
      </div>
    </>
  );
}

function PriceModeRadio({
  priceMode,
  setPriceMode,
  isDark,
  disabled,
}: {
  priceMode: StandardTechnicalSheetPriceMode;
  setPriceMode: (m: StandardTechnicalSheetPriceMode) => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const labelClass = isDark ? "text-slate-300" : "text-gray-600";
  const options: { value: StandardTechnicalSheetPriceMode; label: string }[] = [
    { value: "latest", label: "Current" },
    { value: "snapshot", label: "Snapshot" },
    { value: "both", label: "Current(snapshot)" },
  ];

  return (
    <fieldset
      disabled={disabled}
      className={`m-0 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-0 p-0 ${disabled ? "opacity-50" : ""}`}
    >
      <legend className="sr-only">Price display mode</legend>
      {options.map(({ value, label }) => (
        <label
          key={value}
          className={`flex cursor-pointer items-center gap-1.5 text-xs ${labelClass}`}
        >
          <input
            type="radio"
            name="ts-price-mode"
            value={value}
            checked={priceMode === value}
            onChange={() => setPriceMode(value)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function ModalHeader({
  isDark,
  title,
  onClose,
}: {
  isDark: boolean;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between border-b px-6 py-4 ${isDark ? "border-slate-700" : "border-gray-200"}`}
    >
      <h3 className="text-lg font-semibold">{title}</h3>
      <button
        type="button"
        onClick={onClose}
        className={`rounded px-2 py-1 text-sm ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}
      >
        Close
      </button>
    </div>
  );
}

function LoadingBox({ isDark }: { isDark: boolean }) {
  return (
    <div
      className={`rounded border p-6 text-sm ${isDark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-gray-200 bg-gray-50 text-gray-600"}`}
    >
      Loading...
    </div>
  );
}

function DiffBanner({ isDark }: { isDark: boolean }) {
  return (
    <div
      className={`w-full shrink-0 px-6 py-3 text-sm ${
        isDark
          ? "border-b border-amber-900/50 bg-amber-950/70 text-amber-100"
          : "border-b border-amber-200 bg-amber-100 text-amber-950"
      }`}
    >
      This technical sheet differs from the current recipe.
    </div>
  );
}

function UnpricedBanner({ isDark }: { isDark: boolean }) {
  return (
    <div
      className={`rounded border px-4 py-3 text-sm ${isDark ? "border-slate-600 bg-slate-800 text-slate-300" : "border-gray-300 bg-gray-100 text-gray-700"}`}
    >
      Some lines could not be priced at current rates.
    </div>
  );
}
