import type { BoxInvoiceSummary } from "@/lib/invoicing";
import { invoiceDateCalendarYmd } from "@/lib/invoicingDateTime";

export type InvoiceBoxSortKey =
  | "date"
  | "companyName"
  | "amount"
  | "deliverySite"
  | "sent";

export type InvoiceBoxSortState = {
  key: InvoiceBoxSortKey;
  ascending: boolean;
};

export type InvoiceBoxRangeFilters = {
  dateMin: string;
  dateMax: string;
  amountMin: string;
  amountMax: string;
  sentMin: string;
  sentMax: string;
};

export type InvoiceBoxSelectFilters = {
  companyName: string;
  deliverySite: string;
};

export type InvoiceBoxFilters = InvoiceBoxRangeFilters & InvoiceBoxSelectFilters;

export const EMPTY_INVOICE_BOX_FILTERS: InvoiceBoxFilters = {
  dateMin: "",
  dateMax: "",
  amountMin: "",
  amountMax: "",
  sentMin: "",
  sentMax: "",
  companyName: "",
  deliverySite: "",
};

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function sentCalendarDate(
  sentAt: string | null | undefined,
): string | null {
  if (!sentAt) return null;
  const d = new Date(sentAt);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function matchesDateRange(
  value: string | null | undefined,
  min: string,
  max: string,
): boolean {
  const hasMin = min.trim() !== "";
  const hasMax = max.trim() !== "";
  if (!hasMin && !hasMax) return true;
  if (!value) return false;
  if (hasMin && value < min) return false;
  if (hasMax && value > max) return false;
  return true;
}

function matchesAmountRange(
  value: number,
  minRaw: string,
  maxRaw: string,
): boolean {
  const min = parseAmount(minRaw);
  const max = parseAmount(maxRaw);
  if (min == null && max == null) return true;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function matchesSentRange(
  sentAt: string | null | undefined,
  min: string,
  max: string,
): boolean {
  const hasMin = min.trim() !== "";
  const hasMax = max.trim() !== "";
  if (!hasMin && !hasMax) return true;
  const cal = sentCalendarDate(sentAt);
  if (!cal) return false;
  if (hasMin && cal < min) return false;
  if (hasMax && cal > max) return false;
  return true;
}

export function filterInvoiceBoxRows(
  rows: BoxInvoiceSummary[],
  filters: InvoiceBoxFilters,
): BoxInvoiceSummary[] {
  return rows.filter((row) => {
    if (
      !matchesDateRange(
        invoiceDateCalendarYmd(row.invoice_date),
        filters.dateMin,
        filters.dateMax,
      )
    ) {
      return false;
    }
    if (
      filters.companyName &&
      (row.company_name ?? "") !== filters.companyName
    ) {
      return false;
    }
    if (
      !matchesAmountRange(
        Number(row.total_amount),
        filters.amountMin,
        filters.amountMax,
      )
    ) {
      return false;
    }
    if (filters.deliverySite && row.delivery_site_name !== filters.deliverySite) {
      return false;
    }
    if (!matchesSentRange(row.sent_at, filters.sentMin, filters.sentMax)) {
      return false;
    }
    return true;
  });
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortInvoiceBoxRows(
  rows: BoxInvoiceSummary[],
  sort: InvoiceBoxSortState,
): BoxInvoiceSummary[] {
  const dir = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "date":
        cmp = compareStrings(a.invoice_date ?? "", b.invoice_date ?? "");
        break;
      case "companyName":
        cmp = compareStrings(a.company_name ?? "", b.company_name ?? "");
        break;
      case "amount":
        cmp = Number(a.total_amount) - Number(b.total_amount);
        break;
      case "deliverySite":
        cmp = compareStrings(
          a.delivery_site_name ?? "",
          b.delivery_site_name ?? "",
        );
        break;
      case "sent": {
        const aSent = sentCalendarDate(a.sent_at) ?? "";
        const bSent = sentCalendarDate(b.sent_at) ?? "";
        cmp = compareStrings(aSent, bSent);
        break;
      }
    }
    if (cmp !== 0) return dir * cmp;
    return compareStrings(a.invoice_number, b.invoice_number);
  });
}

export function uniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim() !== ""))].sort((a, b) =>
    compareStrings(a, b),
  );
}

export function nextInvoiceBoxSortState(
  prev: InvoiceBoxSortState,
  column: InvoiceBoxSortKey,
): InvoiceBoxSortState {
  return prev.key !== column
    ? { key: column, ascending: true }
    : { key: column, ascending: !prev.ascending };
}

export function minAmountAfter(minRaw: string): string | undefined {
  const min = parseAmount(minRaw);
  if (min == null) return undefined;
  return String(min + 0.01);
}

export function maxAmountBefore(maxRaw: string): string | undefined {
  const max = parseAmount(maxRaw);
  if (max == null) return undefined;
  return String(max - 0.01);
}
