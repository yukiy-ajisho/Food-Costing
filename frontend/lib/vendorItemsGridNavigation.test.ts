import {
  findAdjacentVendorItemsGridCell,
  isVendorItemsGridCellFocusable,
  VENDOR_ITEMS_GRID_COLS,
} from "./vendorItemsGridNavigation";

const editCtx = { isEditModeItems: true, isRecordPriceModeItems: false };
const recordCtx = { isEditModeItems: false, isRecordPriceModeItems: true };

describe("isVendorItemsGridCellFocusable", () => {
  const existing = { isNew: false, case_unit: null as number | null };
  const draftNonCase = { isNew: true, case_unit: null, isCaseMode: false };
  const draftCase = { isNew: true, case_unit: 12, isCaseMode: true };

  it("edit existing row: vendor through unit only", () => {
    for (const col of VENDOR_ITEMS_GRID_COLS) {
      const focusable = isVendorItemsGridCellFocusable(col, existing, editCtx);
      expect(focusable).toBe(
        ["vendor", "product", "brand", "quantity", "unit"].includes(col),
      );
    }
  });

  it("edit new non-case row: includes base_item and unit_cost", () => {
    expect(isVendorItemsGridCellFocusable("base_item", draftNonCase, editCtx)).toBe(
      true,
    );
    expect(isVendorItemsGridCellFocusable("unit_cost", draftNonCase, editCtx)).toBe(
      true,
    );
    expect(isVendorItemsGridCellFocusable("case_cost", draftNonCase, editCtx)).toBe(
      false,
    );
    expect(isVendorItemsGridCellFocusable("new_price", draftNonCase, editCtx)).toBe(
      false,
    );
  });

  it("edit new case row: case_cost not unit_cost", () => {
    expect(isVendorItemsGridCellFocusable("case_cost", draftCase, editCtx)).toBe(
      true,
    );
    expect(isVendorItemsGridCellFocusable("unit_cost", draftCase, editCtx)).toBe(
      false,
    );
  });

  it("record existing row: new_price only", () => {
    expect(isVendorItemsGridCellFocusable("new_price", existing, recordCtx)).toBe(
      true,
    );
    expect(isVendorItemsGridCellFocusable("vendor", existing, recordCtx)).toBe(false);
  });

  it("record new case row: case toggle and case_unit", () => {
    expect(isVendorItemsGridCellFocusable("case", draftCase, recordCtx)).toBe(true);
    expect(isVendorItemsGridCellFocusable("case_unit", draftCase, recordCtx)).toBe(
      true,
    );
    expect(isVendorItemsGridCellFocusable("vendor", draftCase, recordCtx)).toBe(true);
  });
});

describe("findAdjacentVendorItemsGridCell", () => {
  const rows = [
    { isNew: true, case_unit: null, isCaseMode: false },
    { isNew: false, case_unit: null },
    { isNew: false, case_unit: null },
  ];

  it("edit: right from product skips non-focusable to quantity on draft row", () => {
    const next = findAdjacentVendorItemsGridCell(0, "product", "right", rows, editCtx);
    expect(next).toEqual({ row: 0, col: "brand" });
  });

  it("edit: down from vendor on row 0 lands on row 1 when focusable", () => {
    const next = findAdjacentVendorItemsGridCell(0, "vendor", "down", rows, editCtx);
    expect(next).toEqual({ row: 1, col: "vendor" });
  });

  it("record: up from new_price on row 1 moves to row 0 new_price", () => {
    const recordRows = [
      { isNew: false, case_unit: null },
      { isNew: false, case_unit: null },
    ];
    const next = findAdjacentVendorItemsGridCell(
      1,
      "new_price",
      "up",
      recordRows,
      recordCtx,
    );
    expect(next).toEqual({ row: 0, col: "new_price" });
  });
});
