/** Server-side invoicing amount helpers (mirrors frontend/lib/invoicingCalc.ts). */

const MASS_UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  lb: 453.592,
  oz: 28.3495,
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
  const gramsPerUnit = MASS_UNIT_TO_GRAMS[u];
  if (gramsPerUnit != null) {
    return (unitSize * gramsPerUnit) / 1000;
  }
  return 0;
}

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

const SUB_TOTAL_TOLERANCE = 0.02;

export function subTotalsMatch(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= SUB_TOTAL_TOLERANCE;
}

export function sanitizeDeliverySiteNameForInvoiceNumber(name: string): string {
  return name.trim().replace(/\s+/g, "");
}

export function formatInvoiceDateYymmdd(calendarYmd: string): string {
  const d = calendarYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error("invoice_date calendar date must be YYYY-MM-DD");
  }
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}${m}${day}`;
}

export async function allocateInvoiceNumber(
  tenantId: string,
  deliverySiteName: string,
  /** Calendar YYYY-MM-DD (user-selected date; time ignored for numbering). */
  invoiceCalendarYmd: string,
  fetchExisting: (prefix: string) => Promise<string[]>,
): Promise<string> {
  const sitePart = sanitizeDeliverySiteNameForInvoiceNumber(deliverySiteName);
  const yymmdd = formatInvoiceDateYymmdd(invoiceCalendarYmd);
  const base = `${sitePart}${yymmdd}`;
  const existing = await fetchExisting(base);
  if (existing.length === 0) return base;

  const numbers = new Set(existing);
  if (!numbers.has(base)) return base;

  let maxSuffix = 1;
  for (const num of numbers) {
    if (num === base) {
      maxSuffix = Math.max(maxSuffix, 1);
      continue;
    }
    const suffixMatch = num.match(new RegExp(`^${escapeRegExp(base)}-(\\d+)$`));
    if (suffixMatch) {
      maxSuffix = Math.max(maxSuffix, parseInt(suffixMatch[1], 10));
    }
  }
  return `${base}-${maxSuffix + 1}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
