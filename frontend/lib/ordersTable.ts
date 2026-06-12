import type { OrderSummary } from "@/lib/invoicing";
import {
  formatInvoiceDateDisplay,
  orderCreatedDateCalendarYmd,
} from "@/lib/invoicingDateTime";

export type OrdersSortKey =
  | "date"
  | "companyName"
  | "amount"
  | "deliverySite"
  | "sent";

export type OrdersSortState = {
  key: OrdersSortKey;
  ascending: boolean;
};

export type OrdersRangeFilters = {
  dateMin: string;
  dateMax: string;
  amountMin: string;
  amountMax: string;
  sentMin: string;
  sentMax: string;
};

export type OrdersSelectFilters = {
  companyName: string;
  deliverySite: string;
};

export type OrdersFilters = OrdersRangeFilters & OrdersSelectFilters;

export const EMPTY_ORDERS_FILTERS: OrdersFilters = {
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
  sentDate: string | null | undefined,
): string | null {
  const formatted = formatInvoiceDateDisplay(sentDate);
  return formatted || null;
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

export function filterOrdersRows(
  rows: OrderSummary[],
  filters: OrdersFilters,
): OrderSummary[] {
  return rows.filter((row) => {
    if (
      !matchesDateRange(
        orderCreatedDateCalendarYmd(row.order_created_date),
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
    if (
      !matchesSentRange(
        row.first_invoice_sent_at,
        filters.sentMin,
        filters.sentMax,
      )
    ) {
      return false;
    }
    return true;
  });
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortOrdersRows(
  rows: OrderSummary[],
  sort: OrdersSortState,
): OrderSummary[] {
  const dir = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "date":
        cmp = compareStrings(
          a.order_created_date ?? "",
          b.order_created_date ?? "",
        );
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
        const aSent = sentCalendarDate(a.first_invoice_sent_at) ?? "";
        const bSent = sentCalendarDate(b.first_invoice_sent_at) ?? "";
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

export function nextOrdersSortState(
  prev: OrdersSortState,
  column: OrdersSortKey,
): OrdersSortState {
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
