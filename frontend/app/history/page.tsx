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

type VvpHistoryGroup = {
  virtual_vendor_product_id: string;
  base_item_names: string;
  product_name: string | null;
  brand_name: string | null;
  purchase_quantity: number | null;
  purchase_unit: string | null;
  events: Array<{
    price_event_id: string;
    price: number;
    source_type: string;
    invoice_id: string | null;
    created_at: string;
  }>;
};

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

/** virtual_vendor_product_id 単位でまとめ、各グループ内は created_at 昇順。グループ間は直近イベントが新しい順。 */
function buildVvpGroups(rows: PriceHistoryRow[]): VvpHistoryGroup[] {
  const byVvp = new Map<string, PriceHistoryRow[]>();
  for (const r of rows) {
    const id = r.virtual_vendor_product_id;
    if (!byVvp.has(id)) byVvp.set(id, []);
    byVvp.get(id)!.push(r);
  }

  const groups: VvpHistoryGroup[] = [];

  for (const [virtual_vendor_product_id, list] of byVvp) {
    const sortedEvents = [...list].sort(
      (a, b) => parseEventTime(a.created_at) - parseEventTime(b.created_at),
    );
    const meta = sortedEvents[0];
    groups.push({
      virtual_vendor_product_id,
      base_item_names: meta.base_item_names,
      product_name: meta.product_name,
      brand_name: meta.brand_name,
      purchase_quantity: meta.purchase_quantity,
      purchase_unit: meta.purchase_unit,
      events: sortedEvents.map((r) => ({
        price_event_id: r.price_event_id,
        price: r.price,
        source_type: r.source_type,
        invoice_id: r.invoice_id,
        created_at: r.created_at,
      })),
    });
  }

  groups.sort((a, b) => {
    const aMax = Math.max(...a.events.map((e) => parseEventTime(e.created_at)));
    const bMax = Math.max(...b.events.map((e) => parseEventTime(e.created_at)));
    return bMax - aMax;
  });

  return groups;
}

export default function HistoryPage() {
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";

  const [rows, setRows] = useState<PriceHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const groups = useMemo(() => buildVvpGroups(rows), [rows]);

  const baseItemNameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const g of groups) {
      for (const n of splitBaseItemNames(g.base_item_names || "")) {
        names.add(n);
      }
    }
    return [...names].sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }),
    );
  }, [groups]);

  const hasUnmappedGroups = useMemo(
    () =>
      groups.some(
        (g) => splitBaseItemNames(g.base_item_names || "").length === 0,
      ),
    [groups],
  );

  const [selectedBaseItemName, setSelectedBaseItemName] = useState("");

  const filteredGroups = useMemo(() => {
    if (selectedBaseItemName === "") return groups;
    if (selectedBaseItemName === FILTER_UNMAPPED) {
      return groups.filter(
        (g) => splitBaseItemNames(g.base_item_names || "").length === 0,
      );
    }
    return groups.filter((g) =>
      splitBaseItemNames(g.base_item_names || "").includes(
        selectedBaseItemName,
      ),
    );
  }, [groups, selectedBaseItemName]);

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

  const groupShell = `rounded-lg border overflow-hidden shadow-sm mb-6 last:mb-0 ${
    isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200"
  }`;

  const thCls = `w-1/4 text-left text-xs font-semibold uppercase tracking-wide px-3 py-2 ${
    isDark ? "text-slate-400 bg-slate-900/50" : "text-gray-600 bg-gray-50"
  }`;

  const tdCls = `w-1/4 wrap-break-word px-3 py-2 text-sm align-top ${
    isDark ? "text-slate-200 border-t border-slate-700" : "text-gray-800 border-t border-gray-100"
  }`;

  const headerBand = `px-4 py-3 border-b ${
    isDark
      ? "border-slate-600 bg-slate-900/40"
      : "border-gray-200 bg-gray-50"
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
    <div className="p-6 max-w-[1600px] mx-auto">
      {!selectedTenantId ? (
        <p className={isDark ? "text-slate-400" : "text-gray-600"}>
          Select a tenant to load history.
        </p>
      ) : errorMessage ? (
        <p className={isDark ? "text-red-400" : "text-red-600"}>{errorMessage}</p>
      ) : loading ? (
        <p className={isDark ? "text-slate-400" : "text-gray-600"}>Loading…</p>
      ) : groups.length === 0 ? (
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

          {filteredGroups.length === 0 ? (
            <p className={isDark ? "text-slate-400" : "text-gray-600"}>
              No vendor items match this base item filter.
            </p>
          ) : null}

          {filteredGroups.map((g) => (
            <div key={g.virtual_vendor_product_id} className={groupShell}>
              <div className={headerBand}>
                <div
                  className={`flex w-full justify-start ${
                    isDark ? "text-slate-200" : "text-gray-800"
                  }`}
                >
                  <div className="grid w-[60%] min-w-0 grid-cols-[3fr_3fr_3fr_1fr] gap-x-4 text-sm">
                    <div className="min-w-0 wrap-break-word">
                      <span
                        className={
                          isDark ? "text-slate-500" : "text-gray-500"
                        }
                      >
                        Base item:{" "}
                      </span>
                      {g.base_item_names || (
                        <span
                          className={
                            isDark
                              ? "text-slate-500 italic"
                              : "text-gray-400 italic"
                          }
                        >
                          —
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 wrap-break-word">
                      <span
                        className={
                          isDark ? "text-slate-500" : "text-gray-500"
                        }
                      >
                        Product:{" "}
                      </span>
                      {g.product_name ?? "—"}
                    </div>
                    <div className="min-w-0 wrap-break-word">
                      <span
                        className={
                          isDark ? "text-slate-500" : "text-gray-500"
                        }
                      >
                        Brand:{" "}
                      </span>
                      {g.brand_name ?? "—"}
                    </div>
                    <div className="min-w-0 wrap-break-word">
                      <span
                        className={
                          isDark ? "text-slate-500" : "text-gray-500"
                        }
                      >
                        Size:{" "}
                      </span>
                      {g.purchase_quantity != null ? g.purchase_quantity : "—"}
                      {g.purchase_unit
                        ? `\u00A0${g.purchase_unit}`
                        : ""}
                    </div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-full table-fixed border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Price</th>
                      <th className={thCls}>Source</th>
                      <th className={thCls}>Invoice</th>
                      <th className={thCls}>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.events.map((ev) => (
                      <tr key={ev.price_event_id}>
                        <td className={tdCls}>{`$${ev.price.toFixed(2)}`}</td>
                        <td className={tdCls}>{ev.source_type}</td>
                        <td className={`${tdCls} font-mono text-xs`}>
                          {ev.invoice_id ?? "—"}
                        </td>
                        <td className={tdCls}>
                          {formatEventDate(ev.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
