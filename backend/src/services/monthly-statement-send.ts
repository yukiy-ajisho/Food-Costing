import { uploadMonthlyStatementToR2 } from "../lib/r2-upload";
import { supabase } from "../config/supabase";
import { sendMonthlyStatementEmail } from "./email";
import { formatOpenPeriodLabel } from "./invoicing-ledger";
import { buildMonthlyStatementPdf } from "./monthly-statement-pdf";

export type MonthlyStatementSendOutcome = "sent" | "skipped" | "failed";

export async function sendMonthlyStatementForAccount(params: {
  companyId: string;
  sellerCompanyName: string;
  accountId: string;
  accountCompanyName: string;
  pocEmail: string | null | undefined;
  period: string;
  closingBalance: number;
}): Promise<MonthlyStatementSendOutcome> {
  const {
    companyId,
    sellerCompanyName,
    accountId,
    accountCompanyName,
    period,
    closingBalance,
  } = params;
  const pocEmail = params.pocEmail?.trim() ?? "";

  if (!pocEmail) {
    const { error } = await supabase.from("monthly_statements").upsert(
      {
        company_id: companyId,
        account_id: accountId,
        period,
        account_company_name: accountCompanyName,
        sent_to: null,
        closing_balance: closingBalance,
        r2_key: null,
        email_id: null,
        status: "skipped",
        error_message: "No poc_email on billing account",
        sent_at: null,
      },
      { onConflict: "company_id,account_id,period" },
    );
    if (error) throw new Error(error.message);
    return "skipped";
  }

  try {
    const periodLabel = formatOpenPeriodLabel(period);
    const pdfBytes = await buildMonthlyStatementPdf({
      accountCompanyName,
      period,
      periodLabel,
      closingBalance,
      sellerCompanyName,
    });
    const pdfBuffer = Buffer.from(pdfBytes);
    const r2Key = await uploadMonthlyStatementToR2(
      companyId,
      accountId,
      period,
      pdfBuffer,
    );
    const emailId = await sendMonthlyStatementEmail({
      to: pocEmail,
      accountCompanyName,
      periodLabel,
      closingBalance,
      pdfBase64: pdfBuffer.toString("base64"),
    });

    const { error } = await supabase.from("monthly_statements").upsert(
      {
        company_id: companyId,
        account_id: accountId,
        period,
        account_company_name: accountCompanyName,
        sent_to: pocEmail,
        closing_balance: closingBalance,
        r2_key: r2Key,
        email_id: emailId,
        status: "sent",
        error_message: null,
        sent_at: new Date().toISOString(),
      },
      { onConflict: "company_id,account_id,period" },
    );
    if (error) throw new Error(error.message);
    return "sent";
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const { error: upsertErr } = await supabase.from("monthly_statements").upsert(
      {
        company_id: companyId,
        account_id: accountId,
        period,
        account_company_name: accountCompanyName,
        sent_to: pocEmail,
        closing_balance: closingBalance,
        r2_key: null,
        email_id: null,
        status: "failed",
        error_message: message,
        sent_at: null,
      },
      { onConflict: "company_id,account_id,period" },
    );
    if (upsertErr) throw new Error(upsertErr.message);
    return "failed";
  }
}

export async function resendMonthlyStatement(
  companyId: string,
  statementId: string,
): Promise<{ status: MonthlyStatementSendOutcome; error_message?: string | null }> {
  const { data: statement, error: statementErr } = await supabase
    .from("monthly_statements")
    .select(
      "id, company_id, account_id, period, closing_balance, account_company_name",
    )
    .eq("id", statementId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (statementErr) throw new Error(statementErr.message);
  if (!statement) {
    throw new Error("Statement not found");
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("company_name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyErr) throw new Error(companyErr.message);
  if (!company?.company_name) {
    throw new Error("Company not found");
  }

  const { data: account, error: accountErr } = await supabase
    .from("invoicing_accounts")
    .select("company_name, poc_email")
    .eq("id", statement.account_id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (accountErr) throw new Error(accountErr.message);
  if (!account) {
    throw new Error("Billing account not found");
  }

  const status = await sendMonthlyStatementForAccount({
    companyId,
    sellerCompanyName: company.company_name,
    accountId: statement.account_id,
    accountCompanyName: account.company_name,
    pocEmail: account.poc_email,
    period: statement.period,
    closingBalance: Number(statement.closing_balance),
  });

  if (status === "failed") {
    const { data: updated } = await supabase
      .from("monthly_statements")
      .select("error_message")
      .eq("id", statementId)
      .maybeSingle();
    return { status, error_message: updated?.error_message ?? null };
  }

  return { status };
}
