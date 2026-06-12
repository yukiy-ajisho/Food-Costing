import { supabase } from "../config/supabase";

export const CLOSING_BALANCE_COLUMNS =
  "id, company_id, account_id, period, closing_balance, closed_at, created_by";

export type ClosingBalanceRow = {
  id: string;
  company_id: string;
  account_id: string;
  period: string;
  closing_balance: number;
  closed_at: string;
  created_by: string | null;
};

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

type RawLedgerEvent = {
  id: string;
  date: string;
  delta: number;
  type: "order" | "payment" | "adjustment";
  sortKey: string;
};

export function dateToPeriod(date: string): string {
  return date.trim().slice(0, 7);
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

export function isValidPeriod(period: string): boolean {
  try {
    periodEndDate(period);
    return true;
  } catch {
    return false;
  }
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

export function buildRunningBalanceLedger(
  latestClosing: ClosingBalanceRow | null,
  events: RawLedgerEvent[],
): LedgerRow[] {
  const cutoff = latestClosing ? periodEndDate(latestClosing.period) : null;
  const filtered = cutoff
    ? events.filter((event) => event.date > cutoff)
    : events.slice();

  filtered.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.sortKey.localeCompare(b.sortKey);
  });

  const rows: LedgerRow[] = [];
  let running = latestClosing ? Number(latestClosing.closing_balance) : 0;

  if (latestClosing) {
    rows.push({
      id: latestClosing.id,
      date: latestClosing.closed_at.slice(0, 10),
      amount: null,
      running_balance: running,
      type: "closing_balance",
      period: latestClosing.period,
    });
  }

  for (const event of filtered) {
    running += event.delta;
    rows.push({
      id: event.id,
      date: event.date,
      amount: Math.abs(event.delta),
      running_balance: running,
      type: event.type,
    });
  }

  return rows;
}

export async function fetchCompanyTenantIds(
  companyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("company_tenants")
    .select("tenant_id")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.tenant_id);
}

export async function fetchDeliverySiteIdsForAccount(
  companyId: string,
  accountId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("delivery_sites")
    .select("id")
    .eq("company_id", companyId)
    .eq("account_id", accountId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id);
}

