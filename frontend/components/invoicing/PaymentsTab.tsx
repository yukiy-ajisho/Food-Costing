"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  invoicingAPI,
  type CompanyInvoicingAccount,
  type Payment,
} from "@/lib/invoicing";
import { formatCurrency } from "@/lib/invoicingCalc";
import { formatInvoiceDateDisplay } from "@/lib/invoicingDateTime";
import {
  buildClosedPeriodSet,
  deleteBalanceImpactMessage,
  ledgerEntryAffectsCurrentBalance,
  paymentTypeLabel,
} from "@/lib/invoicingLedger";
import {
  EMPTY_PAYMENTS_FILTERS,
  filterPaymentsRows,
  nextPaymentsSortState,
  sortPaymentsRows,
  type PaymentsFilters,
  type PaymentsSortKey,
  type PaymentsSortState,
} from "@/lib/paymentsTable";
import { uniqueSortedValues } from "@/lib/ordersTable";
import { ConfirmModal } from "@/components/ConfirmModal";
import { OrdersHeaderFilter } from "./OrdersHeaderFilter";
import { OrdersHeaderRangeFilter } from "./OrdersHeaderRangeFilter";
import { RecordPaymentModal } from "./RecordPaymentModal";

const DEFAULT_SORT: PaymentsSortState = { key: "recorded", ascending: false };

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const formatted = formatInvoiceDateDisplay(value);
  return formatted || "—";
}

function formatOptionalDate(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  return formatInvoiceDateDisplay(value) || value;
}

const ALL_ACCOUNTS = "";

