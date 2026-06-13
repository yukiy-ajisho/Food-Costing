import { isPeriodCalendarLocked } from "./companyTimezone";

export type LedgerEntryType =
  | "order"
  | "payment"
  | "adjustment"
  | "closing_balance";

export type AdjustmentDirection = "decrease" | "increase";

export type LedgerRow = {
  id: string;
  date: string;
  amount: number | null;
  running_balance: number;
  type: LedgerEntryType;
  period?: string;
  adjustment_direction?: AdjustmentDirection | null;
};

export type ClosedPeriodEntry = {
  account_id: string;
  period: string;
};

export function dateToPeriod(date: string): string {
  return date.trim().slice(0, 7);
}

export function buildClosedPeriodSet(
  entries: ClosedPeriodEntry[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of entries) {
    const existing = map.get(entry.account_id) ?? new Set<string>();
    existing.add(entry.period);
    map.set(entry.account_id, existing);
  }
  return map;
}

export function periodEndDate(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) {
    throw new Error(`Invalid period: ${period}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid period: ${period}`);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, "0")}`;
}

export function latestClosedPeriod(
  closedByAccount: Map<string, Set<string>>,
  accountId: string,
): string | null {
  const periods = closedByAccount.get(accountId);
  if (!periods || periods.size === 0) return null;
  return [...periods].sort().at(-1) ?? null;
}

/** True when deleting this ledger date would change Balance tab current balance. */
export function ledgerEntryAffectsCurrentBalance(
  effectiveDate: string,
  closedByAccount: Map<string, Set<string>>,
  accountId: string,
): boolean {
  const latest = latestClosedPeriod(closedByAccount, accountId);
  if (!latest) return true;
  const cutoff = periodEndDate(latest);
  const date = effectiveDate.trim().slice(0, 10);
  return date > cutoff;
}

export function deleteBalanceImpactMessage(affectsCurrentBalance: boolean): string {
  return affectsCurrentBalance
    ? "The current balance will be updated."
    : "This won't change the current balance.";
}

export const NEW_ENTRY_DATE_BLOCKED_MESSAGE =
  "New entries cannot be added for this month.";

/** Mirrors backend assertAccountPeriodOpen for create flows. */
export function isAccountDateOpenForNewEntry(
  effectiveDate: string,
  closedByAccount: Map<string, Set<string>>,
  accountId: string,
  companyTimezone: string | null | undefined,
): boolean {
  const date = effectiveDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;

  const latest = latestClosedPeriod(closedByAccount, accountId);
  if (latest) {
    const cutoff = periodEndDate(latest);
    if (date <= cutoff) return false;
  }

  const period = dateToPeriod(date);
  const timeZone = companyTimezone?.trim();
  if (timeZone && isPeriodCalendarLocked(period, timeZone)) return false;
  return true;
}

export function isOrderLocked(
  order: {
    account_id?: string | null;
    order_created_date: string | null;
  },
  closedByAccount: Map<string, Set<string>>,
): boolean {
  if (!order.account_id || !order.order_created_date) return false;
  const period = dateToPeriod(order.order_created_date);
  return closedByAccount.get(order.account_id)?.has(period) ?? false;
}

export function isPaymentLocked(
  payment: {
    account_id: string;
    payment_date: string;
  },
  closedByAccount: Map<string, Set<string>>,
): boolean {
  const period = dateToPeriod(payment.payment_date);
  return closedByAccount.get(payment.account_id)?.has(period) ?? false;
}

export function ledgerTypeLabel(type: LedgerEntryType): string {
  if (type === "closing_balance") return "closing balance";
  return type;
}

export function paymentTypeLabel(type: "payment" | "adjustment"): string {
  return type;
}

export function formatLedgerAmount(
  type: LedgerEntryType,
  amount: number | null,
  formatCurrency: (value: number) => string,
  adjustmentDirection?: AdjustmentDirection | null,
): string {
  if (type === "closing_balance" || amount == null) return "—";
  if (type === "order") return `+${formatCurrency(amount)}`;
  if (type === "adjustment" && adjustmentDirection === "increase") {
    return `+${formatCurrency(amount)}`;
  }
  return `−${formatCurrency(amount)}`;
}

export function formatOrderAmount(
  type: LedgerEntryType,
  amount: number | null,
  formatCurrency: (value: number) => string,
): string {
  if (type === "closing_balance" || amount == null) return "—";
  if (type === "order") return `+${formatCurrency(amount)}`;
  return "—";
}

export function formatPaymentReceived(
  type: LedgerEntryType,
  amount: number | null,
  formatCurrency: (value: number) => string,
): string {
  if (type === "closing_balance" || amount == null) return "—";
  if (type === "payment") return `−${formatCurrency(amount)}`;
  return "—";
}

export function formatAdjustmentAmount(
  type: LedgerEntryType,
  amount: number | null,
  formatCurrency: (value: number) => string,
  adjustmentDirection?: AdjustmentDirection | null,
): string {
  if (type !== "adjustment" || amount == null) return "—";
  if (adjustmentDirection === "increase") {
    return `+${formatCurrency(amount)}`;
  }
  return `−${formatCurrency(amount)}`;
}
