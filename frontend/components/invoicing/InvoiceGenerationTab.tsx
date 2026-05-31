"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { PricingListPickerRow } from "@/components/recipe-cost-report/PricingListPickerRow";
import { ItemKindBadge } from "@/components/recipe-cost-report/ItemKindBadge";
import {
  invoicingAPI,
  type InvoiceListItemRow,
  type InvoiceListSummary,
  type InvoicingItemCandidate,
  type DeliverySite,
} from "@/lib/invoicing";
import {
  computeInvoicingSubTotal,
  costPerKgFromBreakdown,
  eachGramsForInvoicing,
  formatCostPerKg,
  formatCurrency,
  getInvoicingUnitOptions,
  type InvoicingCostBreakdown,
} from "@/lib/invoicingCalc";
import { CreateInvoicingListModal } from "./CreateInvoicingListModal";
import {
  InvoiceGeneratePreviewModal,
} from "./InvoiceGeneratePreviewModal";
import type { GeneratePreviewPayload } from "@/lib/invoicingPreview";

type RowInput = {
  unitSize: string;
  unitSizeUnit: string;
  units: string;
};

type PendingAdd = {
  localId: string;
  item_id: string;
};

function newLocalId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_UNIT_SIZE_UNIT = "g";

function emptyRowInput(row?: InvoiceListItemRow): RowInput {
  return {
    unitSize:
      row?.unit_size != null && row.unit_size > 0 ? String(row.unit_size) : "",
    unitSizeUnit: row?.unit_size_unit?.trim() || DEFAULT_UNIT_SIZE_UNIT,
    units: "",
  };
}

/** Allow empty or a non-negative decimal while typing. */
function sanitizeDecimalInput(value: string): string {
  if (value === "") return "";
  if (/^\d*\.?\d*$/.test(value)) return value;
  return value.replace(/[^\d.]/g, "").replace(/^(\d*\.\d*).*$/, "$1");
}

/** Save: empty/invalid unit size → null. Generate still requires positive values. */
function unitSizeFieldsForSave(input: RowInput): {
  unit_size: number | null;
  unit_size_unit: string | null;
} {
  const unitSizeStr = input.unitSize.trim();
  if (!unitSizeStr || !/^\d+(\.\d+)?$/.test(unitSizeStr)) {
    return { unit_size: null, unit_size_unit: null };
  }
  const unitSizeNum = parseFloat(unitSizeStr);
  if (!Number.isFinite(unitSizeNum) || unitSizeNum <= 0) {
    return { unit_size: null, unit_size_unit: null };
  }
  return {
    unit_size: unitSizeNum,
    unit_size_unit: input.unitSizeUnit.trim() || DEFAULT_UNIT_SIZE_UNIT,
  };
}

function formatUnitSizeDisplay(input: RowInput): string {
  const n = parseFloat(input.unitSize);
  if (!Number.isFinite(n) || n <= 0 || !input.unitSizeUnit.trim()) {
    return "—";
  }
  return `${input.unitSize} ${input.unitSizeUnit}`;
}

