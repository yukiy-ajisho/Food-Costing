export type LedgerEntryType =
  | "order"
  | "payment"
  | "adjustment"
  | "closing_balance";

export type LedgerRow = {
  id: string;
  date: string;
  amount: number | null;
  running_balance: number;
  type: LedgerEntryType;
  period?: string;
};

export type ClosedPeriodEntry = {
  account_id: string;
  period: string;
};

export function dateToPeriod(date: string): string {
  return date.trim().slice(0, 7);
}

export function paymentEffectiveDate(
  paymentDate: string | null | undefined,
  createdAt: string,
): string {
  if (paymentDate?.trim()) {
    return paymentDate.trim().slice(0, 10);
  }
  return createdAt.trim().slice(0, 10);
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
    payment_date: string | null;
    created_at: string;
  },
  closedByAccount: Map<string, Set<string>>,
): boolean {
  const effective = paymentEffectiveDate(
    payment.payment_date,
    payment.created_at,
  );
  const period = dateToPeriod(effective);
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
): string {
  if (type === "closing_balance" || amount == null) return "—";
  if (type === "order") return `+${formatCurrency(amount)}`;
  return `−${formatCurrency(amount)}`;
}
