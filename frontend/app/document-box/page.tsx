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
import {
  DOCUMENT_INBOX_TYPE_VALUES,
  type DocumentInboxDocumentType,
} from "@/lib/api/document-inbox";
import { Edit, Trash2 } from "lucide-react";

type VendorProductRow = VendorProduct & { base_item_id: string };
const REQUIREMENT_TYPES: DocumentInboxDocumentType[] = [
  "company_requirement",
  "tenant_requirement",
  "employee_requirement",
];
const TYPE_LABELS: Record<DocumentInboxDocumentType, string> = {
  invoice: "Invoice",
  company_requirement: "Company requirement",
  tenant_requirement: "Tenant requirement",
  employee_requirement: "Employee requirement",
};

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
  const [activeTab, setActiveTab] = useState<"inbox" | "pending">("inbox");
  const [pendingEditMode, setPendingEditMode] = useState(false);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [pendingTypeDrafts, setPendingTypeDrafts] = useState<
    Record<string, DocumentInboxDocumentType>
  >({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());

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

  const inboxRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.document_type ||
          (r.document_type as DocumentInboxDocumentType) === "invoice",
      ),
    [rows],
  );
  const pendingRows = useMemo(
    () =>
      rows.filter((r) =>
        REQUIREMENT_TYPES.includes(r.document_type as DocumentInboxDocumentType),
      ),
    [rows],
  );

  const visiblePendingRows = useMemo(
    () => pendingRows.filter((r) => !pendingDeleteIds.has(r.id)),
    [pendingRows, pendingDeleteIds],
  );

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
          <h1 className="text-lg font-semibold mb-2">Upload Box</h1>
          <p className="text-sm">
            Upload Box is available to company administrators and directors
            only. Use Items → Import invoice for tenant-level imports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-full p-6 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer ${isDark ? "bg-slate-900" : "bg-gray-50"}`}
    >
      <div className="max-w-5xl mx-auto">
        <div className={`flex border-b mb-4 ${border}`}>
          <button
            type="button"
            onClick={() => setActiveTab("inbox")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "inbox"
                ? isDark
                  ? "border-blue-400 text-blue-300"
                  : "border-blue-600 text-blue-700"
                : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-200"
                  : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "pending"
                ? isDark
                  ? "border-blue-400 text-blue-300"
                  : "border-blue-600 text-blue-700"
                : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-200"
                  : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Pending Assignment
          </button>
        </div>

        <div className={`rounded-lg border ${border} ${bg} overflow-hidden`}>
          {loading ? (
            <div className={`flex items-center justify-center h-40 ${textMuted}`}>
              Loading…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-red-500 text-sm">
              {error}
            </div>
          ) : activeTab === "inbox" && inboxRows.length === 0 ? (
            <div
              className={`flex items-center justify-center h-40 text-sm ${textMuted}`}
            >
              No documents awaiting action.
            </div>
          ) : activeTab === "pending" && visiblePendingRows.length === 0 ? (
            <div
              className={`flex items-center justify-center h-40 text-sm ${textMuted}`}
            >
              No pending assignment documents.
            </div>
          ) : (
            <>
              {activeTab === "inbox" ? (
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
                    {inboxRows.map((doc) => (
                      <tr
                        key={`${doc.kind}-${doc.id}`}
                        className={`transition-colors ${rowHover}`}
                      >
                        <td className={`px-4 py-3 ${textMuted}`}>
                          {new Date(doc.created_at).toLocaleDateString("en-US", {
                            month: "2-digit",
                            day: "2-digit",
                            year: "numeric",
                          })}
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
              ) : (
                <>
                  <div
                    className={`flex items-center justify-end gap-2 px-4 py-3 border-b ${
                      isDark ? "border-slate-700" : "border-gray-200"
                    }`}
                  >
                    {pendingEditMode ? (
                      <>
                        <button
                          type="button"
                          disabled={pendingSaving}
                          onClick={() => {
                            setPendingEditMode(false);
                            setPendingTypeDrafts({});
                            setPendingDeleteIds(new Set());
                          }}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                            isDark
                              ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={pendingSaving}
                          onClick={async () => {
                            if (pendingSaving) return;
                            setPendingSaving(true);
                            try {
                              const updates = visiblePendingRows
                                .map((r) => ({
                                  id: r.id,
                                  prev: r.document_type as DocumentInboxDocumentType,
                                  next:
                                    pendingTypeDrafts[r.id] ??
                                    (r.document_type as DocumentInboxDocumentType),
                                }))
                                .filter((u) => u.next !== u.prev);
                              for (const u of updates) {
                                await documentInboxAPI.classify(u.id, u.next);
                              }
                              for (const id of Array.from(pendingDeleteIds)) {
                                await documentInboxAPI.remove(id);
                              }
                              setPendingEditMode(false);
                              setPendingTypeDrafts({});
                              setPendingDeleteIds(new Set());
                              await fetchRows();
                            } catch (e) {
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : "Failed to save pending assignments",
                              );
                            } finally {
                              setPendingSaving(false);
                            }
                          }}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white ${
                            isDark
                              ? "bg-blue-700 hover:bg-blue-600"
                              : "bg-blue-600 hover:bg-blue-700"
                          } disabled:opacity-50`}
                        >
                          Save
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const drafts: Record<string, DocumentInboxDocumentType> =
                            {};
                          visiblePendingRows.forEach((r) => {
                            drafts[r.id] = r.document_type as DocumentInboxDocumentType;
                          });
                          setPendingTypeDrafts(drafts);
                          setPendingDeleteIds(new Set());
                          setPendingEditMode(true);
                        }}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white ${
                          isDark
                            ? "bg-slate-600 hover:bg-slate-500"
                            : "bg-gray-600 hover:bg-gray-700"
                        }`}
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                    )}
                  </div>
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: "24%" }} />
                      <col style={{ width: "41%" }} />
                      <col style={{ width: "25%" }} />
                      <col style={{ width: "10%" }} />
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
                          File
                        </th>
                        <th
                          className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                        >
                          Classified type
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
                      {visiblePendingRows.map((doc) => (
                        <tr
                          key={`${doc.kind}-${doc.id}`}
                          className={`transition-colors ${rowHover}`}
                        >
                          <td className={`px-4 py-3 ${textMuted}`}>
                            {new Date(doc.created_at).toLocaleDateString("en-US", {
                              month: "2-digit",
                              day: "2-digit",
                              year: "numeric",
                            })}
                          </td>
                          <td
                            className={`px-4 py-3 truncate ${textMuted}`}
                            title={doc.file_name}
                          >
                            {doc.file_name}
                          </td>
                          <td className="px-4 py-3">
                            {pendingEditMode ? (
                              <select
                                value={
                                  pendingTypeDrafts[doc.id] ??
                                  (doc.document_type as DocumentInboxDocumentType)
                                }
                                onChange={(e) =>
                                  setPendingTypeDrafts((prev) => ({
                                    ...prev,
                                    [doc.id]: e.target
                                      .value as DocumentInboxDocumentType,
                                  }))
                                }
                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                    : "bg-white border-gray-300 text-gray-900"
                                }`}
                              >
                                {DOCUMENT_INBOX_TYPE_VALUES.filter((t) =>
                                  REQUIREMENT_TYPES.includes(t),
                                ).map((t) => (
                                  <option key={t} value={t}>
                                    {TYPE_LABELS[t]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className={textPrimary}>
                                {TYPE_LABELS[
                                  doc.document_type as DocumentInboxDocumentType
                                ]}
		                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {pendingEditMode ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingDeleteIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(doc.id);
                                    return next;
                                  })
                                }
                                className="inline-flex items-center justify-center p-1.5 rounded text-red-600 hover:text-red-700 hover:bg-red-50"
                                title="Delete"
                                aria-label="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className={textMuted}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
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
