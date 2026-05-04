"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import { useCompany } from "@/contexts/CompanyContext";
import { documentInboxAPI, type DocumentBoxRow } from "@/lib/api/document-inbox";
import {
  vendorsAPI,
  baseItemsAPI,
  vendorProductsAPI,
  type Vendor,
  type BaseItem,
  type VendorProduct,
} from "@/lib/api";
import { InvoiceImportModal } from "@/components/InvoiceImportModal";
import { DocumentBoxReviewModal } from "@/components/DocumentBoxReviewModal";

type VendorProductRow = VendorProduct & { base_item_id: string };

export default function DocumentBoxPage() {
  const { theme } = useTheme();
  const { selectedTenantId, loading: tenantLoading } = useTenant();
  const { companies, selectedCompanyId, loading: companyLoading } =
    useCompany();
  const canAccessDocumentBox = useMemo(() => {
    if (!selectedCompanyId) return false;
    const role = companies.find((c) => c.id === selectedCompanyId)?.role;
    return role === "company_admin" || role === "company_director";
  }, [companies, selectedCompanyId]);
  const isDark = theme === "dark";

  const [rows, setRows] = useState<DocumentBoxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [baseItems, setBaseItems] = useState<BaseItem[]>([]);
  const [vendorProducts, setVendorProducts] = useState<VendorProductRow[]>([]);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRow, setReviewRow] = useState<DocumentBoxRow | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importInboxId, setImportInboxId] = useState<string | undefined>();
  const [importValue, setImportValue] = useState<string | undefined>();

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const bg = isDark ? "bg-slate-800" : "bg-white";
  const textPrimary = isDark ? "text-slate-100" : "text-gray-900";
  const textMuted = isDark ? "text-slate-400" : "text-gray-500";
  const rowHover = isDark ? "hover:bg-slate-700/60" : "hover:bg-gray-50";
  const thCls = isDark ? "text-slate-300" : "text-gray-600";

  const fetchRows = useCallback(async () => {
    if (!selectedTenantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await documentInboxAPI.forDocumentBox();
      setRows(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load documents",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  const fetchModalData = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      const [v, b, vp] = await Promise.all([
        vendorsAPI.getAll(),
        baseItemsAPI.getAll(),
        vendorProductsAPI.getAll(),
      ]);
      setVendors(v);
      setBaseItems(b);
      setVendorProducts(
        vp.map((p) => ({ ...p, base_item_id: "" })),
      );
    } catch {
      /* non-critical */
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !canAccessDocumentBox) return;
    void fetchRows();
    void fetchModalData();
  }, [selectedTenantId, canAccessDocumentBox, fetchRows, fetchModalData]);

  const handleReview = (row: DocumentBoxRow) => {
    setReviewRow(row);
    setReviewOpen(true);
  };

  const handleCloseReview = () => {
    setReviewOpen(false);
    setReviewRow(null);
    void fetchRows();
  };

  const handleStartInvoiceImport = (row: DocumentBoxRow) => {
    setReviewOpen(false);
    setReviewRow(null);
    setImportInboxId(row.id);
    setImportValue(row.value);
    setImportOpen(true);
  };

  const handleImportClose = () => {
    setImportOpen(false);
    setImportInboxId(undefined);
    setImportValue(undefined);
  };

  const handleImportComplete = async () => {
    await fetchRows();
  };

  if (tenantLoading || companyLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${textMuted}`}>
        Loading…
      </div>
    );
  }

  if (!canAccessDocumentBox) {
    return (
      <div className={`min-h-full p-6 ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
        <div className="max-w-lg mx-auto rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <h1 className="text-lg font-semibold mb-2">Uploaded Document Box</h1>
          <p className="text-sm">
            Uploaded Document Box is available to company administrators and directors
            only. Use Items → Import invoice for tenant-level imports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-full p-6 ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      <div className="max-w-5xl mx-auto">
        <h1 className={`text-xl font-semibold mb-6 ${textPrimary}`}>
          Uploaded Document Box
        </h1>

        <div className={`rounded-lg border ${border} ${bg} overflow-hidden`}>
          {loading ? (
            <div className={`flex items-center justify-center h-40 ${textMuted}`}>
              Loading…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-red-500 text-sm">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div
              className={`flex items-center justify-center h-40 text-sm ${textMuted}`}
            >
              No documents awaiting action.
            </div>
          ) : (
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: "24%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "37%" }} />
                <col style={{ width: "15%" }} />
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
                    Received
                  </th>
                  <th
                    className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                  >
                    Sent by
                  </th>
                  <th
                    className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                  >
                    File
                  </th>
                  <th
                    className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wider ${thCls}`}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody
                className={`divide-y ${
                  isDark ? "divide-slate-700" : "divide-gray-200"
                }`}
              >
                {rows.map((doc) => (
                  <tr
                    key={`${doc.kind}-${doc.id}`}
                    className={`transition-colors ${rowHover}`}
                  >
                    <td className={`px-4 py-3 ${textMuted}`}>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                    <td className={`px-4 py-3 ${textPrimary}`}>
                      {doc.sent_by_name ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-3 truncate ${textMuted}`}
                      title={doc.file_name}
                    >
                      {doc.file_name}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleReview(doc)}
                        className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                          isDark
                            ? "bg-blue-700 hover:bg-blue-600 text-white"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <DocumentBoxReviewModal
        open={reviewOpen}
        onClose={handleCloseReview}
        row={reviewRow}
        onStartInvoiceImport={handleStartInvoiceImport}
        onRemoved={() => {
          void fetchRows();
        }}
      />

      <InvoiceImportModal
        open={importOpen}
        onClose={handleImportClose}
        vendors={vendors}
        baseItems={baseItems}
        vendorProducts={vendorProducts}
        onImportComplete={handleImportComplete}
        initialInboxId={importInboxId}
        initialDocumentValue={importValue}
      />
    </div>
  );
}