export function InvoiceGenerationTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [lists, setLists] = useState<InvoiceListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [deliverySiteId, setDeliverySiteId] = useState("");
  const [deliverySiteName, setDeliverySiteName] = useState("");
  const [items, setItems] = useState<InvoiceListItemRow[]>([]);
  const [costs, setCosts] = useState<Record<string, InvoicingCostBreakdown>>(
    {},
  );
  const [rowInputs, setRowInputs] = useState<Map<string, RowInput>>(
    () => new Map(),
  );
  const [orderReceivedDate, setOrderReceivedDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");

  const [candidates, setCandidates] = useState<InvoicingItemCandidate[]>([]);
  const [deliverySites, setDeliverySites] = useState<DeliverySite[]>([]);

  const [loading, setLoading] = useState(false);
  const [costsLoading, setCostsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingAdds, setPendingAdds] = useState<PendingAdd[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] =
    useState<GeneratePreviewPayload | null>(null);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const panel = isDark ? "bg-slate-800" : "bg-white";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const inputCls = `rounded-md border px-2 py-1.5 text-sm tabular-nums ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const pendingInputCls = `h-10 rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const headerInputCls = `h-10 w-full min-w-[200px] rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const thCls = `h-14 align-middle px-4 py-3 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700/80" : "text-gray-500 bg-gray-50"
  }`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;
  const tableColSpan = 6;
  const trashButtonClass = (visible: boolean) =>
    `inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
      isDark
        ? "text-red-400 hover:bg-red-900/30"
        : "text-red-600 hover:bg-red-50"
    } ${visible ? "" : "invisible pointer-events-none"}`;
  const cardShell = `flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-sm ${panel} ${border}`;
  const listCreateBtn =
    "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnPrimary =
    "inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnSecondary = `inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
    isDark
      ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;
  const btnEdit =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-600 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700";

  const dateInputCls = `h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const dateReadOnlyCls = `flex h-10 w-full items-center rounded-lg border px-3 text-sm tabular-nums ${
    isDark
      ? "cursor-not-allowed border-slate-700 bg-slate-800/80 text-slate-500"
      : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500"
  }`;

  const renderDateField = (
    label: string,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <label className={`block text-sm ${textMain}`}>
      <span className={`mb-1 block text-xs font-medium ${muted}`}>{label}</span>
      {isEditMode ? (
        <div className={dateReadOnlyCls} aria-readonly title="Enter dates after saving list edits">
          {value.trim() || "—"}
        </div>
      ) : (
        <input
          type="date"
          className={dateInputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );

  const loadLists = useCallback(async () => {
    const data = await invoicingAPI.listInvoiceLists();
    setLists(data.lists ?? []);
  }, []);

  const loadCosts = useCallback(async (listId: string) => {
    setCostsLoading(true);
    try {
      const data = await invoicingAPI.getInvoiceListCosts(listId);
      setCosts(data.costs ?? {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load costs");
    } finally {
      setCostsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (listId: string, options?: { preserveGenerationInputs?: boolean }) => {
      const preserveGenerationInputs = options?.preserveGenerationInputs ?? false;
      setLoading(true);
      setError(null);
      if (!preserveGenerationInputs) {
        setIsEditMode(false);
        setPendingRemovals(new Set());
        setPendingAdds([]);
        setOrderReceivedDate("");
        setDeliveryDate("");
        setInvoiceDate("");
      }
      try {
        const data = await invoicingAPI.getInvoiceList(listId);
        setListName(data.list.name);
        setDeliverySiteId(data.list.delivery_site_id);
        setDeliverySiteName(data.delivery_site?.name ?? "");
        setItems(data.items);
        setRowInputs((prev) => {
          const inputs = new Map<string, RowInput>();
          for (const row of data.items) {
            const next = emptyRowInput(row);
            if (preserveGenerationInputs) {
              const existing = prev.get(row.item_id);
              if (existing?.units) {
                next.units = existing.units;
              }
            }
            inputs.set(row.item_id, next);
          }
          return inputs;
        });
        await loadCosts(listId);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load list");
      } finally {
        setLoading(false);
      }
    },
    [loadCosts],
  );

  useEffect(() => {
    void loadLists().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to load lists");
    });
    void invoicingAPI
      .getItemCandidates()
      .then((d) => setCandidates(d.items ?? []))
      .catch(() => {});
    void invoicingAPI
      .listDeliverySites()
      .then((d) => setDeliverySites(d.sites ?? []))
      .catch(() => {});
  }, [loadLists]);

  useEffect(() => {
    if (!selectedListId) return;
    void loadDetail(selectedListId);
  }, [selectedListId, loadDetail]);

  const candidateById = useMemo(() => {
    const map = new Map<string, InvoicingItemCandidate>();
    for (const c of candidates) map.set(c.id, c);
    return map;
  }, [candidates]);

  const visibleItems = useMemo(() => {
    const removed = pendingRemovals;
    return items.filter((row) => !removed.has(row.item_id));
  }, [items, pendingRemovals]);

  const canGenerate = useMemo(() => {
    if (loading || costsLoading) return false;
    if (!invoiceDate.trim()) return false;
    if (visibleItems.length === 0) return false;
    for (const row of visibleItems) {
      const input = rowInputs.get(row.item_id) ?? emptyRowInput(row);
      const unitSize = parseFloat(input.unitSize);
      const units = parseFloat(input.units);
      const unitSizeUnit = input.unitSizeUnit.trim();
      if (!Number.isFinite(unitSize) || unitSize <= 0) return false;
      if (!unitSizeUnit) return false;
      if (!Number.isFinite(units) || units <= 0) return false;
      if (costPerKgFromBreakdown(costs[row.item_id]) == null) return false;
    }
    return true;
  }, [
    loading,
    costsLoading,
    invoiceDate,
    visibleItems,
    rowInputs,
    costs,
  ]);

  const updateRowInput = (
    itemId: string,
    patch: Partial<RowInput>,
  ) => {
    setRowInputs((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? emptyRowInput();
      next.set(itemId, { ...current, ...patch });
      return next;
    });
  };

  const handleCreateList = async (payload: {
    name: string;
    delivery_site_id: string;
    item_ids: string[];
  }) => {
    setError(null);
    try {
      const data = await invoicingAPI.createInvoiceList(payload);
      setShowCreate(false);
      await loadLists();
      setSelectedListId(data.list.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create list");
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (!window.confirm("Delete this invoice list?")) return;
    setError(null);
    try {
      await invoicingAPI.deleteInvoiceList(listId);
      if (selectedListId === listId) {
        setSelectedListId(null);
        setItems([]);
      }
      await loadLists();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete list");
    }
  };

  const handleEditCancel = () => {
    setIsEditMode(false);
    setPendingRemovals(new Set());
    setPendingAdds([]);
    if (selectedListId) void loadDetail(selectedListId);
  };

  const handleSaveEdit = async () => {
    if (!selectedListId) return;
    const trimmedName = listName.trim();
    if (!trimmedName) {
      setError("List name is required.");
      return;
    }
    if (!deliverySiteId) {
      setError("Delivery site is required.");
      return;
    }

    const kept = items.filter((row) => !pendingRemovals.has(row.item_id));
    const addRows: InvoiceListItemRow[] = pendingAdds
      .filter((p) => p.item_id)
      .map((p, idx) => {
        const c = candidateById.get(p.item_id)!;
        return {
          item_id: p.item_id,
          name: c.name,
          is_menu_item: c.is_menu_item,
          each_grams: c.each_grams,
          proceed_yield_amount: c.proceed_yield_amount,
          proceed_yield_unit: c.proceed_yield_unit,
          unit_size: null,
          unit_size_unit: null,
          sort_order: kept.length + idx,
        };
      });
    const merged = [...kept, ...addRows];

    setSaving(true);
    setError(null);
    try {
      const lines = merged.map((row, sort_order) => {
        const input = rowInputs.get(row.item_id) ?? emptyRowInput(row);
        const { unit_size, unit_size_unit } = unitSizeFieldsForSave(input);
        return {
          item_id: row.item_id,
          unit_size,
          unit_size_unit,
          sort_order,
        };
      });

      await invoicingAPI.updateInvoiceList(selectedListId, {
        name: trimmedName,
        delivery_site_id: deliverySiteId,
        lines,
      });
      setIsEditMode(false);
      setPendingRemovals(new Set());
      setPendingAdds([]);
      await loadDetail(selectedListId, { preserveGenerationInputs: true });
      await loadLists();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save list");
    } finally {
      setSaving(false);
    }
  };

  const handleAddPendingRow = () => {
    setPendingAdds((prev) => [
      { localId: newLocalId(), item_id: "" },
      ...prev,
    ]);
  };

  const handleGenerate = () => {
    setError(null);
    if (!selectedListId) return;
    if (!invoiceDate.trim()) {
      setError("Invoice *Date is required before Generate.");
      return;
    }

    const rows: GeneratePreviewPayload["rows"] = [];
    for (const row of visibleItems) {
      const input = rowInputs.get(row.item_id) ?? emptyRowInput(row);
      const unitSize = parseFloat(input.unitSize);
      const units = parseFloat(input.units);
      const unitSizeUnit = input.unitSizeUnit.trim();

      if (!Number.isFinite(unitSize) || unitSize <= 0) {
        setError(`Unit Size is required for "${row.name}".`);
        return;
      }
      if (!unitSizeUnit) {
        setError(`Unit Size unit is required for "${row.name}".`);
        return;
      }
      if (!Number.isFinite(units) || units <= 0) {
        setError(`Units is required for "${row.name}".`);
        return;
      }

      const costPerKg = costPerKgFromBreakdown(costs[row.item_id]);
      if (costPerKg == null) {
        setError(`Cost is unavailable for "${row.name}".`);
        return;
      }

      const subTotal = computeInvoicingSubTotal(
        unitSize,
        unitSizeUnit,
        units,
        costPerKg,
        eachGramsForInvoicing(row),
      );

      rows.push({
        itemId: row.item_id,
        name: row.name,
        unitSize,
        unitSizeUnit,
        units,
        costPerKg,
        subTotal,
      });
    }

    if (rows.length === 0) {
      setError("Add at least one item to the list.");
      return;
    }

    const totalAmount = rows.reduce((sum, r) => sum + r.subTotal, 0);
    setPreviewPayload({
      listId: selectedListId,
      deliverySiteId,
      listName,
      deliverySiteName,
      orderReceivedDate,
      deliveryDate,
      invoiceDate,
      rows,
      totalAmount,
    });
  };

  const handleInvoiceSaved = async (emailWarning?: string) => {
    setPreviewPayload(null);
    setOrderReceivedDate("");
    setDeliveryDate("");
    setInvoiceDate("");
    setRowInputs((prev) => {
      const next = new Map(prev);
      for (const [itemId, input] of next) {
        next.set(itemId, { ...input, units: "" });
      }
      return next;
    });
    if (selectedListId) {
      await loadDetail(selectedListId);
    }
    if (emailWarning) {
      setError(`Invoice saved, but email failed: ${emailWarning}`);
    } else {
      setError(null);
    }
  };

  const renderRow = (
    row: InvoiceListItemRow,
    editableRemove: boolean,
    options?: { pendingAdd?: boolean; onRemove?: () => void },
  ) => {
    const input = rowInputs.get(row.item_id) ?? emptyRowInput(row);
    const unitOptions = getInvoicingUnitOptions(row);
    const effectiveEachGrams = eachGramsForInvoicing(row);
    const costPerKg = costPerKgFromBreakdown(costs[row.item_id]);
    const unitSizeNum = parseFloat(input.unitSize);
    const unitsNum = parseFloat(input.units);
    const subTotal =
      Number.isFinite(unitSizeNum) &&
      unitSizeNum > 0 &&
      input.unitSizeUnit &&
      Number.isFinite(unitsNum) &&
      unitsNum > 0 &&
      costPerKg != null
        ? computeInvoicingSubTotal(
            unitSizeNum,
            input.unitSizeUnit,
            unitsNum,
            costPerKg,
            effectiveEachGrams,
          )
        : null;

    return (
      <tr
        key={row.item_id}
        className={
          options?.pendingAdd
            ? isDark
              ? "bg-emerald-900/15"
              : "bg-emerald-50/80"
            : isDark
              ? "hover:bg-slate-700/50"
              : "hover:bg-gray-50"
        }
        style={{ height: 52 }}
      >
        <td className={`px-4 py-2 font-medium ${textMain}`}>
          <div className="flex items-center gap-2">
            <span>{row.name}</span>
            <ItemKindBadge isMenuItem={row.is_menu_item} isDark={isDark} />
          </div>
        </td>
        <td className="px-4 py-2">
          {isEditMode ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                className={`${inputCls} w-24`}
                value={input.unitSize}
                onChange={(e) =>
                  updateRowInput(row.item_id, {
                    unitSize: sanitizeDecimalInput(e.target.value),
                  })
                }
              />
              <select
                className={`${inputCls} min-w-20`}
                value={input.unitSizeUnit}
                onChange={(e) =>
                  updateRowInput(row.item_id, {
                    unitSizeUnit: e.target.value,
                  })
                }
              >
                {unitOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className={`tabular-nums ${textMain}`}>
              {formatUnitSizeDisplay(input)}
            </span>
          )}
        </td>
        <td className="px-4 py-2">
          {!isEditMode ? (
            <input
              type="number"
              min="0"
              step="any"
              className={`${inputCls} w-24`}
              value={input.units}
              onChange={(e) =>
                updateRowInput(row.item_id, { units: e.target.value })
              }
            />
          ) : (
            <span className={`tabular-nums ${textMain}`}>
              {input.units.trim() || "—"}
            </span>
          )}
        </td>
        <td className={`px-4 py-2 tabular-nums ${muted}`}>
          {costsLoading ? "…" : formatCostPerKg(costs[row.item_id])}
        </td>
        <td className={`px-4 py-2 tabular-nums font-medium ${textMain}`}>
          {subTotal != null ? formatCurrency(subTotal) : "—"}
        </td>
        <td className="w-16 whitespace-nowrap px-4 py-2">
          <button
            type="button"
            title={editableRemove ? "Remove from list" : undefined}
            disabled={!editableRemove}
            onClick={() => {
              if (!editableRemove) return;
              if (options?.onRemove) {
                options.onRemove();
              } else {
                setPendingRemovals((prev) => new Set(prev).add(row.item_id));
              }
            }}
            className={trashButtonClass(editableRemove)}
            aria-hidden={!editableRemove}
            aria-label={`Remove ${row.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden gap-4">
      <aside className={`${cardShell} h-full min-h-0 w-[240px] shrink-0`}>
        <div className="shrink-0 px-4 pb-3 pt-4">
          <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>
            Invoice list name
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className={`${listCreateBtn} mt-3`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            Create New List
          </button>
        </div>
        <div className={`shrink-0 border-b ${border}`} />
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {lists.length === 0 ? (
            <li className={`px-3 py-8 text-center text-sm ${muted}`}>
              No lists yet
            </li>
          ) : (
            lists.map((list) => (
              <PricingListPickerRow
                key={list.id}
                name={list.name}
                active={selectedListId === list.id}
                isDark={isDark}
                menuOpen={openListMenuId === list.id}
                onSelect={() => setSelectedListId(list.id)}
                onToggleMenu={() =>
                  setOpenListMenuId((id) => (id === list.id ? null : list.id))
                }
                onCloseMenu={() => setOpenListMenuId(null)}
                onDelete={() => void handleDeleteList(list.id)}
              />
            ))
          )}
        </ul>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedListId ? (
          <div
            className={`flex flex-1 items-center justify-center rounded-lg border ${border} ${panel} p-12 text-sm ${muted}`}
          >
            Select a list or create a new one.
          </div>
        ) : loading ? (
          <div
            className={`flex flex-1 items-center justify-center rounded-lg border ${border} ${panel} p-12 text-sm ${muted}`}
          >
            Loading…
          </div>
        ) : (
          <>
            <div
              className={`mb-4 flex shrink-0 flex-wrap items-end justify-between gap-4 rounded-lg border px-4 py-3 ${border} ${panel}`}
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4">
                <div className="min-w-[200px] flex-1">
                  {isEditMode ? (
                    <input
                      type="text"
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      aria-label="List name"
                      className={headerInputCls}
                    />
                  ) : (
                    <h2
                      className={`flex min-h-10 items-center text-lg font-semibold ${textMain}`}
                    >
                      {listName}
                    </h2>
                  )}
                </div>
                <div className="min-w-[200px]">
                  {isEditMode ? (
                    <>
                      <label
                        htmlFor="invoicing-delivery-site-select"
                        className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
                      >
                        Delivery site
                      </label>
                      <select
                        id="invoicing-delivery-site-select"
                        value={deliverySiteId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setDeliverySiteId(id);
                          const site = deliverySites.find((s) => s.id === id);
                          setDeliverySiteName(site?.name ?? "");
                        }}
                        className={headerInputCls}
                      >
                        <option value="">Select delivery site</option>
                        {deliverySites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <p className={`flex min-h-10 items-center text-sm ${muted}`}>
                      Delivery site: {deliverySiteName || "—"}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isEditMode ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveEdit()}
                      className={btnPrimary}
                    >
                      <Save className="h-4 w-4" />
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleEditCancel}
                      className={btnSecondary}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsEditMode(true)}
                      className={btnEdit}
                    >
                      <Edit className="h-4 w-4 shrink-0" />
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={!canGenerate}
                      onClick={handleGenerate}
                      className={btnPrimary}
                    >
                      Generate
                    </button>
                  </>
                )}
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <div
              className={`mb-4 shrink-0 rounded-lg border px-4 py-3 ${border} ${panel}`}
            >
              {isEditMode ? (
                <p className={`mb-3 text-xs ${muted}`}>
                  Dates are set when generating an invoice (after Save).
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-3">
                {renderDateField("Order Received", orderReceivedDate, setOrderReceivedDate)}
                {renderDateField("Delivery Date", deliveryDate, setDeliveryDate)}
                {renderDateField("Invoice *Date", invoiceDate, setInvoiceDate)}
              </div>
            </div>

            <div
              className={`min-h-0 flex-1 overflow-auto rounded-lg border ${border} ${panel}`}
            >
              <table className="w-full border-collapse text-sm">
                <thead className={`sticky top-0 z-10 border-b ${border}`}>
                  <tr>
                    <th className={`${thCls} text-left min-w-48`}>Name</th>
                    <th className={`${thCls} text-left`}>Unit Size</th>
                    <th className={`${thCls} text-left w-24`}>Units</th>
                    <th className={`${thCls} text-left w-40`}>Cost</th>
                    <th className={`${thCls} text-left w-32`}>Sub total</th>
                    <th className={`${thCls} w-16`} aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody className={tbodyRowDividerCls}>
                  {isEditMode ? (
                    <tr style={{ height: 52 }}>
                      <td colSpan={tableColSpan} className="px-4 py-2">
                        <button
                          type="button"
                          onClick={handleAddPendingRow}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm transition-colors ${
                            isDark
                              ? "text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
                              : "text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                          }`}
                        >
                          <Plus className="h-4 w-4 shrink-0" />
                          <span>Add item</span>
                        </button>
                      </td>
                    </tr>
                  ) : null}
                  {isEditMode &&
                    pendingAdds.map((pending) => {
                      const selected = candidateById.get(pending.item_id);
                      if (pending.item_id && selected) {
                        const pseudoRow: InvoiceListItemRow = {
                          item_id: pending.item_id,
                          name: selected.name,
                          is_menu_item: selected.is_menu_item,
                          each_grams: selected.each_grams,
                          proceed_yield_amount: selected.proceed_yield_amount,
                          proceed_yield_unit: selected.proceed_yield_unit,
                          unit_size: null,
                          unit_size_unit: null,
                          sort_order: 0,
                        };
                        return renderRow(pseudoRow, true, {
                          pendingAdd: true,
                          onRemove: () =>
                            setPendingAdds((prev) =>
                              prev.filter((p) => p.localId !== pending.localId),
                            ),
                        });
                      }
                      return (
                        <tr
                          key={pending.localId}
                          className={
                            isDark ? "bg-emerald-900/15" : "bg-emerald-50/80"
                          }
                          style={{ height: 52 }}
                        >
                          <td className="px-4 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <select
                                className={`${pendingInputCls} min-w-0 flex-1`}
                                value={pending.item_id}
                                onChange={(e) => {
                                  const itemId = e.target.value;
                                  setPendingAdds((prev) =>
                                    prev.map((p) =>
                                      p.localId === pending.localId
                                        ? { ...p, item_id: itemId }
                                        : p,
                                    ),
                                  );
                                }}
                                aria-label="Item to add"
                              >
                                <option value="">Select item…</option>
                                {candidates
                                  .filter(
                                    (c) =>
                                      !items.some(
                                        (i) =>
                                          i.item_id === c.id &&
                                          !pendingRemovals.has(c.id),
                                      ) &&
                                      !pendingAdds.some(
                                        (p) =>
                                          p.item_id === c.id &&
                                          p.localId !== pending.localId,
                                      ),
                                  )
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                      {c.is_menu_item ? " (Menu)" : " (Prepped)"}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </td>
                          <td className={`px-4 py-2 ${muted}`}>—</td>
                          <td className={`px-4 py-2 ${muted}`}>—</td>
                          <td className={`px-4 py-2 ${muted}`}>—</td>
                          <td className={`px-4 py-2 ${muted}`}>—</td>
                          <td className="w-16 whitespace-nowrap px-4 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPendingAdds((prev) =>
                                  prev.filter(
                                    (p) => p.localId !== pending.localId,
                                  ),
                                )
                              }
                              className={trashButtonClass(true)}
                              aria-label="Remove row"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {visibleItems.map((row) => renderRow(row, isEditMode))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showCreate ? (
        <CreateInvoicingListModal
          isDark={isDark}
          candidates={candidates}
          deliverySites={deliverySites}
          onClose={() => setShowCreate(false)}
          onCreate={(payload) => void handleCreateList(payload)}
        />
      ) : null}

      {previewPayload ? (
        <InvoiceGeneratePreviewModal
          isDark={isDark}
          payload={previewPayload}
          onClose={() => setPreviewPayload(null)}
          onSaved={(warning) => void handleInvoiceSaved(warning)}
        />
      ) : null}
    </div>
  );
}
