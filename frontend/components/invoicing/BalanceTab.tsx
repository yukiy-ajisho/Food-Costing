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
  formatLedgerAmount,
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
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closing, setClosing] = useState(false);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const rowPanel = isDark ? "bg-slate-700/40" : "bg-gray-50";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thCls = `h-14 align-middle px-3 py-2 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700" : "text-gray-500 bg-gray-50"
  }`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;
  const btnPrimary =
    "inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnSecondary =
    "inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
    (isDark
      ? "border-slate-500 text-slate-100 hover:bg-slate-600"
      : "border-gray-300 text-gray-800 hover:bg-gray-50");

  const loadAccounts = useCallback(async () => {
    const data = await invoicingAPI.listPaymentAccounts();
    const list = data.accounts ?? [];
    setAccounts(list);
    setSelectedAccountId((prev) => {
      if (prev && list.some((account) => account.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, []);

  const loadLedger = useCallback(async (accountId: string) => {
    if (!accountId.trim()) {
      setLedgerData(null);
      return;
    }
    const data = await invoicingAPI.getBalanceLedger(accountId);
    setLedgerData(data);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadAccounts();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [loadAccounts]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedAccountId) {
      setLedgerData(null);
      return;
    }
    setLoading(true);
    setError(null);
    void loadLedger(selectedAccountId)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load ledger");
      })
      .finally(() => setLoading(false));
  }, [selectedAccountId, loadLedger]);

  const handleAccountChange = (accountId: string) => {
    setSelectedAccountId(accountId);
  };

  const handleCloseMonth = async () => {
    if (!ledgerData) return;
    setClosing(true);
    setError(null);
    try {
      await invoicingAPI.closeMonth(ledgerData.open_period);
      setShowCloseModal(false);
      await loadLedger(selectedAccountId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to close month");
    } finally {
      setClosing(false);
    }
  };

  const closeLabel = ledgerData
    ? `Close ${ledgerData.open_period_label}`
    : "Close month";

  const showScroll =
    !loading && Boolean(ledgerData?.ledger.length) && Boolean(selectedAccountId);

  return (
    <div className="flex flex-col">
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className={`text-lg font-semibold ${textMain}`}>Running Balance</div>
        <button
          type="button"
          className={btnPrimary}
          disabled={
            !ledgerData ||
            ledgerData.open_period_closed ||
            !selectedAccountId ||
            closing
          }
          onClick={() => setShowCloseModal(true)}
        >
          {closeLabel}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-stretch gap-3">
        <div
          className={`w-52 shrink-0 rounded-lg border px-3 py-2 ${border} ${rowPanel}`}
        >
          <div className={`text-xs uppercase tracking-wide ${muted}`}>
            Account
          </div>
          <select
            value={selectedAccountId}
            onChange={(event) => handleAccountChange(event.target.value)}
            disabled={accounts.length === 0}
            className={`mt-1 w-full rounded-md border px-2 py-1 text-sm ${
              isDark
                ? "border-slate-600 bg-slate-800 text-slate-100"
                : "border-gray-300 bg-white text-gray-900"
            }`}
          >
            {accounts.length === 0 ? (
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
          className={`w-40 shrink-0 rounded-lg border px-3 py-2 ${border} ${rowPanel}`}
        >
          <div className={`text-xs uppercase tracking-wide ${muted}`}>
            Current balance
          </div>
          <div className={`mt-1 text-base font-medium tabular-nums ${textMain}`}>
            {ledgerData
              ? formatCurrency(Number(ledgerData.current_balance))
              : "—"}
          </div>
        </div>
        <div
          className={`w-36 shrink-0 rounded-lg border px-3 py-2 ${border} ${rowPanel}`}
        >
          <div className={`text-xs uppercase tracking-wide ${muted}`}>Period</div>
          <div className={`mt-1 text-sm font-medium ${textMain}`}>
            {ledgerData?.open_period_label ?? "—"}
          </div>
          <div className={`mt-0.5 text-xs ${muted}`}>
            {ledgerData?.open_period_closed ? "closed" : "open"}
          </div>
        </div>
      </div>

      {!selectedAccountId ? (
        <div className={`rounded-lg border px-4 py-6 text-sm ${border} ${muted}`}>
          Select an account to see the running ledger.
        </div>
      ) : (
        <div
          className={`w-full overflow-hidden rounded-lg border shadow-sm transition-colors ${border} ${panel} ${
            showScroll ? "max-h-[calc(100vh-16rem)] overflow-auto" : ""
          }`}
        >
          <table className="w-full border-collapse text-sm">
            <thead
              className={`border-b ${border} ${showScroll ? "sticky top-0 z-10" : ""}`}
            >
              <tr>
                <th className={`${thCls} text-left`}>Date</th>
                <th className={`${thCls} text-right`}>Amount</th>
                <th className={`${thCls} text-right`}>Running Balance</th>
                <th className={`${thCls} text-left`}>Type</th>
              </tr>
            </thead>
            <tbody className={tbodyRowDividerCls}>
              {loading ? (
                <tr>
                  <td colSpan={4} className={`px-3 py-8 text-center ${muted}`}>
                    Loading…
                  </td>
                </tr>
              ) : !ledgerData?.ledger.length ? (
                <tr>
                  <td colSpan={4} className={`px-3 py-8 text-center ${muted}`}>
                    No ledger entries yet.
                  </td>
                </tr>
              ) : (
                ledgerData.ledger.map((row) => (
                  <tr key={row.id}>
                    <td className={`px-3 py-2.5 ${textMain}`}>
                      {formatDate(row.date)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${textMain}`}>
                      {formatLedgerAmount(row.type, row.amount, formatCurrency)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${textMain}`}>
                      {formatCurrency(Number(row.running_balance))}
                    </td>
                    <td className={`px-3 py-2.5 ${textMain}`}>
                      {ledgerTypeLabel(row.type)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCloseModal && ledgerData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={`w-full max-w-md rounded-lg border p-5 shadow-lg ${border} ${panel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-month-title"
          >
            <h3
              id="close-month-title"
              className={`text-base font-medium ${textMain}`}
            >
              Close {ledgerData.open_period_label}?
            </h3>
            <p className={`mt-2 text-sm ${muted}`}>
              Snapshots closing balance for every account. Locks orders and
              payments in {ledgerData.open_period_label}. Adds a closing balance
              row at the top of the next period.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className={`${btnSecondary} flex-1`}
                disabled={closing}
                onClick={() => setShowCloseModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${btnPrimary} flex-1`}
                disabled={closing}
                onClick={() => void handleCloseMonth()}
              >
                {closing ? "Closing…" : "Close month"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
