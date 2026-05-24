/** Vendor Items テーブル: 矢印キーでフォーカス移動（Tab は従来どおり） */

export const VENDOR_ITEMS_GRID_COLS = [
  "base_item",
  "vendor",
  "product",
  "brand",
  "case",
  "quantity",
  "unit",
  "case_unit",
  "unit_cost",
  "case_cost",
  "new_price",
] as const;

export type VendorItemsGridCol = (typeof VENDOR_ITEMS_GRID_COLS)[number];

type GridNavContext = {
  isEditModeItems: boolean;
  isRecordPriceModeItems: boolean;
};

type GridNavRow = {
  isNew?: boolean;
  case_unit?: number | null;
  isCaseMode?: boolean;
};

function rowIsCase(vp: GridNavRow): boolean {
  if (vp.isCaseMode !== undefined) return vp.isCaseMode;
  return vp.case_unit != null && vp.case_unit > 0;
}

/** セルがフォーカス可能か（表示条件と一致） */
export function isVendorItemsGridCellFocusable(
  col: VendorItemsGridCol,
  vp: GridNavRow,
  ctx: GridNavContext,
): boolean {
  const { isEditModeItems, isRecordPriceModeItems } = ctx;
  const isCase = rowIsCase(vp);
  const editableRow =
    isEditModeItems || (isRecordPriceModeItems && Boolean(vp.isNew));

  switch (col) {
    case "base_item":
      return editableRow && Boolean(vp.isNew);
    case "vendor":
    case "product":
    case "brand":
    case "quantity":
    case "unit":
      return editableRow;
    case "case":
      return isRecordPriceModeItems && Boolean(vp.isNew);
    case "case_unit":
      return isRecordPriceModeItems && Boolean(vp.isNew) && isCase;
    case "unit_cost":
      return isEditModeItems && Boolean(vp.isNew) && !isCase;
    case "case_cost":
      return isEditModeItems && Boolean(vp.isNew) && isCase;
    case "new_price":
      return isRecordPriceModeItems;
    default:
      return false;
  }
}

type Direction = "left" | "right" | "up" | "down";

export function findAdjacentVendorItemsGridCell(
  rowIndex: number,
  colId: VendorItemsGridCol,
  direction: Direction,
  rows: GridNavRow[],
  ctx: GridNavContext,
): { row: number; col: VendorItemsGridCol } | null {
  const colIndex = VENDOR_ITEMS_GRID_COLS.indexOf(colId);
  if (colIndex < 0 || rowIndex < 0 || rowIndex >= rows.length) return null;

  if (direction === "left") {
    for (let i = colIndex - 1; i >= 0; i--) {
      const col = VENDOR_ITEMS_GRID_COLS[i];
      if (isVendorItemsGridCellFocusable(col, rows[rowIndex], ctx)) {
        return { row: rowIndex, col };
      }
    }
    return null;
  }
  if (direction === "right") {
    for (let i = colIndex + 1; i < VENDOR_ITEMS_GRID_COLS.length; i++) {
      const col = VENDOR_ITEMS_GRID_COLS[i];
      if (isVendorItemsGridCellFocusable(col, rows[rowIndex], ctx)) {
        return { row: rowIndex, col };
      }
    }
    return null;
  }
  if (direction === "up") {
    for (let r = rowIndex - 1; r >= 0; r--) {
      if (isVendorItemsGridCellFocusable(colId, rows[r], ctx)) {
        return { row: r, col: colId };
      }
    }
    return null;
  }
  for (let r = rowIndex + 1; r < rows.length; r++) {
    if (isVendorItemsGridCellFocusable(colId, rows[r], ctx)) {
      return { row: r, col: colId };
    }
  }
  return null;
}

export function focusVendorItemsGridCell(
  row: number,
  col: VendorItemsGridCol,
): void {
  const el = document.querySelector<HTMLElement>(
    `[data-vi-row="${row}"][data-vi-col="${col}"]`,
  );
  el?.focus({ preventScroll: true });
}

export function vendorItemsGridCellDataAttrs(
  rowIndex: number,
  col: VendorItemsGridCol,
): { "data-vi-row": number; "data-vi-col": VendorItemsGridCol } {
  return { "data-vi-row": rowIndex, "data-vi-col": col };
}
