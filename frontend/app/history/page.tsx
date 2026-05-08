"use client";

import { useEffect, useMemo, useState } from "react";
import { priceEventsAPI, type PriceHistoryRow } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function parseEventTime(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** API は base item 名を ", " 区切りで返す。 */
function splitBaseItemNames(aggregated: string): string[] {
  if (!aggregated.trim()) return [];
  return aggregated
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** select の value: base item 名が無いグループのみ表示 */
const FILTER_UNMAPPED = "__unmapped__";

export default function HistoryPage() {
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";

  const [rows, setRows] = useState<PriceHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const baseItemNameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      for (const n of splitBaseItemNames(r.base_item_names || "")) {
        names.add(n);
      }
    }
    return [...names].sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }),
    );
  }, [rows]);

  const hasUnmappedGroups = useMemo(
    () => rows.some((r) => splitBaseItemNames(r.base_item_names || "").length === 0),
    [rows],
  );

  const [selectedBaseItemName, setSelectedBaseItemName] = useState("");

  const filteredRows = useMemo(() => {
    let result = rows;

    if (selectedBaseItemName === FILTER_UNMAPPED) {
      result = result.filter(
        (r) => splitBaseItemNames(r.base_item_names || "").length === 0,
      );
    } else if (selectedBaseItemName !== "") {
      result = result.filter((r) =>
        splitBaseItemNames(r.base_item_names || "").includes(selectedBaseItemName),
      );
    }

    return [...result].sort(
      (a, b) => parseEventTime(b.created_at) - parseEventTime(a.created_at),
    );
  }, [rows, selectedBaseItemName]);

  useEffect(() => {
    if (!selectedTenantId) {
      setRows([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErrorMessage(null);
      setPermissionDenied(false);
      try {
        const data = await priceEventsAPI.getHistory();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
          setRows([]);
        } else {
          setErrorMessage(msg);
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  useEffect(() => {
    setSelectedBaseItemName("");
  }, [selectedTenantId]);

  useEffect(() => {
    if (selectedBaseItemName === "" || selectedBaseItemName === FILTER_UNMAPPED) {
      return;
    }
    if (!baseItemNameOptions.includes(selectedBaseItemName)) {
      setSelectedBaseItemName("");
    }
  }, [baseItemNameOptions, selectedBaseItemName]);

  const shell = `rounded-lg border overflow-hidden shadow-sm ${
    isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
  }`;
  const thCls = `px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${
    isDark ? "text-slate-400 bg-slate-900/50" : "text-gray-600 bg-gray-50"
  }`;
  const tdCls = `px-3 py-2 text-sm align-top ${
    isDark ? "text-slate-200 border-t border-slate-700" : "text-gray-800 border-t border-gray-100"
  }`;

  if (permissionDenied) {
    return (
      <div className="p-6">
        <p className={isDark ? "text-slate-300" : "text-gray-700"}>
          You do not have permission to view price history for this tenant.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer">
      {!selectedTenantId ? (
        <p className={isDark ? "text-slate-400" : "text-gray-600"}>
          Select a tenant to load history.
        </p>
      ) : errorMessage ? (
        <p className={isDark ? "text-red-400" : "text-red-600"}>{errorMessage}</p>
      ) : loading ? (
        <p className={isDark ? "text-slate-400" : "text-gray-600"}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={isDark ? "text-slate-400" : "text-gray-600"}>
          No price events for this tenant yet.
        </p>
      ) : (
        <div className="flex flex-col gap-0">
          <div className="mb-4 max-w-md">
            <label
              htmlFor="history-base-item-filter"
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Filter by base item
            </label>
            <select
              id="history-base-item-filter"
              value={selectedBaseItemName}
              onChange={(e) => setSelectedBaseItemName(e.target.value)}
              className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                isDark
                  ? "bg-slate-700 border-slate-600 text-slate-100"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
            >
              <option value="">All</option>
              {hasUnmappedGroups ? (
                <option value={FILTER_UNMAPPED}>(No base item linked)</option>
              ) : null}
              {baseItemNameOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {filteredRows.length === 0 ? (
            <p className={isDark ? "text-slate-400" : "text-gray-600"}>
              No price events match this base item filter.
            </p>
          ) : null}

          {filteredRows.length > 0 ? (
            <div className={shell}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] table-fixed border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Base Item</th>
                      <th className={thCls}>Product</th>
                      <th className={thCls}>Brand</th>
                      <th className={thCls}>Size</th>
                      <th className={thCls}>Case</th>
                      <th className={thCls}>Price</th>
                      <th className={thCls}>Source</th>
                      <th className={thCls}>Invoice</th>
                      <th className={thCls}>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r.price_event_id}>
                        <td className={tdCls}>{r.base_item_names || "—"}</td>
                        <td
                          className={`${tdCls} truncate`}
                          title={r.product_name ?? "—"}
                        >
                          {r.product_name ?? "—"}
                        </td>
                        <td className={tdCls}>{r.brand_name ?? "—"}</td>
                        <td className={tdCls}>
                          {r.purchase_quantity != null ? r.purchase_quantity : "—"}
                          {r.purchase_unit ? `\u00A0${r.purchase_unit}` : ""}
                        </td>
                        <td className={tdCls}>
                          {r.purchase_unit === "case"
                            ? r.case_unit != null
                              ? r.case_unit
                              : "-"
                            : "-"}
                        </td>
                        <td className={tdCls}>{`$${r.price.toFixed(2)}`}</td>
                        <td className={tdCls}>{r.source_type}</td>
                        <td className={`${tdCls} font-mono text-xs`}>
                          {r.invoice_id ?? "—"}
                        </td>
                        <td className={tdCls}>{formatEventDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
