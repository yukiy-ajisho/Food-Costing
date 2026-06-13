import {
  currentCalendarPeriodInTz,
  getCompanyTimezone,
  isPeriodCalendarLocked,
  shiftPeriod,
} from "../lib/company-timezone";
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

type RawLedgerEvent = {
  id: string;
  date: string;
  delta: number;
  type: "order" | "payment" | "adjustment";
  sortKey: string;
  adjustment_direction?: AdjustmentDirection | null;
};

/** Signed ledger delta for a payment row (amount is always positive in DB). */
export function paymentLedgerDelta(
  type: string,
  amount: number,
  adjustmentDirection: string | null | undefined,
): number {
  const n = Number(amount);
  if (type === "adjustment" && adjustmentDirection === "increase") {
    return n;
  }
  return -n;
}

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

/** Ledger period date from payments.payment_date (required calendar date). */
export function paymentEffectiveDate(paymentDate: string): string {
  return paymentDate.trim().slice(0, 10);
}

/** Current balance: closing snapshot plus any activity after the closed period end. */
export function computeCurrentBalanceFromEvents(
  latestClosing: ClosingBalanceRow | null,
  events: RawLedgerEvent[],
): number {
  if (!latestClosing) {
    return events.reduce((sum, event) => sum + event.delta, 0);
  }
  const cutoff = periodEndDate(latestClosing.period);
  const postCloseDelta = events
    .filter((event) => event.date > cutoff)
    .reduce((sum, event) => sum + event.delta, 0);
  return Number(latestClosing.closing_balance) + postCloseDelta;
}

