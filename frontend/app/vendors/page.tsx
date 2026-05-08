"use client";

import { useState, useEffect, useCallback } from "react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  documentMetadataInvoicesAPI,
  type DocumentMetadataInvoiceRow,
} from "@/lib/api/document-metadata-invoices";
import { vendorsAPI } from "@/lib/api";
import { openPresignedDocumentInNewTab } from "@/lib/open-presigned-document";

type TabType = "vendors-list" | "invoices";
interface VendorUI {
  id: string;
  name: string;
  created_at?: string;
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
}

export default function VendorsPage() {
  const { theme } = useTheme();
  const { selectedTenantId, loading: tenantLoading } = useTenant();
  const isDark = theme === "dark";

  const [activeTab, setActiveTab] = useState<TabType>("vendors-list");
  const [invoices, setInvoices] = useState<DocumentMetadataInvoiceRow[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [vendorsUI, setVendorsUI] = useState<VendorUI[]>([]);
  const [originalVendors, setOriginalVendors] = useState<VendorUI[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [isEditModeVendors, setIsEditModeVendors] = useState(false);

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
    setLoadingInvoices(true);
    setInvoicesError(null);
    try {
      const data = await documentMetadataInvoicesAPI.list();
      setInvoices(data);
    } catch (e) {
      setInvoicesError(e instanceof Error ? e.message : "Failed to load invoices");
    } finally {
      setLoadingInvoices(false);
    }
  }, [selectedTenantId]);

  const fetchVendors = useCallback(async () => {
    if (!selectedTenantId) return;
    setLoadingVendors(true);
    try {
      const vendorsData = await vendorsAPI.getAll();
      const mapped: VendorUI[] = vendorsData.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        created_at: vendor.created_at,
      }));
      setVendorsUI(mapped);
      setOriginalVendors(JSON.parse(JSON.stringify(mapped)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load vendors");
    } finally {
      setLoadingVendors(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (activeTab === "invoices" && selectedTenantId) {
      void fetchInvoices();
    }
    if (activeTab === "vendors-list" && selectedTenantId) {
      void fetchVendors();
    }
  }, [activeTab, selectedTenantId, fetchInvoices, fetchVendors]);

  const handleOpenInvoice = (row: DocumentMetadataInvoiceRow) => {
    openPresignedDocumentInNewTab(() =>
      documentMetadataInvoicesAPI.getDocumentUrl(row.value)
    );
  };

  const handleEditClickVendors = () => {
    setOriginalVendors(JSON.parse(JSON.stringify(vendorsUI)));
    setIsEditModeVendors(true);
  };

  const handleCancelClickVendors = () => {
    setVendorsUI(JSON.parse(JSON.stringify(originalVendors)));
    setIsEditModeVendors(false);
  };

  const handleSaveClickVendors = async () => {
    try {
      setLoadingVendors(true);
      const filteredVendors = vendorsUI.filter((vendor) => {
        if (vendor.isMarkedForDeletion) return false;
        if (vendor.isNew && vendor.name.trim() === "") return false;
        return true;
      });

      for (const vendor of filteredVendors) {
        if (vendor.isNew) {
          await vendorsAPI.create({ name: vendor.name });
        } else {
          await vendorsAPI.update(vendor.id, { name: vendor.name });
        }
      }

      for (const vendor of vendorsUI) {
        if (vendor.isMarkedForDeletion && !vendor.isNew) {
          await vendorsAPI.delete(vendor.id);
        }
      }

      await fetchVendors();
      setIsEditModeVendors(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to save: ${message}`);
    } finally {
      setLoadingVendors(false);
    }
  };

  const handleVendorChange = (id: string, value: string) => {
    setVendorsUI((prev) =>
      prev.map((vendor) => (vendor.id === id ? { ...vendor, name: value } : vendor)),
    );
  };

  const handleDeleteClickVendors = (id: string) => {
    setVendorsUI((prev) =>
      prev.map((vendor) =>
        vendor.id === id
          ? { ...vendor, isMarkedForDeletion: !vendor.isMarkedForDeletion }
          : vendor,
      ),
    );
  };

  const handleAddClickVendors = () => {
    const newVendor: VendorUI = {
      id: `new-${Date.now()}`,
      name: "",
      isNew: true,
    };
    setVendorsUI((prev) => [...prev, newVendor]);
  };

  if (tenantLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${textMuted}`}>
        Loading…
      </div>
    );
  }

  return (
    <div className={`min-h-full p-6 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      <div className="max-w-5xl mx-auto">
        {/* タブ */}
        <div className={`flex border-b mb-6 ${border}`}>
          <button
            type="button"
            onClick={() => setActiveTab("vendors-list")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "vendors-list" ? tabActive : tabInactive
            }`}
          >
            Vendors List
          </button>
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
            {loadingInvoices ? (
              <div className={`flex items-center justify-center h-40 ${textMuted}`}>
                Loading…
              </div>
            ) : invoicesError ? (
              <div className="flex items-center justify-center h-40 text-red-500 text-sm">
                {invoicesError}
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

        {activeTab === "vendors-list" && (
          <>
            <div className="flex justify-end items-center mb-4 gap-2">
              {isEditModeVendors ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancelClickVendors}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      isDark
                        ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    <X className="w-5 h-5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveClickVendors()}
                    disabled={loadingVendors}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-5 h-5" />
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleEditClickVendors}
                  className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                    isDark
                      ? "bg-slate-600 hover:bg-slate-500"
                      : "bg-gray-600 hover:bg-gray-700"
                  }`}
                >
                  <Edit className="w-5 h-5" />
                  Edit
                </button>
              )}
            </div>
            <div className={`rounded-lg border ${border} ${bg} overflow-hidden`}>
              {loadingVendors ? (
                <div className={`flex items-center justify-center h-40 ${textMuted}`}>
                  Loading…
                </div>
              ) : (
                <table className="w-full text-sm table-fixed">
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
                        Name
                      </th>
                      {isEditModeVendors && (
                        <th
                          className={`px-4 py-3 w-16 text-left text-xs font-medium uppercase tracking-wider ${thCls}`}
                        />
                      )}
                    </tr>
                  </thead>
                  <tbody
                    className={`divide-y ${
                      isDark ? "divide-slate-700" : "divide-gray-200"
                    }`}
                  >
                    {vendorsUI.map((vendor) => (
                      <tr
                        key={vendor.id}
                        className={`transition-colors ${
                          vendor.isMarkedForDeletion
                            ? isDark
                              ? "bg-red-900/30"
                              : "bg-red-50"
                            : rowHover
                        }`}
                      >
                        <td className="px-4 py-3">
                          {isEditModeVendors ? (
                            <input
                              type="text"
                              value={vendor.name}
                              onChange={(e) =>
                                handleVendorChange(vendor.id, e.target.value)
                              }
                              className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors px-2 py-1 ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                  : "border-gray-300 text-gray-900"
                              }`}
                              placeholder="Vendor name"
                            />
                          ) : (
                            <span className={textPrimary}>{vendor.name}</span>
                          )}
                        </td>
                        {isEditModeVendors && (
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleDeleteClickVendors(vendor.id)}
                              className={`p-2 rounded-md transition-colors ${
                                vendor.isMarkedForDeletion
                                  ? "bg-red-500 text-white hover:bg-red-600"
                                  : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                              }`}
                              title="Mark for deletion"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {isEditModeVendors && (
                      <tr>
                        <td colSpan={2} className="px-4 py-3">
                          <button
                            type="button"
                            onClick={handleAddClickVendors}
                            className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                          >
                            <Plus className="w-5 h-5" />
                            <span>Add new vendor</span>
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