export async function fetchLatestClosingForAccount(
  companyId: string,
  accountId: string,
): Promise<ClosingBalanceRow | null> {
  const { data, error } = await supabase
    .from("closing_balance")
    .select(CLOSING_BALANCE_COLUMNS)
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .order("period", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function fetchClosedPeriodsForAccount(
  companyId: string,
  accountId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("closing_balance")
    .select("period")
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .order("period", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.period);
}

export async function isAccountPeriodClosed(
  companyId: string,
  accountId: string,
  period: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("closing_balance")
    .select("id")
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .eq("period", period)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function computeAccountBalanceThroughDate(
  companyId: string,
  accountId: string,
  throughDate: string,
  tenantIds: string[],
  siteIds: string[],
): Promise<number> {
  let ordersTotal = 0;
  if (tenantIds.length > 0 && siteIds.length > 0) {
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("total_amount")
      .in("tenant_id", tenantIds)
      .in("delivery_site_id", siteIds)
      .lte("order_created_date", throughDate);
    if (ordersErr) throw new Error(ordersErr.message);
    ordersTotal = (orders ?? []).reduce(
      (sum, row) => sum + Number(row.total_amount),
      0,
    );
  }

  const { data: payments, error: paymentsErr } = await supabase
    .from("payments")
    .select("amount, payment_date, created_at")
    .eq("company_id", companyId)
    .eq("account_id", accountId);
  if (paymentsErr) throw new Error(paymentsErr.message);

  const paymentsTotal = (payments ?? []).reduce((sum, row) => {
    const effective = paymentEffectiveDate(row.payment_date, row.created_at);
    if (effective > throughDate) return sum;
    return sum + Number(row.amount);
  }, 0);

  return ordersTotal - paymentsTotal;
}

async function fetchLedgerEventsForAccount(
  companyId: string,
  accountId: string,
  tenantIds: string[],
  siteIds: string[],
): Promise<RawLedgerEvent[]> {
  const events: RawLedgerEvent[] = [];

  if (tenantIds.length > 0 && siteIds.length > 0) {
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, order_created_date, total_amount, created_at")
      .in("tenant_id", tenantIds)
      .in("delivery_site_id", siteIds)
      .not("order_created_date", "is", null);
    if (ordersErr) throw new Error(ordersErr.message);

    for (const order of orders ?? []) {
      const date = String(order.order_created_date).slice(0, 10);
      events.push({
        id: order.id,
        date,
        delta: Number(order.total_amount),
        type: "order",
        sortKey: `order:${order.created_at}:${order.id}`,
      });
    }
  }

  const { data: payments, error: paymentsErr } = await supabase
    .from("payments")
    .select("id, amount, type, payment_date, created_at")
    .eq("company_id", companyId)
    .eq("account_id", accountId);
  if (paymentsErr) throw new Error(paymentsErr.message);

  for (const payment of payments ?? []) {
    const date = paymentEffectiveDate(payment.payment_date, payment.created_at);
    const amount = Number(payment.amount);
    const type =
      payment.type === "adjustment" ? "adjustment" : "payment";
    events.push({
      id: payment.id,
      date,
      delta: -amount,
      type,
      sortKey: `payment:${payment.created_at}:${payment.id}`,
    });
  }

  return events;
}

export async function buildAccountLedger(
  companyId: string,
  accountId: string,
): Promise<{
  rows: LedgerRow[];
  current_balance: number;
  latest_closing: ClosingBalanceRow | null;
}> {
  const tenantIds = await fetchCompanyTenantIds(companyId);
  const siteIds = await fetchDeliverySiteIdsForAccount(companyId, accountId);
  const latestClosing = await fetchLatestClosingForAccount(companyId, accountId);
  const events = await fetchLedgerEventsForAccount(
    companyId,
    accountId,
    tenantIds,
    siteIds,
  );
  const rows = buildRunningBalanceLedger(latestClosing, events);
  const current_balance =
    rows.length > 0
      ? rows[rows.length - 1].running_balance
      : latestClosing
        ? Number(latestClosing.closing_balance)
        : 0;

  return { rows, current_balance, latest_closing: latestClosing };
}

export async function assertAccountPeriodOpen(
  companyId: string,
  accountId: string,
  period: string,
): Promise<string | null> {
  if (!isValidPeriod(period)) {
    return "Invalid period";
  }
  const closed = await isAccountPeriodClosed(companyId, accountId, period);
  if (closed) {
    return `Period ${period} is closed for this account`;
  }
  return null;
}

export async function assertOrderDateOpen(
  companyId: string,
  deliverySiteId: string,
  orderCreatedDate: string,
): Promise<string | null> {
  const { data: site, error } = await supabase
    .from("delivery_sites")
    .select("account_id, company_id")
    .eq("id", deliverySiteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!site || site.company_id !== companyId) {
    return "Invalid delivery_site_id";
  }
  const period = dateToPeriod(orderCreatedDate);
  return assertAccountPeriodOpen(companyId, site.account_id, period);
}

export async function assertExistingOrderOpen(
  companyId: string,
  orderId: string,
  tenantIds: string[],
): Promise<string | null> {
  if (tenantIds.length === 0) {
    return "Order not found";
  }
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_created_date, delivery_site_id")
    .eq("id", orderId)
    .in("tenant_id", tenantIds)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return "Order not found";
  if (!order.order_created_date || !order.delivery_site_id) {
    return null;
  }
  return assertOrderDateOpen(
    companyId,
    order.delivery_site_id,
    String(order.order_created_date),
  );
}

export async function assertPaymentOpen(
  companyId: string,
  accountId: string,
  paymentDate: string | null | undefined,
  createdAt: string,
): Promise<string | null> {
  const effective = paymentEffectiveDate(paymentDate, createdAt);
  const period = dateToPeriod(effective);
  return assertAccountPeriodOpen(companyId, accountId, period);
}

export async function closeMonthForCompany(
  companyId: string,
  period: string,
  userId: string,
): Promise<{ closed_count: number }> {
  if (!isValidPeriod(period)) {
    throw new Error("Invalid period (expected YYYY-MM)");
  }

  const throughDate = periodEndDate(period);
  const tenantIds = await fetchCompanyTenantIds(companyId);

  const { data: accounts, error: accountsErr } = await supabase
    .from("invoicing_accounts")
    .select("id")
    .eq("company_id", companyId);
  if (accountsErr) throw new Error(accountsErr.message);

  const rows: {
    company_id: string;
    account_id: string;
    period: string;
    closing_balance: number;
    created_by: string;
  }[] = [];

  for (const account of accounts ?? []) {
    const alreadyClosed = await isAccountPeriodClosed(
      companyId,
      account.id,
      period,
    );
    if (alreadyClosed) {
      throw new Error(`Period ${period} is already closed for account ${account.id}`);
    }

    const siteIds = await fetchDeliverySiteIdsForAccount(
      companyId,
      account.id,
    );
    const balance = await computeAccountBalanceThroughDate(
      companyId,
      account.id,
      throughDate,
      tenantIds,
      siteIds,
    );

    rows.push({
      company_id: companyId,
      account_id: account.id,
      period,
      closing_balance: balance,
      created_by: userId,
    });
  }

  if (rows.length === 0) {
    return { closed_count: 0 };
  }

  const { error: insertErr } = await supabase
    .from("closing_balance")
    .insert(rows);
  if (insertErr) throw new Error(insertErr.message);

  return { closed_count: rows.length };
}

export function formatOpenPeriodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function currentCalendarPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function fetchCompanyClosedPeriods(
  companyId: string,
  accountId?: string,
): Promise<{ account_id: string; period: string }[]> {
  let query = supabase
    .from("closing_balance")
    .select("account_id, period")
    .eq("company_id", companyId)
    .order("period", { ascending: true });
  if (accountId) {
    query = query.eq("account_id", accountId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