export function buildRunningBalanceLedger(
  latestClosing: ClosingBalanceRow | null,
  events: RawLedgerEvent[],
): LedgerRow[] {
  const sorted = events.slice();
  sorted.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.sortKey.localeCompare(b.sortKey);
  });

  const cutoff = latestClosing ? periodEndDate(latestClosing.period) : null;
  const closingBalance = latestClosing ? Number(latestClosing.closing_balance) : 0;

  const rows: LedgerRow[] = [];
  let historicalRunning = 0;
  let postCloseRunning = closingBalance;

  for (const event of sorted) {
    if (cutoff && event.date > cutoff) {
      postCloseRunning += event.delta;
      rows.push({
        id: event.id,
        date: event.date,
        amount: Math.abs(event.delta),
        running_balance: postCloseRunning,
        type: event.type,
        adjustment_direction:
          event.type === "adjustment"
            ? event.adjustment_direction ?? null
            : null,
      });
    } else {
      historicalRunning += event.delta;
      rows.push({
        id: event.id,
        date: event.date,
        amount: Math.abs(event.delta),
        running_balance: historicalRunning,
        type: event.type,
        adjustment_direction:
          event.type === "adjustment"
            ? event.adjustment_direction ?? null
            : null,
      });
    }
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
    .select("amount, type, adjustment_direction, payment_date")
    .eq("company_id", companyId)
    .eq("account_id", accountId);
  if (paymentsErr) throw new Error(paymentsErr.message);

  const paymentsNet = (payments ?? []).reduce((sum, row) => {
    const effective = paymentEffectiveDate(String(row.payment_date));
    if (effective > throughDate) return sum;
    return (
      sum +
      paymentLedgerDelta(
        String(row.type),
        Number(row.amount),
        row.adjustment_direction,
      )
    );
  }, 0);

  return ordersTotal + paymentsNet;
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
    .select("id, amount, type, adjustment_direction, payment_date, created_at")
    .eq("company_id", companyId)
    .eq("account_id", accountId);
  if (paymentsErr) throw new Error(paymentsErr.message);

  for (const payment of payments ?? []) {
    const date = paymentEffectiveDate(String(payment.payment_date));
    const amount = Number(payment.amount);
    const type =
      payment.type === "adjustment" ? "adjustment" : "payment";
    const adjustment_direction =
      type === "adjustment"
        ? (payment.adjustment_direction as AdjustmentDirection | null) ??
          "decrease"
        : null;
    events.push({
      id: payment.id,
      date,
      delta: paymentLedgerDelta(type, amount, adjustment_direction),
      type,
      sortKey: `payment:${payment.created_at}:${payment.id}`,
      adjustment_direction,
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
  const current_balance = computeCurrentBalanceFromEvents(latestClosing, events);

  return { rows, current_balance, latest_closing: latestClosing };
}

export async function assertAccountPeriodOpen(
  companyId: string,
  accountId: string,
  effectiveDate: string,
): Promise<string | null> {
  const date = effectiveDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "Invalid date";
  }
  const period = dateToPeriod(date);
  if (!isValidPeriod(period)) {
    return "Invalid period";
  }

  const latestClosing = await fetchLatestClosingForAccount(companyId, accountId);
  if (latestClosing) {
    const cutoff = periodEndDate(latestClosing.period);
    if (date <= cutoff) {
      return `Period ${period} is closed for this account`;
    }
  }

  const timeZone = await getCompanyTimezone(companyId);
  if (isPeriodCalendarLocked(period, timeZone)) {
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
  return assertAccountPeriodOpen(companyId, site.account_id, orderCreatedDate);
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
  paymentDate: string,
): Promise<string | null> {
  return assertAccountPeriodOpen(
    companyId,
    accountId,
    paymentEffectiveDate(paymentDate),
  );
}

export async function closeAccountPeriod(
  companyId: string,
  accountId: string,
  period: string,
  createdBy: string | null,
): Promise<{ inserted: boolean; closing_balance: number | null }> {
  if (!isValidPeriod(period)) {
    throw new Error("Invalid period (expected YYYY-MM)");
  }

  const alreadyClosed = await isAccountPeriodClosed(
    companyId,
    accountId,
    period,
  );
  if (alreadyClosed) {
    return { inserted: false, closing_balance: null };
  }

  const throughDate = periodEndDate(period);
  const tenantIds = await fetchCompanyTenantIds(companyId);
  const siteIds = await fetchDeliverySiteIdsForAccount(companyId, accountId);
  const balance = await computeAccountBalanceThroughDate(
    companyId,
    accountId,
    throughDate,
    tenantIds,
    siteIds,
  );

  const { error: insertErr } = await supabase.from("closing_balance").insert({
    company_id: companyId,
    account_id: accountId,
    period,
    closing_balance: balance,
    created_by: createdBy,
  });
  if (insertErr) throw new Error(insertErr.message);

  return { inserted: true, closing_balance: balance };
}

export async function closeMonthForCompany(
  companyId: string,
  period: string,
  userId: string,
): Promise<{ closed_count: number }> {
  if (!isValidPeriod(period)) {
    throw new Error("Invalid period (expected YYYY-MM)");
  }

  const { data: accounts, error: accountsErr } = await supabase
    .from("invoicing_accounts")
    .select("id")
    .eq("company_id", companyId);
  if (accountsErr) throw new Error(accountsErr.message);

  let closed_count = 0;
  for (const account of accounts ?? []) {
    const result = await closeAccountPeriod(
      companyId,
      account.id,
      period,
      userId,
    );
    if (result.inserted) {
      closed_count += 1;
    }
  }

  return { closed_count };
}

export function formatOpenPeriodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** @deprecated Use currentCalendarPeriodForCompany for company-scoped open period. */
export function currentCalendarPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function currentCalendarPeriodForCompany(
  companyId: string,
): Promise<string> {
  const timeZone = await getCompanyTimezone(companyId);
  return currentCalendarPeriodInTz(timeZone);
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

  const seen = new Set<string>();
  const result: { account_id: string; period: string }[] = [];

  for (const row of data ?? []) {
    const key = `${row.account_id}:${row.period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  const timeZone = await getCompanyTimezone(companyId);
  const currentPeriod = currentCalendarPeriodInTz(timeZone);
  const calendarLockedPeriod = shiftPeriod(currentPeriod, -1);
  if (isPeriodCalendarLocked(calendarLockedPeriod, timeZone)) {
    let accountsQuery = supabase
      .from("invoicing_accounts")
      .select("id")
      .eq("company_id", companyId);
    if (accountId) {
      accountsQuery = accountsQuery.eq("id", accountId);
    }
    const { data: accounts, error: accountsErr } = await accountsQuery;
    if (accountsErr) throw new Error(accountsErr.message);

    for (const account of accounts ?? []) {
      const key = `${account.id}:${calendarLockedPeriod}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        account_id: account.id,
        period: calendarLockedPeriod,
      });
    }
  }

  result.sort((a, b) => {
    const byPeriod = a.period.localeCompare(b.period);
    if (byPeriod !== 0) return byPeriod;
    return a.account_id.localeCompare(b.account_id);
  });

  return result;
}
