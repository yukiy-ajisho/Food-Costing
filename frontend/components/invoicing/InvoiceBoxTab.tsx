"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { invoicingAPI, type BoxInvoiceSummary } from "@/lib/invoicing";
import { formatCurrency } from "@/lib/invoicingCalc";
import {
  boxInvoiceToPreviewPayload,
  type GeneratePreviewPayload,
} from "@/lib/invoicingPreview";
import { InvoiceGeneratePreviewModal } from "./InvoiceGeneratePreviewModal";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value;
}

export function InvoiceBoxTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [invoices, setInvoices] = useState<BoxInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] =
    useState<GeneratePreviewPayload | null>(null);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [previewSentAt, setPreviewSentAt] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thCls = `h-14 align-middle px-4 py-3 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700/80" : "text-gray-500 bg-gray-50"
  }`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;
  const tableColSpan = 5;

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoicingAPI.listBoxInvoices();
      setInvoices(data.invoices ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const openInvoice = async (summary: BoxInvoiceSummary) => {
    setOpeningId(summary.id);
    setError(null);
    try {
      const data = await invoicingAPI.getBoxInvoice(summary.id);
      setPreviewPayload(boxInvoiceToPreviewPayload(data.invoice));
      setPreviewInvoiceId(data.invoice.id);
      setPreviewSentAt(data.invoice.sent_at);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load invoice");
    } finally {
      setOpeningId(null);
    }
  };

  const closePreview = () => {
    setPreviewPayload(null);
    setPreviewInvoiceId(null);
    setPreviewSentAt(null);
  };

  return (
    <div className="flex flex-col">
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div
        className={`w-full rounded-lg border shadow-sm transition-colors ${border} ${panel} ${
          !loading && invoices.length > 0
            ? "max-h-[calc(100vh-12rem)] overflow-auto"
            : ""
        }`}
      >
        <table className="w-full border-collapse text-sm">
          <thead
            className={`border-b ${border} ${
              !loading && invoices.length > 0
                ? "sticky top-0 z-10"
                : ""
            }`}
          >
            <tr>
              <th className={`${thCls} text-left w-32`}>Date</th>
              <th className={`${thCls} text-left min-w-40`}>Invoice #</th>
              <th className={`${thCls} text-left w-32`}>Amount</th>
              <th className={`${thCls} text-left min-w-48`}>Delivery Site</th>
              <th className={`${thCls} text-left w-44`}>Sent</th>
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
            ) : invoices.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No saved invoices yet.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={`cursor-pointer transition-[background-color] ${
                    isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                  } ${openingId === inv.id ? "opacity-60" : ""}`}
                  style={{ height: 52 }}
                  onClick={() => void openInvoice(inv)}
                >
                  <td className={`px-4 py-2 tabular-nums ${textMain}`}>
                    {formatDate(inv.invoice_date)}
                  </td>
                  <td className={`px-4 py-2 font-medium ${textMain}`}>
                    {inv.invoice_number}
                  </td>
                  <td className={`px-4 py-2 tabular-nums ${textMain}`}>
                    {formatCurrency(Number(inv.total_amount))}
                  </td>
                  <td className={`px-4 py-2 ${textMain}`}>
                    {inv.delivery_site_name}
                  </td>
                  <td className={`px-4 py-2 ${muted}`}>
                    {inv.sent_at
                      ? new Date(inv.sent_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewPayload && previewInvoiceId ? (
        <InvoiceGeneratePreviewModal
          isDark={isDark}
          mode="box"
          payload={previewPayload}
          invoiceId={previewInvoiceId}
          sentAt={previewSentAt}
          onClose={closePreview}
          onSent={() => void loadInvoices()}
        />
      ) : null}
    </div>
  );
}
