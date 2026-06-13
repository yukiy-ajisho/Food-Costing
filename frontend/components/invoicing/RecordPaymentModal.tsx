"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import {
  invoicingAPI,
  type AdjustmentDirection,
  type CompanyInvoicingAccount,
  type PaymentInput,
  type PaymentType,
} from "@/lib/invoicing";
import { todayLocalDateYmd } from "@/lib/invoicingDateTime";
import {
  buildClosedPeriodSet,
  isAccountDateOpenForNewEntry,
  NEW_ENTRY_DATE_BLOCKED_MESSAGE,
} from "@/lib/invoicingLedger";

type Props = {
  isDark: boolean;
  accounts: CompanyInvoicingAccount[];
  defaultAccountId?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function RecordPaymentModal({
  isDark,
  accounts,
  defaultAccountId,
  onClose,
  onSaved,
}: Props) {
  const { companies, selectedCompanyId } = useCompany();
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [type, setType] = useState<PaymentType | "">("");
  const [adjustmentDirection, setAdjustmentDirection] =
    useState<AdjustmentDirection>("decrease");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocalDateYmd());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedByAccount, setClosedByAccount] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [closedPeriodsReady, setClosedPeriodsReady] = useState(false);

  const companyTimezone = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId)?.timezone,
    [companies, selectedCompanyId],
  );

  useEffect(() => {
    void invoicingAPI
      .listClosedPeriods()
      .then((data) => {
        setClosedByAccount(
          buildClosedPeriodSet(data.closed_periods ?? []),
        );
      })
      .catch(() => {
        setClosedByAccount(new Map());
      })
      .finally(() => {
        setClosedPeriodsReady(true);
      });
  }, []);

  useEffect(() => {
    setAccountId(defaultAccountId ?? "");
  }, [defaultAccountId]);

  const panel = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";
  const inputCls = isDark
    ? "w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
    : "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900";
  const invalidInputCls = "border-red-500 ring-1 ring-red-500/50";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const radioLabelCls = `inline-flex cursor-pointer items-center gap-2 text-sm ${
    isDark ? "text-slate-200" : "text-gray-800"
  }`;

  const isAdjustment = type === "adjustment";

  const paymentDateBlocked = useMemo(() => {
    if (!closedPeriodsReady) return false;
    const trimmedAccountId = accountId.trim();
    const trimmedPaymentDate = paymentDate.trim();
    if (!trimmedAccountId || !trimmedPaymentDate) return false;
    return !isAccountDateOpenForNewEntry(
      trimmedPaymentDate,
      closedByAccount,
      trimmedAccountId,
      companyTimezone,
    );
  }, [
    accountId,
    paymentDate,
    closedByAccount,
    companyTimezone,
    closedPeriodsReady,
  ]);

  const canSave = useMemo(() => {
    if (!closedPeriodsReady) return false;
    if (!type) return false;
    if (!accountId.trim()) return false;
    if (paymentDateBlocked) return false;
    const parsedAmount = Number(amount);
    return (
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(paymentDate.trim())
    );
  }, [accountId, amount, type, paymentDate, paymentDateBlocked, closedPeriodsReady]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!type) {
      setError("Type is required.");
      return;
    }

    const trimmedAccountId = accountId.trim();
    if (!trimmedAccountId) {
      setError("Account is required.");
      return;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }

    const trimmedPaymentDate = paymentDate.trim();
    if (!trimmedPaymentDate) {
      setError("Payment Date is required.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedPaymentDate)) {
      setError("Payment Date must be YYYY-MM-DD.");
      return;
    }
    if (paymentDateBlocked) {
      setError(NEW_ENTRY_DATE_BLOCKED_MESSAGE);
      return;
    }

    const trimmedNote = note.trim();

    const body: PaymentInput = {
      account_id: trimmedAccountId,
      amount: parsedAmount,
      type,
      payment_date: trimmedPaymentDate,
      note: trimmedNote || null,
      adjustment_direction: type === "adjustment" ? adjustmentDirection : null,
    };

    setSaving(true);
    try {
      await invoicingAPI.createPayment(body);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`w-full max-w-md overflow-hidden rounded-lg border shadow-xl ${border} ${panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-entry-title"
      >
        <div
          className={`flex items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2 id="record-entry-title" className="text-lg font-semibold">
            Record Entry
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={`rounded p-1.5 ${muted} ${
              isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-4">
          {error ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <div className="space-y-4">
            <div>
              <label className={`mb-1 block text-xs font-medium ${muted}`}>
                Account
              </label>
              <select
                className={inputCls}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
                disabled={accounts.length === 0}
              >
                <option value="">Select Account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.company_name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className={`mb-2 block text-xs font-medium ${muted}`}>
                Type
              </legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className={radioLabelCls}>
                  <input
                    type="radio"
                    name="entry-type"
                    value="payment"
                    checked={type === "payment"}
                    onChange={() => {
                      setType("payment");
                      setError(null);
                    }}
                    className="accent-blue-600"
                  />
                  payment
                </label>
                <label className={radioLabelCls}>
                  <input
                    type="radio"
                    name="entry-type"
                    value="adjustment"
                    checked={type === "adjustment"}
                    onChange={() => {
                      setType("adjustment");
                      setError(null);
                    }}
                    className="accent-blue-600"
                  />
                  adjustment
                </label>
              </div>
            </fieldset>

            {isAdjustment ? (
              <fieldset>
                <legend className={`mb-2 block text-xs font-medium ${muted}`}>
                  Balance effect
                </legend>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <label className={radioLabelCls}>
                    <input
                      type="radio"
                      name="adjustment-direction"
                      value="decrease"
                      checked={adjustmentDirection === "decrease"}
                      onChange={() => setAdjustmentDirection("decrease")}
                      className="accent-blue-600"
                    />
                    Reduce balance
                  </label>
                  <label className={radioLabelCls}>
                    <input
                      type="radio"
                      name="adjustment-direction"
                      value="increase"
                      checked={adjustmentDirection === "increase"}
                      onChange={() => setAdjustmentDirection("increase")}
                      className="accent-blue-600"
                    />
                    Increase balance
                  </label>
                </div>
              </fieldset>
            ) : null}

            <div>
              <label
                htmlFor="payment-amount"
                className={`mb-1 block text-xs font-medium ${muted}`}
              >
                {isAdjustment ? "Correction amount" : "Amount received"}
              </label>
              <input
                id="payment-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`no-spinner ${inputCls} tabular-nums`}
                required
              />
            </div>

            <div>
              <label
                htmlFor="payment-date"
                className={`mb-1 block text-xs font-medium ${muted}`}
              >
                Payment Date
              </label>
              <input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className={`invoicing-generation-date-input ${inputCls} ${
                  paymentDateBlocked ? invalidInputCls : ""
                }`}
                required
              />
              {paymentDateBlocked ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {NEW_ENTRY_DATE_BLOCKED_MESSAGE}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="payment-note"
                className={`mb-1 block text-xs font-medium ${muted}`}
              >
                Note <span className="font-normal">(Optional)</span>
              </label>
              <textarea
                id="payment-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className={inputCls}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={`rounded-md border px-4 py-2 text-sm font-medium ${border} ${
                isDark
                  ? "text-slate-200 hover:bg-slate-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canSave || paymentDateBlocked}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
