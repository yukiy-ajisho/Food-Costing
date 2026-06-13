"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  invoicingAPI,
  type MonthlyStatement,
  type MonthlyStatementStatus,
} from "@/lib/invoicing";

function formatStatementPeriodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatStatementSentAt(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: MonthlyStatementStatus): string {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Error";
  return "Skipped";
}

function StatusPill({
  status,
  isDark,
}: {
  status: MonthlyStatementStatus;
  isDark: boolean;
}) {
  const sent = status === "sent";
  const failed = status === "failed";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        sent
          ? isDark
            ? "bg-emerald-950 text-emerald-300"
            : "bg-emerald-100 text-emerald-800"
          : failed
            ? isDark
              ? "bg-amber-950 text-amber-300"
              : "bg-amber-100 text-amber-800"
            : isDark
              ? "bg-slate-700 text-slate-300"
              : "bg-gray-100 text-gray-600"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function StatementsTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [statements, setStatements] = useState<MonthlyStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const loadStatements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoicingAPI.listStatements();
      setStatements(data.statements ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load statements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatements();
  }, [loadStatements]);

  const handleShowStatement = async (statement: MonthlyStatement) => {
    if (!statement.r2_key?.trim()) return;
    setOpeningPdfId(statement.id);
    setError(null);
    try {
      const { url } = await invoicingAPI.getStatementPdfUrl(statement.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open statement PDF");
    } finally {
      setOpeningPdfId(null);
    }
  };

  const handleResend = async (statement: MonthlyStatement) => {
    setResendingId(statement.id);
    setError(null);
    try {
      const result = await invoicingAPI.resendStatement(statement.id);
      setStatements((prev) =>
        prev.map((row) =>
          row.id === statement.id ? result.statement : row,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send statement");
      await loadStatements();
    } finally {
      setResendingId(null);
    }
  };

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thead = isDark
    ? "border-slate-600 bg-slate-700"
    : "border-gray-200 bg-gray-50";
  const divide = isDark ? "divide-slate-700" : "divide-gray-200";
  const outlineBtn = `rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark
      ? "border-slate-600 text-slate-200 hover:bg-slate-700"
      : "border-gray-300 text-gray-700 hover:bg-gray-50"
  }`;
  const primaryBtn = `rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark
      ? "bg-slate-600 text-slate-100 hover:bg-slate-500"
      : "bg-gray-100 text-gray-800 hover:bg-gray-200"
  }`;

  return (
    <div className="flex flex-col">
      {error ? (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            isDark
              ? "border-red-800 bg-red-950 text-red-200"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex justify-start" aria-hidden="true">
        <div className="inline-flex h-10 items-center gap-2 px-4 py-2 text-sm font-medium opacity-0 pointer-events-none">
          Toolbar
        </div>
      </div>

      {loading ? (
        <div
          className={`rounded-lg border p-8 text-center text-sm shadow-sm ${panel} ${border}`}
        >
          Loading…
        </div>
      ) : statements.length === 0 ? (
        <div
          className={`rounded-lg border p-8 text-center text-sm shadow-sm ${panel} ${border} ${muted}`}
        >
          No monthly statements yet.
        </div>
      ) : (
        <div
          className={`w-full overflow-hidden rounded-lg border shadow-sm transition-colors ${panel} ${border} max-h-[calc(100vh-12rem)] overflow-auto`}
        >
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead
              className={`sticky top-0 z-10 border-b ${thead}`}
            >
              <tr>
                {[
                  "Period",
                  "Account",
                  "Status",
                  "Sent to",
                  "Send date",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className={`h-14 align-middle px-3 py-2 text-left text-xs font-medium uppercase tracking-wider ${muted}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={`divide-y ${divide}`}>
              {statements.map((statement) => {
                const openingPdf = openingPdfId === statement.id;
                const resending = resendingId === statement.id;
                const rowBusy = openingPdf || resending;
                const hasPdf = !!statement.r2_key?.trim();
                const resendLabel =
                  statement.status === "sent" ? "Resend" : "Send again";
                return (
                  <tr key={statement.id}>
                    <td className={`px-3 py-3 text-sm font-medium ${textMain}`}>
                      {formatStatementPeriodLabel(statement.period)}
                    </td>
                    <td className={`px-3 py-3 text-sm ${textMain}`}>
                      {statement.account_company_name}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <StatusPill status={statement.status} isDark={isDark} />
                    </td>
                    <td className={`px-3 py-3 text-sm ${textMain}`}>
                      {statement.sent_to || "—"}
                    </td>
                    <td className={`px-3 py-3 text-sm ${muted}`}>
                      {formatStatementSentAt(statement.sent_at)}
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={outlineBtn}
                          disabled={!hasPdf || rowBusy}
                          onClick={() => void handleShowStatement(statement)}
                        >
                          {openingPdf ? "Opening…" : "Show Statement"}
                        </button>
                        <button
                          type="button"
                          className={primaryBtn}
                          disabled={rowBusy}
                          onClick={() => void handleResend(statement)}
                        >
                          {resending ? "Sending…" : resendLabel}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
