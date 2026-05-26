import type { CostBreakdown, ListMemberRow } from "./recipeCostReport";

export type CostDisplayUnit = "g" | "kg";

export type FormatCostDisplayOptions = {
  costUnit: CostDisplayUnit;
  eachMode: boolean;
  /** Pricing Strategy tab: menu rows use proceed yield as $/each when unit is g/kg. */
  menuPricingEach?: boolean;
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

/** List line + items: wholesale/retail stored as $/kg (Costing column behavior). */
export function isEachPriceRow(row: ListMemberRow): boolean {
  return (
    row.proceed_yield_unit === "each" &&
    row.each_grams != null &&
    row.each_grams > 0
  );
}

/** Grams per $/each on list pricing — each unit rows, or menu + g/kg on Pricing tab. */
export function eachGramsForListPricing(
  row: ListMemberRow,
  menuPricingEach: boolean,
): number | null {
  if (isEachPriceRow(row)) {
    return row.each_grams!;
  }
  if (!menuPricingEach || !row.is_menu_item) {
    return null;
  }
  const unit = (row.proceed_yield_unit || "g").toLowerCase();
  if (unit !== "g" && unit !== "kg") {
    return null;
  }
  const grams = yieldGrams(row);
  return grams > 0 ? grams : null;
}

export function listUsesEachDisplay(
  row: ListMemberRow,
  eachMode: boolean,
  menuPricingEach: boolean,
): boolean {
  return eachMode && eachGramsForListPricing(row, menuPricingEach) != null;
}

/** Convert edit draft / pending input when toggling each ↔ kg display. */
export function convertListPriceInputOnEachToggle(
  raw: string,
  row: ListMemberRow,
  fromEachMode: boolean,
  toEachMode: boolean,
  menuPricingEach: boolean,
): string {
  if (fromEachMode === toEachMode) return raw;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return raw;

  const eachGrams = eachGramsForListPricing(row, menuPricingEach);
  if (eachGrams == null) return raw;

  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return raw;

  if (!fromEachMode && toEachMode) {
    return String((n / 1000) * eachGrams);
  }
  return String((n / eachGrams) * 1000);
}

export function convertPriceDraftMapOnEachToggle(
  drafts: Map<string, string>,
  memberById: Map<string, ListMemberRow>,
  fromEachMode: boolean,
  toEachMode: boolean,
  menuPricingEach: boolean,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [itemId, raw] of drafts) {
    const row = memberById.get(itemId);
    if (!row) {
      next.set(itemId, raw);
      continue;
    }
    next.set(
      itemId,
      convertListPriceInputOnEachToggle(
        raw,
        row,
        fromEachMode,
        toEachMode,
        menuPricingEach,
      ),
    );
  }
  return next;
}

/** Display cost from breakdown $/g — mirrors Costing COG/LABOR/Cost column toggles. */
export function formatCostDisplay(
  row: ListMemberRow,
  breakdown: CostBreakdown | undefined,
  options: FormatCostDisplayOptions,
): string {
  if (!breakdown?.total_cost_per_gram) return "—";
  const perG = breakdown.total_cost_per_gram;
  const eachGrams = eachGramsForListPricing(
    row,
    options.menuPricingEach ?? false,
  );
  if (options.eachMode && eachGrams != null) {
    return `$${(perG * eachGrams).toFixed(2)}/each`;
  }
  if (options.costUnit === "g") {
    return `$${perG.toFixed(6)}/g`;
  }
  return `$${(perG * 1000).toFixed(2)}/kg`;
}

/** Input/display string from stored $/kg — eachMode + each row → $/each display (Costing). */
export function listPriceInputDisplay(
  storedPerKg: number | null | undefined,
  row: ListMemberRow,
  eachMode: boolean,
  menuPricingEach = false,
): string {
  if (storedPerKg == null || !Number.isFinite(storedPerKg)) return "";
  const eachGrams = eachGramsForListPricing(row, menuPricingEach);
  if (eachMode && eachGrams != null) {
    return String((storedPerKg / 1000) * eachGrams);
  }
  return String(storedPerKg);
}

/** Read-only price cell — respects each toggle like edit inputs. */
export function formatListPriceDisplay(
  storedPerKg: number | null | undefined,
  row: ListMemberRow,
  eachMode: boolean,
  menuPricingEach = false,
): string {
  if (storedPerKg == null || !Number.isFinite(storedPerKg)) return "—";
  const eachGrams = eachGramsForListPricing(row, menuPricingEach);
  if (eachMode && eachGrams != null) {
    const perEach = (storedPerKg / 1000) * eachGrams;
    return `$${perEach.toFixed(2)}/each`;
  }
  return `$${storedPerKg.toFixed(2)}/kg`;
}

/** Parse edited input back to stored $/kg for save + LCOG%. */
export function listPriceInputToStoredPerKg(
  raw: string,
  row: ListMemberRow,
  eachMode: boolean,
  menuPricingEach = false,
): number | null {
  if (raw === "" || raw === ".") return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const eachGrams = eachGramsForListPricing(row, menuPricingEach);
  if (eachMode && eachGrams != null) {
    return (n / eachGrams) * 1000;
  }
  return n;
}

/** Retail / wholesale list prices are stored as $/kg. */
export function pricePerGramFromRetailPerKg(retailPerKg: number): number | null {
  if (!Number.isFinite(retailPerKg) || retailPerKg <= 0) return null;
  return retailPerKg / 1000;
}

export function lcogPercentValue(
  breakdown: CostBreakdown | undefined,
  retailPerKg: number | null | undefined,
): number | null {
  if (retailPerKg == null || retailPerKg <= 0 || !breakdown) return null;
  const retailPg = pricePerGramFromRetailPerKg(retailPerKg);
  if (!retailPg || retailPg <= 0) return null;
  return (breakdown.total_cost_per_gram / retailPg) * 100;
}

export function lcogPercent(
  breakdown: CostBreakdown | undefined,
  retailPerKg: number | null | undefined,
): string {
  const pct = lcogPercentValue(breakdown, retailPerKg);
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}
