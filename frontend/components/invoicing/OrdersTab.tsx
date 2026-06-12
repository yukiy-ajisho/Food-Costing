"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FilePlus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import { invoicingAPI, type OrderSummary } from "@/lib/invoicing";
import { formatCurrency } from "@/lib/invoicingCalc";
import {
  EMPTY_ORDERS_FILTERS,
  filterOrdersRows,
  nextOrdersSortState,
  sortOrdersRows,
  uniqueSortedValues,
  type OrdersFilters,
  type OrdersSortKey,
  type OrdersSortState,
} from "@/lib/ordersTable";
import {
  orderToPreviewPayload,
  type GeneratePreviewPayload,
} from "@/lib/invoicingPreview";
import { OrdersHeaderFilter } from "./OrdersHeaderFilter";
import { OrdersHeaderRangeFilter } from "./OrdersHeaderRangeFilter";
import { OrderInvoicePreviewModal } from "./OrderInvoicePreviewModal";
import { CreateOrderModal } from "./CreateOrderModal";
import { formatInvoiceDateDisplay } from "@/lib/invoicingDateTime";
import {
  buildClosedPeriodSet,
  isOrderLocked,
} from "@/lib/invoicingLedger";

const DEFAULT_SORT: OrdersSortState = { key: "date", ascending: false };

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const formatted = formatInvoiceDateDisplay(value);
  return formatted || value;
}