export function PaymentsTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [accounts, setAccounts] = useState<CompanyInvoicingAccount[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(ALL_ACCOUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Payment | null>(null);
  const [filters, setFilters] = useState<PaymentsFilters>(EMPTY_PAYMENTS_FILTERS);
  const [sort, setSort] = useState<PaymentsSortState>(DEFAULT_SORT);
  const [closedByAccount, setClosedByAccount] = useState<
    Map<string, Set<string>>
  >(new Map());

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
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
  const tableColSpan = 7;
  const btnPrimary =
    "inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

  const accountNameOptions = useMemo(
    () => uniqueSortedValues(accounts.map((account) => account.company_name)),
    [accounts],
  );

  const selectedAccountName = useMemo(() => {
    if (!selectedAccountId) return "";
    return (
      accounts.find((account) => account.id === selectedAccountId)
        ?.company_name ?? ""
    );
  }, [accounts, selectedAccountId]);

  const visiblePayments = useMemo(() => {
    const filtered = filterPaymentsRows(payments, filters);
    return sortPaymentsRows(filtered, sort);
  }, [payments, filters, sort]);

  const loadAccounts = useCallback(async () => {
    const data = await invoicingAPI.listPaymentAccounts();
    setAccounts(data.accounts ?? []);
  }, []);

  const loadPayments = useCallback(async (accountId: string) => {
    const data = await invoicingAPI.listPayments(
      accountId.trim() ? accountId : undefined,
    );
    setPayments(data.payments ?? []);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const closedData = await invoicingAPI.listClosedPeriods();
      setClosedByAccount(buildClosedPeriodSet(closedData.closed_periods ?? []));
      await loadAccounts();
      await loadPayments(selectedAccountId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [loadAccounts, loadPayments, selectedAccountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestDelete = (payment: Payment) => {
    setDeleteConfirm(payment);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeletingId(deleteConfirm.id);
    setError(null);
    try {
      await invoicingAPI.deletePayment(deleteConfirm.id);
      setDeleteConfirm(null);
      await loadPayments(selectedAccountId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete payment");
    } finally {
      setDeletingId(null);
    }
  };

  const showScroll = !loading && payments.length > 0;

  const patchFilters = (patch: Partial<PaymentsFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleSortClick = (column: PaymentsSortKey) => {
    setSort((prev) => nextPaymentsSortState(prev, column));
  };

  const renderSortButton = (column: PaymentsSortKey, label: string) => {
    const active = sort.key === column;
    const asc = sort.ascending;
    const iconMuted = isDark ? "text-slate-500" : "text-gray-400";
    const iconActive = isDark ? "text-slate-100" : "text-gray-800";
    return (
      <button
        type="button"
        onClick={() => handleSortClick(column)}
        className={`inline-flex shrink-0 items-center gap-0.5 normal-case tracking-normal ${
          isDark ? "hover:text-slate-100" : "hover:text-gray-800"
        }`}
      >
        <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wider">
          {label}
        </span>
        {active ? (
          asc ? (
            <ChevronUp className={`h-3.5 w-3.5 shrink-0 ${iconActive}`} />
          ) : (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${iconActive}`} />
          )
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${iconMuted}`} />
        )}
      </button>
    );
  };

  const handleAccountFilterChange = (companyName: string) => {
    if (!companyName.trim()) {
      setSelectedAccountId(ALL_ACCOUNTS);
      return;
    }
    const account = accounts.find(
      (row) => row.company_name === companyName.trim(),
    );
    setSelectedAccountId(account?.id ?? ALL_ACCOUNTS);
  };

  return (
    <div className="flex flex-col">
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex justify-start">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => setShowRecordModal(true)}
          disabled={accounts.length === 0}
        >
          <Plus className="h-4 w-4 shrink-0" />
          Record Entry
        </button>
      </div>

      <div
        className={`w-full overflow-hidden rounded-lg border shadow-sm transition-colors ${border} ${panel} ${
          showScroll ? "max-h-[calc(100vh-12rem)] overflow-auto" : ""
        }`}
      >
        <table className="w-full border-collapse text-sm">
          <thead
            className={`border-b ${border} ${showScroll ? "sticky top-0 z-10" : ""}`}
          >
            <tr>
              <th className={`${thCls} text-left min-w-40`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("accountName", "Account")}
                  <OrdersHeaderFilter
                    isDark={isDark}
                    value={selectedAccountName}
                    onChange={handleAccountFilterChange}
                    options={accountNameOptions}
                    ariaLabel="Filter by account"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("recorded", "Recorded Date")}
                  <OrdersHeaderRangeFilter
                    isDark={isDark}
                    kind="date"
                    min={filters.recordedDateMin}
                    max={filters.recordedDateMax}
                    onChange={(recordedDateMin, recordedDateMax) =>
                      patchFilters({ recordedDateMin, recordedDateMax })
                    }
                    ariaLabel="Filter by recorded date"
                    fromLabel="From"
                    toLabel="To"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("paymentDate", "Payment Date")}
                  <OrdersHeaderRangeFilter
                    isDark={isDark}
                    kind="date"
                    min={filters.paymentDateMin}
                    max={filters.paymentDateMax}
                    onChange={(paymentDateMin, paymentDateMax) =>
                      patchFilters({ paymentDateMin, paymentDateMax })
                    }
                    ariaLabel="Filter by payment date"
                    fromLabel="From"
                    toLabel="To"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("amount", "Amount")}
                  <OrdersHeaderRangeFilter
                    isDark={isDark}
                    kind="amount"
                    min={filters.amountMin}
                    max={filters.amountMax}
                    onChange={(amountMin, amountMax) =>
                      patchFilters({ amountMin, amountMax })
                    }
                    ariaLabel="Filter by amount"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left`}>
                {renderSortButton("type", "Type")}
              </th>
              <th className={`${thCls} text-left min-w-40`}>Note</th>
              <th className={`${thCls} w-14 px-2`} aria-label="Actions" />
            </tr>
          </thead>
          <tbody className={tbodyRowDividerCls}>
            {loading ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-6 text-center text-sm ${muted}`}
                >
                  Loading…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No payments recorded yet.
                </td>
              </tr>
            ) : visiblePayments.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No payments match the current filters.
                </td>
              </tr>
            ) : (
              visiblePayments.map((payment) => (
                <tr
                  key={payment.id}
                  className={deletingId === payment.id ? "opacity-60" : ""}
                  style={{ height: 52 }}
                >
                  <td className={`px-3 py-2 ${textMain}`}>
                    {payment.account_name}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatDate(payment.created_at)}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${muted}`}>
                    {formatOptionalDate(payment.payment_date)}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatCurrency(Number(payment.amount))}
                  </td>
                  <td className={`px-3 py-2 ${textMain}`}>
                    {paymentTypeLabel(payment.type)}
                  </td>
                  <td className={`px-3 py-2 ${muted}`}>
                    {payment.note?.trim() || "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => requestDelete(payment)}
                        disabled={deletingId === payment.id}
                        className={`rounded p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                          isDark
                            ? "text-red-400 hover:bg-slate-600"
                            : "text-red-600 hover:bg-red-50"
                        }`}
                        aria-label="Delete payment"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showRecordModal ? (
        <RecordPaymentModal
          isDark={isDark}
          accounts={accounts}
          defaultAccountId={
            selectedAccountId !== ALL_ACCOUNTS ? selectedAccountId : undefined
          }
          onClose={() => setShowRecordModal(false)}
          onSaved={() => void reload()}
        />
      ) : null}

      {deleteConfirm ? (
        <ConfirmModal
          isDark={isDark}
          title={
            deleteConfirm.type === "adjustment"
              ? "Delete adjustment"
              : "Delete payment"
          }
          description={
            <>
              Delete this{" "}
              {deleteConfirm.type === "adjustment" ? "adjustment" : "payment"}{" "}
              of{" "}
              <span className="font-medium">
                {formatCurrency(Number(deleteConfirm.amount))}
              </span>{" "}
              for{" "}
              <span className="font-medium">{deleteConfirm.account_name}</span>?
              {" "}
              {deleteBalanceImpactMessage(
                ledgerEntryAffectsCurrentBalance(
                  deleteConfirm.payment_date,
                  closedByAccount,
                  deleteConfirm.account_id,
                ),
              )}
            </>
          }
          confirmLabel="Delete"
          confirming={deletingId === deleteConfirm.id}
          confirmingLabel="Deleting…"
          onCancel={() => {
            if (deletingId !== deleteConfirm.id) setDeleteConfirm(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
