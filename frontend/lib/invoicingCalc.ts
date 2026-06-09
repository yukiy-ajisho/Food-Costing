import { MASS_UNIT_CONVERSIONS, MASS_UNITS_ORDERED } from "./constants";

export type InvoicingCostBreakdown = {
  food_cost_per_gram: number;
  labor_cost_per_gram: number;
  total_cost_per_gram: number;
};

export type InvoicingEachGramsContext = {
  is_menu_item: boolean;
  each_grams: number | null;
  proceed_yield_amount: number;
  proceed_yield_unit: string | null;
};

function proceedYieldToGrams(
  amount: number,
  unit: string | null,
  eachGrams: number | null,
): number {
  const a = amount || 0;
  if (a <= 0) return 0;
  const u = (unit || "g").toLowerCase();
  if (u === "kg") return a * 1000;
  if (u === "g") return a;
  if (u === "each") {
    const each = eachGrams ?? 0;
    return a * (each > 0 ? each : 1);
  }
  return a;
}

/**
 * Grams represented by one "each" for unit_size_unit=each.
 * Prepped: each_grams only. Menu: each_grams, or finish yield (g/kg) like Pricing Strategy.
 */
export function eachGramsForInvoicing(
  row: InvoicingEachGramsContext,
): number | null {
  if (row.each_grams != null && row.each_grams > 0) {
    return row.each_grams;
  }
  if (!row.is_menu_item) {
    return null;
  }
  const unit = (row.proceed_yield_unit || "g").toLowerCase();
  if (unit !== "g" && unit !== "kg") {
    return null;
  }
  const grams = proceedYieldToGrams(
    row.proceed_yield_amount,
    unit,
    row.each_grams,
  );
  return grams > 0 ? grams : null;
}

/** Build cost map from wholesale list members (preview while editing list). */
export function costsFromWholesaleMembers(
  members: Array<{
    item_id: string;
    latest_wholesale_price: number | null;
  }>,
  itemIds?: string[],
): Record<string, InvoicingCostBreakdown> {
  const allowed =
    itemIds != null ? new Set(itemIds) : null;
  const costs: Record<string, InvoicingCostBreakdown> = {};
  for (const m of members) {
    if (allowed && !allowed.has(m.item_id)) continue;
    const pricePerKg = m.latest_wholesale_price;
    if (
      pricePerKg == null ||
      !Number.isFinite(pricePerKg) ||
      pricePerKg <= 0
    ) {
      continue;
    }
    const perGram = pricePerKg / 1000;
    costs[m.item_id] = {
      food_cost_per_gram: perGram,
      labor_cost_per_gram: 0,
      total_cost_per_gram: perGram,
    };
  }
  return costs;
}

export function costPerKgFromBreakdown(
  breakdown: InvoicingCostBreakdown | undefined,
): number | null {
  if (!breakdown?.total_cost_per_gram) return null;
  return breakdown.total_cost_per_gram * 1000;
}

export function formatCostPerKg(
  breakdown: InvoicingCostBreakdown | undefined,
): string {
  const perKg = costPerKgFromBreakdown(breakdown);
  if (perKg == null) return "—";
  return `$${perKg.toFixed(2)}/kg`;
}

/** Cost column display — eachMode toggles $/kg vs $/each (display only; subtotals unchanged). */
export function formatInvoicingCostDisplay(
  breakdown: InvoicingCostBreakdown | undefined,
  row: InvoicingEachGramsContext,
  eachMode: boolean,
): string {
  if (!breakdown?.total_cost_per_gram) return "—";
  const eachGrams = eachGramsForInvoicing(row);
  if (eachMode && eachGrams != null) {
    return `$${(breakdown.total_cost_per_gram * eachGrams).toFixed(2)}/each`;
  }
  return formatCostPerKg(breakdown);
}

/** Invoicing unit_size_unit options — each when grams/each can be resolved (§4-5-2). */
export function getInvoicingUnitOptions(
  row: InvoicingEachGramsContext,
): string[] {
  const units = [...MASS_UNITS_ORDERED];
  if (eachGramsForInvoicing(row) != null) {
    units.push("each");
  }
  return units;
}

/** Convert unit_size (1 unit's amount) to kilograms. */
export function unitSizeAmountToKg(
  unitSize: number,
  unit: string,
  eachGrams: number | null,
): number {
  if (!Number.isFinite(unitSize) || unitSize <= 0) return 0;
  const u = unit.trim().toLowerCase();
  if (u === "kg") return unitSize;
  if (u === "g") return unitSize / 1000;
  if (u === "each") {
    if (!eachGrams || eachGrams <= 0) return 0;
    return (unitSize * eachGrams) / 1000;
  }
  const gramsPerUnit = MASS_UNIT_CONVERSIONS[u];
  if (gramsPerUnit != null) {
    return (unitSize * gramsPerUnit) / 1000;
  }
  return 0;
}

/** Sub tot = total mass (kg) × cost ($/kg). */
export function computeInvoicingSubTotal(
  unitSize: number,
  unitSizeUnit: string,
  units: number,
  costPerKg: number,
  eachGrams: number | null,
): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  const kgPerUnitSize = unitSizeAmountToKg(unitSize, unitSizeUnit, eachGrams);
  return kgPerUnitSize * units * costPerKg;
}

export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toFixed(2)}`;
}
