"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  documentMetadataInvoicesAPI,
  type DocumentMetadataInvoiceRow,
} from "@/lib/api/document-metadata-invoices";
import { openPresignedDocumentInNewTab } from "@/lib/open-presigned-document";

type TabType = "invoices";

export default function VendorsPage() {
  const { theme } = useTheme();
  const { selectedTenantId, loading: tenantLoading } = useTenant();
  const isDark = theme === "dark";

  const [activeTab, setActiveTab] = useState<TabType>("invoices");
  const [invoices, setInvoices] = useState<DocumentMetadataInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const bg = isDark ? "bg-slate-800" : "bg-white";
  const textPrimary = isDark ? "text-slate-100" : "text-gray-900";
  const textMuted = isDark ? "text-slate-400" : "text-gray-500";
  const rowHover = isDark ? "hover:bg-slate-700/60" : "hover:bg-gray-50";
  const thCls = isDark ? "text-slate-300" : "text-gray-600";
  const tabActive = isDark
    ? "border-blue-400 text-blue-400"
    : "border-blue-600 text-blue-700";
  const tabInactive = isDark
    ? "border-transparent text-slate-400 hover:text-slate-200"
    : "border-transparent text-gray-500 hover:text-gray-700";

  const fetchInvoices = useCallback(async () => {
    if (!selectedTenantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await documentMetadataInvoicesAPI.list();
      setInvoices(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (activeTab === "invoices" && selectedTenantId) {
      void fetchInvoices();
    }
  }, [activeTab, selectedTenantId, fetchInvoices]);

  const handleOpenInvoice = (row: DocumentMetadataInvoiceRow) => {
    openPresignedDocumentInNewTab(() =>
      documentMetadataInvoicesAPI.getDocumentUrl(row.value)
    );
  };

  if (tenantLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${textMuted}`}>
        Loading…
      </div>
    );
  }

  return (
    <div className={`min-h-full p-6 ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      <div className="max-w-5xl mx-auto">
        {/* タブ */}
        <div className={`flex border-b mb-6 ${border}`}>
          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "invoices" ? tabActive : tabInactive
            }`}
          >
            Invoices
          </button>
        </div>

        {/* Invoices タブ */}
        {activeTab === "invoices" && (
          <div className={`rounded-lg border ${border} ${bg} overflow-hidden`}>
            {loading ? (
              <div className={`flex items-center justify-center h-40 ${textMuted}`}>
                Loading…
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-40 text-red-500 text-sm">
                {error}
              </div>
            ) : invoices.length === 0 ? (
              <div className={`flex items-center justify-center h-40 text-sm ${textMuted}`}>
                No invoices yet. Import an invoice to get started.
              </div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: "40%" }} />
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "30%" }} />
                </colgroup>
                <thead
                  className={`border-b ${
                    isDark
                      ? "bg-slate-700 border-slate-600"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <tr>
                    <th
                      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                    >
                      Vendor
                    </th>
                    <th
                      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                    >
                      Invoice Date
                    </th>
                    <th
                      className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wider ${thCls}`}
                    >
                      Total Amount
                    </th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y ${
                    isDark ? "divide-slate-700" : "divide-gray-200"
                  }`}
                >
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`transition-colors ${rowHover}`}
                    >
                      <td className={`px-4 py-3 ${textPrimary}`}>
                        {inv.vendor_name ?? "—"}
                      </td>
                      <td className={`px-4 py-3 ${textMuted}`}>
                        {inv.invoice_date ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenInvoice(inv)}
                          className={`font-medium underline underline-offset-2 transition-colors ${
                            isDark
                              ? "text-blue-400 hover:text-blue-300"
                              : "text-blue-600 hover:text-blue-700"
                          }`}
                          title={`Open ${inv.file_name}`}
                        >
                          {inv.total_amount != null
                            ? `$${inv.total_amount.toFixed(2)}`
                            : "—"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
