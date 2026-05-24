import type { CostBreakdown, ListMemberRow } from "./recipeCostReport";

export type CostDisplayUnit = "g" | "kg";

export type FormatCostDisplayOptions = {
  costUnit: CostDisplayUnit;
  eachMode: boolean;
};

export function yieldGrams(row: ListMemberRow): number {
  const amount = row.proceed_yield_amount || 0;
  const unit = (row.proceed_yield_unit || "g").toLowerCase();
  if (amount <= 0) return 0;
  if (unit === "kg") return amount * 1000;
  if (unit === "g") return amount;
  if (unit === "each") {
    const each = row.each_grams ?? 0;
    return amount * (each > 0 ? each : 1);
  }
  return amount;
}

/** Display cost from breakdown $/g — mirrors Costing COG/LABOR/Cost column toggles. */
export function formatCostDisplay(
  row: ListMemberRow,
  breakdown: CostBreakdown | undefined,
  options: FormatCostDisplayOptions,
): string {
  if (!breakdown?.total_cost_per_gram) return "—";
  const perG = breakdown.total_cost_per_gram;
  if (
    options.eachMode &&
    row.proceed_yield_unit === "each" &&
    row.each_grams &&
    row.each_grams > 0
  ) {
    return `$${(perG * row.each_grams).toFixed(2)}/each`;
  }
  if (options.costUnit === "g") {
    return `$${perG.toFixed(6)}/g`;
  }
  return `$${(perG * 1000).toFixed(2)}/kg`;
}

/** List line + items: wholesale/retail stored as $/kg (Costing column behavior). */
export function isEachPriceRow(row: ListMemberRow): boolean {
  return (
    row.proceed_yield_unit === "each" &&
    row.each_grams != null &&
    row.each_grams > 0
  );
}

/** Input/display string from stored $/kg — eachMode + each row → $/each display (Costing). */
export function listPriceInputDisplay(
  storedPerKg: number | null | undefined,
  row: ListMemberRow,
  eachMode: boolean,
): string {
  if (storedPerKg == null || !Number.isFinite(storedPerKg)) return "";
  if (eachMode && isEachPriceRow(row)) {
    return String((storedPerKg / 1000) * row.each_grams!);
  }
  return String(storedPerKg);
}

/** Parse edited input back to stored $/kg for save + LCOG%. */
export function listPriceInputToStoredPerKg(
  raw: string,
  row: ListMemberRow,
  eachMode: boolean,
): number | null {
  if (raw === "" || raw === ".") return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (eachMode && isEachPriceRow(row)) {
    return (n / row.each_grams!) * 1000;
  }
  return n;
}

/** Retail / wholesale list prices are stored as $/kg. */
export function pricePerGramFromRetailPerKg(retailPerKg: number): number | null {
  if (!Number.isFinite(retailPerKg) || retailPerKg <= 0) return null;
  return retailPerKg / 1000;
}

export function lcogPercent(
  breakdown: CostBreakdown | undefined,
  retailPerKg: number | null | undefined,
): string {
  if (retailPerKg == null || retailPerKg <= 0 || !breakdown) return "—";
  const retailPg = pricePerGramFromRetailPerKg(retailPerKg);
  if (!retailPg || retailPg <= 0) return "—";
  const pct = (breakdown.total_cost_per_gram / retailPg) * 100;
  return `${pct.toFixed(1)}%`;
}