export function OrdersTab() {
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] =
    useState<GeneratePreviewPayload | null>(null);
  const [previewOrderId, setPreviewOrderId] = useState<string | null>(null);
  const [previewSentAt, setPreviewSentAt] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showGeneration, setShowGeneration] = useState(false);
  const [filters, setFilters] = useState<OrdersFilters>(EMPTY_ORDERS_FILTERS);
  const [sort, setSort] = useState<OrdersSortState>(DEFAULT_SORT);
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
  const btnShowInvoice =
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
    (isDark
      ? "border-slate-500 text-slate-100 hover:bg-slate-600"
      : "border-gray-300 text-gray-800 hover:bg-gray-50");

  const companyOptions = useMemo(
    () => uniqueSortedValues(orders.map((o) => o.company_name ?? "")),
    [orders],
  );
  const deliverySiteOptions = useMemo(
    () =>
      uniqueSortedValues(orders.map((o) => o.delivery_site_name ?? "")),
    [orders],
  );

  const visibleOrders = useMemo(() => {
    const filtered = filterOrdersRows(orders, filters);
    return sortOrdersRows(filtered, sort);
  }, [orders, filters, sort]);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((value) => value.trim() !== ""),
    [filters],
  );

  const loadOrders = useCallback(async () => {
    if (!selectedTenantId) {
      setOrders([]);
      setClosedByAccount(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [ordersData, closedData] = await Promise.all([
        invoicingAPI.listOrders(),
        invoicingAPI.listClosedPeriods(),
      ]);
      setOrders(ordersData.orders ?? []);
      setClosedByAccount(buildClosedPeriodSet(closedData.closed_periods ?? []));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setFilters(EMPTY_ORDERS_FILTERS);
    setSort(DEFAULT_SORT);
    setPreviewPayload(null);
    setPreviewOrderId(null);
    setPreviewSentAt(null);
    setShowGeneration(false);
  }, [selectedTenantId]);

  const patchFilters = (patch: Partial<OrdersFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleSortClick = (column: OrdersSortKey) => {
    setSort((prev) => nextOrdersSortState(prev, column));
  };

  const renderSortButton = (column: OrdersSortKey, label: string) => {
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

  const openInvoice = async (summary: OrderSummary) => {
    setOpeningId(summary.id);
    setError(null);
    try {
      const data = await invoicingAPI.getOrder(summary.id);
      setPreviewPayload(orderToPreviewPayload(data.order));
      setPreviewOrderId(data.order.id);
      setPreviewSentAt(data.order.first_invoice_sent_at);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load order");
    } finally {
      setOpeningId(null);
    }
  };

  const closePreview = () => {
    setPreviewPayload(null);
    setPreviewOrderId(null);
    setPreviewSentAt(null);
  };

  const handleDelete = async (order: OrderSummary) => {
    if (isOrderLocked(order, closedByAccount)) {
      setError("This order is in a closed period and cannot be deleted.");
      return;
    }
    if (
      !window.confirm(
        `Delete order "${order.invoice_number}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(order.id);
    setError(null);
    try {
      await invoicingAPI.deleteOrder(order.id);
      if (previewOrderId === order.id) {
        closePreview();
      }
      await loadOrders();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const showScroll = !loading && orders.length > 0;

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
          Create Order
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
              <th className={`${thCls} text-left`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("date", "Order Created Date")}
                  <OrdersHeaderRangeFilter
                    isDark={isDark}
                    kind="date"
                    min={filters.dateMin}
                    max={filters.dateMax}
                    onChange={(dateMin, dateMax) =>
                      patchFilters({ dateMin, dateMax })
                    }
                    ariaLabel="Filter by order created date"
                    fromLabel="From"
                    toLabel="To"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left min-w-40`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("companyName", "Company")}
                  <OrdersHeaderFilter
                    isDark={isDark}
                    value={filters.companyName}
                    onChange={(companyName) => patchFilters({ companyName })}
                    options={companyOptions}
                    ariaLabel="Filter by company name"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left min-w-32`}>Invoice #</th>
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
              <th className={`${thCls} text-left min-w-44`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("deliverySite", "Delivery Site")}
                  <OrdersHeaderFilter
                    isDark={isDark}
                    value={filters.deliverySite}
                    onChange={(deliverySite) => patchFilters({ deliverySite })}
                    options={deliverySiteOptions}
                    ariaLabel="Filter by delivery site"
                  />
                </div>
              </th>
              <th className={`${thCls} text-left`}>
                <div className="flex items-center gap-1">
                  {renderSortButton("sent", "Sent Date")}
                  <OrdersHeaderRangeFilter
                    isDark={isDark}
                    kind="date"
                    min={filters.sentMin}
                    max={filters.sentMax}
                    onChange={(sentMin, sentMax) =>
                      patchFilters({ sentMin, sentMax })
                    }
                    ariaLabel="Filter by sent date"
                    fromLabel="From"
                    toLabel="To"
                  />
                </div>
              </th>
              <th className={`${thCls} w-36 px-2`} aria-label="Actions" />
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
            ) : orders.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No saved orders yet.
                </td>
              </tr>
            ) : visibleOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className={`px-4 py-8 text-center text-sm ${muted}`}
                >
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              visibleOrders.map((order) => (
                <tr
                  key={order.id}
                  className={`transition-[background-color] ${
                    openingId === order.id || deletingId === order.id
                      ? "opacity-60"
                      : ""
                  }`}
                  style={{ height: 52 }}
                >
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatDate(order.order_created_date)}
                  </td>
                  <td className={`px-3 py-2 ${textMain}`}>
                    {order.company_name?.trim() || "—"}
                  </td>
                  <td className={`px-3 py-2 font-medium ${textMain}`}>
                    {order.invoice_number}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${textMain}`}>
                    {formatCurrency(Number(order.total_amount))}
                  </td>
                  <td className={`px-3 py-2 ${textMain}`}>
                    {order.delivery_site_name}
                  </td>
                  <td className={`px-3 py-2 ${muted}`}>
                    {formatDate(order.first_invoice_sent_at)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void openInvoice(order)}
                        disabled={openingId === order.id}
                        className={btnShowInvoice}
                      >
                        Show Invoice
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(order)}
                        disabled={
                          deletingId === order.id ||
                          isOrderLocked(order, closedByAccount)
                        }
                        title={
                          isOrderLocked(order, closedByAccount)
                            ? "Closed period"
                            : undefined
                        }
                        className={`rounded p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                          isDark
                            ? "text-red-400 hover:bg-slate-600"
                            : "text-red-600 hover:bg-red-50"
                        }`}
                        aria-label={`Delete order ${order.invoice_number}`}
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

      {hasActiveFilters && !loading && orders.length > 0 ? (
        <p className={`mt-2 text-xs ${muted}`}>
          Showing {visibleOrders.length} of {orders.length} orders
        </p>
      ) : null}

      {previewPayload && previewOrderId ? (
        <OrderInvoicePreviewModal
          isDark={isDark}
          mode="orders"
          payload={previewPayload}
          orderId={previewOrderId}
          sentAt={previewSentAt}
          onClose={closePreview}
          onSent={() => void loadOrders()}
        />
      ) : null}

      {showGeneration ? (
        <CreateOrderModal
          isDark={isDark}
          onClose={() => setShowGeneration(false)}
          onOrderSaved={() => {
            setShowGeneration(false);
            void loadOrders();
          }}
        />
      ) : null}
    </div>
  );
}
