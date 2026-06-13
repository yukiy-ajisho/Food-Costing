/** Pure helpers for hourly invoicing cron pending/close decisions. */

export function accountNeedsAutoClose(
  periodClosed: boolean,
  hasLedgerActivityThroughPeriodEnd: boolean,
): boolean {
  if (periodClosed) return false;
  return hasLedgerActivityThroughPeriodEnd;
}

export function accountNeedsStatementWork(
  periodClosed: boolean,
  sendMonthlyStatement: boolean,
  statementStatus: string | null | undefined,
): boolean {
  if (!periodClosed || !sendMonthlyStatement) return false;
  if (!statementStatus) return true;
  return statementStatus === "failed";
}
