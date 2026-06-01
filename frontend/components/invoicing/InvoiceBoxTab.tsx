"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FilePlus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { invoicingAPI, type BoxInvoiceSummary } from "@/lib/invoicing";
import { formatCurrency } from "@/lib/invoicingCalc";
import {
  addDaysYmd,
  EMPTY_INVOICE_BOX_FILTERS,
  filterInvoiceBoxRows,
  maxAmountBefore,
  minAmountAfter,
  nextInvoiceBoxSortState,
  sortInvoiceBoxRows,
  uniqueSortedValues,
  type InvoiceBoxFilters,
  type InvoiceBoxSortKey,
  type InvoiceBoxSortState,
} from "@/lib/invoiceBoxTable";
import {
  boxInvoiceToPreviewPayload,
  type GeneratePreviewPayload,
} from "@/lib/invoicingPreview";
import { InvoiceBoxHeaderFilter } from "./InvoiceBoxHeaderFilter";
import { InvoiceGeneratePreviewModal } from "./InvoiceGeneratePreviewModal";
import { InvoiceGenerationModal } from "./InvoiceGenerationModal";

const DEFAULT_SORT: InvoiceBoxSortState = { key: "date", ascending: false };

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGeneration, setShowGeneration] = useState(false);
  const [filters, setFilters] = useState<InvoiceBoxFilters>(
    EMPTY_INVOICE_BOX_FILTERS,
  );
  const [sort, setSort] = useState<InvoiceBoxSortState>(DEFAULT_SORT);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thCls = `h-14 align-middle px-3 py-2 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700" : "text-gray-500 bg-gray-50"
  }`;
  const miniFieldCls = `invoicing-box-mini-field h-6 shrink-0 rounded border px-1 text-[10px] leading-none tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;
  const tableColSpan = 7;
  const btnPrimary =
    "inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

  const companyOptions = useMemo(
    () => uniqueSortedValues(invoices.map((inv) => inv.company_name ?? "")),
    [invoices],
  );
  const deliverySiteOptions = useMemo(
    () =>
      uniqueSortedValues(invoices.map((inv) => inv.delivery_site_name ?? "")),
    [invoices],
  );

  const visibleInvoices = useMemo(() => {
    const filtered = filterInvoiceBoxRows(invoices, filters);
    return sortInvoiceBoxRows(filtered, sort);
  }, [invoices, filters, sort]);

  const hasActiveFilters = useMemo(
    () =>
      Object.values(filters).some((value) => value.trim() !== ""),
    [filters],
  );

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

  const patchFilters = (patch: Partial<InvoiceBoxFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleSortClick = (column: InvoiceBoxSortKey) => {
    setSort((prev) => nextInvoiceBoxSortState(prev, column));
  };

  const renderSortButton = (column: InvoiceBoxSortKey, label: string) => {
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

  const renderDateRangeInputs = (
    minKey: "dateMin" | "sentMin",
    maxKey: "dateMax" | "sentMax",
    fromLabel: string,
    toLabel: string,
  ) => {
    const min = filters[minKey];
    const max = filters[maxKey];
    const maxMin = min ? addDaysYmd(min, 1) : undefined;
    const minMax = max ? addDaysYmd(max, -1) : undefined;
    return (
      <>
        <input
          type="date"
          aria-label={fromLabel}
          className={`${miniFieldCls} w-[5.5rem]`}
          value={min}
          max={minMax}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patchFilters({ [minKey]: e.target.value })}
        />
        <input
          type="date"
          aria-label={toLabel}
          className={`${miniFieldCls} w-[5.5rem]`}
          value={max}
          min={maxMin}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patchFilters({ [maxKey]: e.target.value })}
        />
      </>
    );
  };

  const renderAmountRangeInputs = () => {
    const min = filters.amountMin;
    const max = filters.amountMax;
    return (
      <>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          aria-label="Amount minimum"
          placeholder="Min"
          className={`${miniFieldCls} w-14`}
          value={min}
          max={max ? maxAmountBefore(max) : undefined}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patchFilters({ amountMin: e.target.value })}
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          aria-label="Amount maximum"
          placeholder="Max"
          className={`${miniFieldCls} w-14`}
          value={max}
          min={min ? minAmountAfter(min) : undefined}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patchFilters({ amountMax: e.target.value })}
        />
      </>
    );
  };

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

  const handleDelete = async (inv: BoxInvoiceSummary) => {
    if (
      !window.confirm(
        `Delete invoice "${inv.invoice_number}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(inv.id);
    setError(null);
    try {
      await invoicingAPI.deleteBoxInvoice(inv.id);
      if (previewInvoiceId === inv.id) {
        closePreview();
      }
      await loadInvoices();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const showScroll = !loading && invoices.length > 0;

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
          onClick={() => setShowGeneration(true)}
          className={btnPrimary}
        >
          <FilePlus className="h-4 w-4 shrink-0" />
          Generate Invoice
        </button>
      </div>

      <div
        className={`w-full rounded-lg border shadow-sm transition-colors ${border} ${panel} ${
          showScroll ? "max-h-[calc(100vh-12rem)] overflow-auto" : ""
        }`}
      >
        <table className="w-full border-collapse text-sm">
          <thead
            className={`border-b ${border} ${showScroll ? "sticky top-0 z-10" : ""}`}
          >
            <tr>
              <th className={`${thCls} text-left min-w-[10.5rem]`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("date", "Date")}
                  {renderDateRangeInputs(
                    "dateMin",
                    "dateMax",
                    "Invoice date from",
                    "Invoice date to",
                  )}
                </div>
              </th>
              <th className={`${thCls} text-left min-w-40`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("companyName", "Company")}
                  <InvoiceBoxHeaderFilter
                    isDark={isDark}
                    value={filters.companyName}
                    onChange={(companyName) => patchFilters({ companyName })}
                    options={companyOptions}
                    ariaLabel="Filter by company name"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left min-w-32`}>Invoice #</th>
              <th className={`${thCls} text-left min-w-[8.5rem]`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("amount", "Amount")}
                  {renderAmountRangeInputs()}
                </div>
              </th>
              <th className={`${thCls} text-left min-w-44`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("deliverySite", "Delivery Site")}
                  <InvoiceBoxHeaderFilter
                    isDark={isDark}
                    value={filters.deliverySite}
                    onChange={(deliverySite) => patchFilters({ deliverySite })}
                    options={deliverySiteOptions}
                    ariaLabel="Filter by delivery site"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left min-w-[10.5rem]`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("sent", "Sent")}
                  {renderDateRangeInputs(
                    "sentMin",
                    "sentMax",
                    "Sent date from",
                    "Sent date to",
                  )}
                </div>
              </th>
              <th className={`${thCls} w-12 px-2`} aria-label="Actions" />
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
            ) : visibleInvoices.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No invoices match the current filters.
                </td>
              </tr>
            ) : (
              visibleInvoices.map((inv) => (
                <tr
                  key={inv.id}
                  className={`cursor-pointer transition-[background-color] ${
                    isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                  } ${openingId === inv.id || deletingId === inv.id ? "opacity-60" : ""}`}
                  style={{ height: 52 }}
                  onClick={() => void openInvoice(inv)}
                >
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatDate(inv.invoice_date)}
                  </td>
                  <td className={`px-3 py-2 ${textMain}`}>
                    {inv.company_name?.trim() || "—"}
                  </td>
                  <td className={`px-3 py-2 font-medium ${textMain}`}>
                    {inv.invoice_number}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatCurrency(Number(inv.total_amount))}
                  </td>
                  <td className={`px-3 py-2 ${textMain}`}>
                    {inv.delivery_site_name}
                  </td>
                  <td className={`px-3 py-2 ${muted}`}>
                    {inv.sent_at
                      ? new Date(inv.sent_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(inv);
                      }}
                      disabled={deletingId === inv.id}
                      className={`rounded p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                        isDark
                          ? "text-red-400 hover:bg-slate-600"
                          : "text-red-600 hover:bg-red-50"
                      }`}
                      aria-label={`Delete invoice ${inv.invoice_number}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasActiveFilters && !loading && invoices.length > 0 ? (
        <p className={`mt-2 text-xs ${muted}`}>
          Showing {visibleInvoices.length} of {invoices.length} invoices
        </p>
      ) : null}

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

      {showGeneration ? (
        <InvoiceGenerationModal
          isDark={isDark}
          onClose={() => setShowGeneration(false)}
          onInvoiceSaved={() => {
            setShowGeneration(false);
            void loadInvoices();
          }}
        />
      ) : null}
    </div>
  );
}
