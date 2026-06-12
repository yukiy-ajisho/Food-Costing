import type { Payment } from "@/lib/invoicing";
import { formatInvoiceDateDisplay } from "@/lib/invoicingDateTime";

export type PaymentsSortKey =
  | "recorded"
  | "paymentDate"
  | "amount"
  | "accountName"
  | "type";

export type PaymentsSortState = {
  key: PaymentsSortKey;
  ascending: boolean;
};

export type PaymentsFilters = {
  recordedDateMin: string;
  recordedDateMax: string;
  paymentDateMin: string;
  paymentDateMax: string;
  amountMin: string;
  amountMax: string;
};

export const EMPTY_PAYMENTS_FILTERS: PaymentsFilters = {
  recordedDateMin: "",
  recordedDateMax: "",
  paymentDateMin: "",
  paymentDateMax: "",
  amountMin: "",
  amountMax: "",
};

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

export function paymentDateCalendarYmd(
  paymentDate: string | null | undefined,
): string | null {
  if (!paymentDate?.trim()) return null;
  const formatted = formatInvoiceDateDisplay(paymentDate);
  return formatted || paymentDate;
}

export function recordedCalendarYmd(
  createdAt: string | null | undefined,
): string | null {
  const formatted = formatInvoiceDateDisplay(createdAt);
  return formatted || null;
}

export function filterPaymentsRows(
  rows: Payment[],
  filters: PaymentsFilters,
): Payment[] {
  return rows.filter((row) => {
    if (
      !matchesDateRange(
        recordedCalendarYmd(row.created_at),
        filters.recordedDateMin,
        filters.recordedDateMax,
      )
    ) {
      return false;
    }
    if (
      !matchesDateRange(
        paymentDateCalendarYmd(row.payment_date),
        filters.paymentDateMin,
        filters.paymentDateMax,
      )
    ) {
      return false;
    }
    if (
      !matchesAmountRange(
        Number(row.amount),
        filters.amountMin,
        filters.amountMax,
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

export function sortPaymentsRows(
  rows: Payment[],
  sort: PaymentsSortState,
): Payment[] {
  const dir = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "recorded":
        cmp = compareStrings(
          recordedCalendarYmd(a.created_at) ?? "",
          recordedCalendarYmd(b.created_at) ?? "",
        );
        break;
      case "paymentDate":
        cmp = compareStrings(
          paymentDateCalendarYmd(a.payment_date) ?? "",
          paymentDateCalendarYmd(b.payment_date) ?? "",
        );
        break;
      case "amount":
        cmp = Number(a.amount) - Number(b.amount);
        break;
      case "accountName":
        cmp = compareStrings(a.account_name ?? "", b.account_name ?? "");
        break;
      case "type":
        cmp = compareStrings(a.type, b.type);
        break;
    }
    if (cmp !== 0) return dir * cmp;
    return compareStrings(a.created_at ?? "", b.created_at ?? "");
  });
}

export function nextPaymentsSortState(
  prev: PaymentsSortState,
  column: PaymentsSortKey,
): PaymentsSortState {
  return prev.key !== column
    ? { key: column, ascending: true }
    : { key: column, ascending: !prev.ascending };
}
