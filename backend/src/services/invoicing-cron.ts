import { previousMonthPeriodInTz } from "../lib/company-timezone";
import { supabase } from "../config/supabase";
import {
  accountQualifiesForAutoClose,
  closeAccountPeriod,
  isAccountPeriodClosed,
} from "./invoicing-ledger";
import {
  accountNeedsAutoClose,
  accountNeedsStatementWork,
} from "./invoicing-cron-logic";
import { sendMonthlyStatementForAccount } from "./monthly-statement-send";

export type InvoicingHourlyJobResult = {
  ok: boolean;
  skipped: boolean;
  closed_count: number;
  statements_sent: number;
  statements_skipped: number;
  errors: string[];
};

type CompanyRow = { id: string; company_name: string; timezone: string | null };
type AccountRow = {
  id: string;
  company_name: string;
  poc_email: string | null;
  send_monthly_statement: boolean;
};
type ClosingRow = {
  company_id: string;
  account_id: string;
  period: string;
  closing_balance: number;
};
type StatementRow = {
  company_id: string;
  account_id: string;
  period: string;
  status: string;
};

async function fetchAllCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id, company_name, timezone");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchAccountsForCompany(
  companyId: string,
): Promise<AccountRow[]> {
  const { data, error } = await supabase
    .from("invoicing_accounts")
    .select("id, company_name, poc_email, send_monthly_statement")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchClosingRowsForPeriod(
  companyId: string,
  period: string,
): Promise<ClosingRow[]> {
  const { data, error } = await supabase
    .from("closing_balance")
    .select("company_id, account_id, period, closing_balance")
    .eq("company_id", companyId)
    .eq("period", period);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function fetchStatementForAccountPeriod(
  companyId: string,
  accountId: string,
  period: string,
): Promise<StatementRow | null> {
  const { data, error } = await supabase
    .from("monthly_statements")
    .select("company_id, account_id, period, status")
    .eq("company_id", companyId)
    .eq("account_id", accountId)
    .eq("period", period)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function statementNeedsSend(row: StatementRow | null): boolean {
  return accountNeedsStatementWork(true, true, row?.status);
}

async function accountHasActivityForAutoClose(
  companyId: string,
  accountId: string,
  period: string,
): Promise<boolean> {
  return accountQualifiesForAutoClose(companyId, accountId, period);
}

function companyInvoicingTimezone(company: CompanyRow): string | null {
  const tz = company.timezone?.trim();
  return tz || null;
}

export async function hasInvoicingCronPendingWork(): Promise<boolean> {
  const companies = await fetchAllCompanies();
  for (const company of companies) {
    const timeZone = companyInvoicingTimezone(company);
    if (!timeZone) continue;
    const period = previousMonthPeriodInTz(timeZone);
    const accounts = await fetchAccountsForCompany(company.id);

    for (const account of accounts) {
      const closed = await isAccountPeriodClosed(
        company.id,
        account.id,
        period,
      );
      const hasActivity = closed
        ? true
        : await accountHasActivityForAutoClose(
            company.id,
            account.id,
            period,
          );
      if (
        accountNeedsAutoClose(closed, hasActivity)
      ) {
        return true;
      }
      if (
        accountNeedsStatementWork(
          closed,
          account.send_monthly_statement,
          (await fetchStatementForAccountPeriod(
            company.id,
            account.id,
            period,
          ))?.status,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export async function runInvoicingHourlyJob(): Promise<InvoicingHourlyJobResult> {
  const pending = await hasInvoicingCronPendingWork();
  if (!pending) {
    return {
      ok: true,
      skipped: true,
      closed_count: 0,
      statements_sent: 0,
      statements_skipped: 0,
      errors: [],
    };
  }

  const companies = await fetchAllCompanies();
  let closed_count = 0;
  let statements_sent = 0;
  let statements_skipped = 0;
  const errors: string[] = [];

  for (const company of companies) {
    const timeZone = companyInvoicingTimezone(company);
    if (!timeZone) continue;
    const period = previousMonthPeriodInTz(timeZone);
    const accounts = await fetchAccountsForCompany(company.id);

    for (const account of accounts) {
      try {
        const qualifies = await accountHasActivityForAutoClose(
          company.id,
          account.id,
          period,
        );
        if (!qualifies) {
          continue;
        }
        const closeResult = await closeAccountPeriod(
          company.id,
          account.id,
          period,
          null,
        );
        if (closeResult.inserted) {
          closed_count += 1;
        }
      } catch (e: unknown) {
        errors.push(
          `close ${company.id}/${account.id}/${period}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    const closings = await fetchClosingRowsForPeriod(company.id, period);
    const closingByAccount = new Map(
      closings.map((row) => [row.account_id, row]),
    );

    for (const account of accounts) {
      const closing = closingByAccount.get(account.id);
      if (!closing) continue;
      if (!account.send_monthly_statement) continue;

      const existing = await fetchStatementForAccountPeriod(
        company.id,
        account.id,
        period,
      );
      if (!statementNeedsSend(existing)) {
        continue;
      }

      try {
        const outcome = await sendMonthlyStatementForAccount({
          companyId: company.id,
          sellerCompanyName: company.company_name,
          accountId: account.id,
          accountCompanyName: account.company_name,
          pocEmail: account.poc_email,
          period,
          closingBalance: Number(closing.closing_balance),
        });
        if (outcome === "sent") statements_sent += 1;
        if (outcome === "skipped") statements_skipped += 1;
      } catch (e: unknown) {
        errors.push(
          `statement ${company.id}/${account.id}/${period}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    skipped: false,
    closed_count,
    statements_sent,
    statements_skipped,
    errors,
  };
}
