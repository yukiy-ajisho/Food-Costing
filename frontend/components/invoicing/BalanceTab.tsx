"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  invoicingAPI,
  type BalanceLedgerResponse,
  type CompanyInvoicingAccount,
} from "@/lib/invoicing";
import { formatCurrency } from "@/lib/invoicingCalc";
import { formatInvoiceDateDisplay } from "@/lib/invoicingDateTime";
import {
  formatAdjustmentAmount,
  formatOrderAmount,
  formatPaymentReceived,
  ledgerTypeLabel,
} from "@/lib/invoicingLedger";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const formatted = formatInvoiceDateDisplay(value);
  return formatted || value;
}

export function BalanceTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [accounts, setAccounts] = useState<CompanyInvoicingAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [ledgerData, setLedgerData] = useState<BalanceLedgerResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const rowPanel = isDark ? "bg-slate-700/40" : "bg-gray-50";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thCls = `h-14 align-middle px-3 py-2 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700" : "text-gray-500 bg-gray-50"
  }`;
  const tdCls = "whitespace-nowrap px-3 py-2.5";
  const amountTdBase = `${tdCls} text-right tabular-nums`;
  const orderAmountTdCls = `${amountTdBase} pr-31`;
  const paymentReceivedTdCls = `${amountTdBase} pr-26`;
  const adjustmentTdCls = `${amountTdBase} pr-37`;
  const runningBalanceTdCls = `${amountTdBase} pr-27`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;

  const loadAccounts = useCallback(async () => {
    const data = await invoicingAPI.listPaymentAccounts();
    const list = data.accounts ?? [];
    setAccounts(list);
    return list;
  }, []);

  const loadLedger = useCallback(async (accountId: string) => {
    if (!accountId.trim()) {
      setLedgerData(null);
      return;
    }
    const data = await invoicingAPI.getBalanceLedger(accountId);
    setLedgerData(data);
  }, []);

  const reload = useCallback(
    async (preferredAccountId?: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await loadAccounts();
        const accountId =
          preferredAccountId &&
          list.some((account) => account.id === preferredAccountId)
            ? preferredAccountId
            : (list[0]?.id ?? "");
        setSelectedAccountId(accountId);
        if (accountId) {
          await loadLedger(accountId);
        } else {
          setLedgerData(null);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load balance");
      } finally {
        setLoading(false);
      }
    },
    [loadAccounts, loadLedger],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAccountChange = (accountId: string) => {
    setSelectedAccountId(accountId);
    if (!accountId.trim()) {
      setLedgerData(null);
      return;
    }
    setLoading(true);
    setError(null);
    void loadLedger(accountId)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load ledger");
      })
      .finally(() => setLoading(false));
  };

  const showScroll =
    !loading &&
    Boolean(ledgerData?.ledger.length) &&
    Boolean(selectedAccountId);

  return (
    <div className="flex flex-col">
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex w-full justify-center">
        <div className="flex w-full max-w-7xl flex-wrap items-stretch gap-3">
          <div
            className={`min-w-0 flex-1 rounded-lg border px-4 py-2 ${border} ${rowPanel}`}
          >
            <div className={`text-xs uppercase tracking-wide ${muted}`}>
              Account
            </div>
            <select
              value={selectedAccountId}
              onChange={(event) => handleAccountChange(event.target.value)}
              disabled={loading && accounts.length === 0}
              className={`mt-1 w-full rounded-md border px-2 py-1 text-sm ${
                isDark
                  ? "border-slate-600 bg-slate-800 text-slate-100"
                  : "border-gray-300 bg-white text-gray-900"
              }`}
            >
              {loading && accounts.length === 0 ? (
                <option value="">Loading…</option>
              ) : accounts.length === 0 ? (
                <option value="">No accounts</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.company_name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div
            className={`min-w-0 flex-1 rounded-lg border px-4 py-2 ${border} ${rowPanel}`}
          >
            <div className={`text-xs uppercase tracking-wide ${muted}`}>
              Current balance
            </div>
            <div
              className={`mt-1 text-right text-xl font-semibold tabular-nums ${textMain}`}
            >
              {ledgerData
                ? formatCurrency(Number(ledgerData.current_balance))
                : "—"}
            </div>
          </div>
        </div>
      </div>

      {!selectedAccountId && !loading ? (
        <div
          className={`rounded-lg border px-4 py-6 text-sm ${border} ${muted}`}
        >
          Select an account to see the running ledger.
        </div>
      ) : (
        <div className="flex w-full justify-center">
          <div
            className={`w-full max-w-7xl overflow-hidden rounded-lg border shadow-sm transition-colors ${border} ${panel} ${
              showScroll ? "max-h-[calc(100vh-16rem)] overflow-auto" : ""
            }`}
          >
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead
                className={`border-b ${border} ${showScroll ? "sticky top-0 z-10" : ""}`}
              >
                <tr>
                  <th className={`${thCls} text-left`}>Date</th>
                  <th className={`${thCls} text-left`}>Order Amount</th>
                  <th className={`${thCls} text-left`}>Payment Received</th>
                  <th className={`${thCls} text-left`}>Adjustment</th>
                  <th className={`${thCls} text-left`}>Running Balance</th>
                  <th className={`${thCls} text-left`}>Type</th>
                </tr>
              </thead>
              <tbody className={tbodyRowDividerCls}>
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className={`px-3 py-8 text-center ${muted}`}
                    >
                      Loading…
                    </td>
                  </tr>
                ) : !ledgerData?.ledger.length ? (
                  <tr>
                    <td
                      colSpan={6}
                      className={`px-3 py-8 text-center ${muted}`}
                    >
                      No ledger entries yet.
                    </td>
                  </tr>
                ) : (
                  ledgerData.ledger.map((row) => (
                    <tr key={row.id}>
                      <td className={`${tdCls} ${textMain}`}>
                        {formatDate(row.date)}
                      </td>
                      <td className={`${orderAmountTdCls} ${textMain}`}>
                        {formatOrderAmount(
                          row.type,
                          row.amount,
                          formatCurrency,
                        )}
                      </td>
                      <td className={`${paymentReceivedTdCls} ${textMain}`}>
                        {formatPaymentReceived(
                          row.type,
                          row.amount,
                          formatCurrency,
                        )}
                      </td>
                      <td className={`${adjustmentTdCls} ${textMain}`}>
                        {formatAdjustmentAmount(
                          row.type,
                          row.amount,
                          formatCurrency,
                          row.adjustment_direction,
                        )}
                      </td>
                      <td className={`${runningBalanceTdCls} ${textMain}`}>
                        {formatCurrency(Number(row.running_balance))}
                      </td>
                      <td className={`${tdCls} capitalize ${textMain}`}>
                        {ledgerTypeLabel(row.type)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
