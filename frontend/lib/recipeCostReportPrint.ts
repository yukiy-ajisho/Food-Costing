/** Print column presets and helpers for recipe cost report. */

export type PrintReportType = "wholesale" | "retail";

export const PRINT_COLUMN_KEYS = [
  "item",
  "type",
  "cost",
  "price",
  "lcog",
] as const;

export type PrintColumnKey = (typeof PRINT_COLUMN_KEYS)[number];

export type PrintColumnSelection = Record<PrintColumnKey, boolean>;

export type PrintPreset = {
  preset_slot: number;
  name: string;
  columns: PrintColumnSelection;
};

export const EMPTY_PRINT_COLUMNS: PrintColumnSelection = {
  item: false,
  type: false,
  cost: false,
  price: false,
  lcog: false,
};

export function pageModeToPrintReportType(
  pageMode: "wholesale" | "menu",
): PrintReportType {
  return pageMode === "wholesale" ? "wholesale" : "retail";
}

export function printReportTypeLabel(reportType: PrintReportType): string {
  return reportType === "wholesale" ? "Wholesale Costing" : "Pricing Strategy";
}

export function countSelectedPrintColumns(columns: PrintColumnSelection): number {
  return PRINT_COLUMN_KEYS.filter((k) => columns[k]).length;
}

export function printColumnLabel(
  key: PrintColumnKey,
  reportType: PrintReportType,
): string {
  switch (key) {
    case "item":
      return "Item";
    case "type":
      return "Type";
    case "cost":
      return "Cost";
    case "price":
      return reportType === "wholesale" ? "Wholesale" : "Retail";
    case "lcog":
      return "LCOG%";
    default:
      return key;
  }
}

export function nextAvailablePresetSlot(presets: PrintPreset[]): number | null {
  const used = new Set(presets.map((p) => p.preset_slot));
  for (let slot = 1; slot <= 4; slot++) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

export function columnsFromPreset(preset: PrintPreset | undefined): PrintColumnSelection {
  if (!preset) return { ...EMPTY_PRINT_COLUMNS };
  return { ...preset.columns };
}
