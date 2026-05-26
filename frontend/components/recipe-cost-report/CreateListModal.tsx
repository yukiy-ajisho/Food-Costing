"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  recipeCostReportAPI,
  type CostBasis,
  type ItemCandidate,
  type ListMemberRow,
} from "@/lib/recipeCostReport";
import {
  defaultCostBasisForMenuMember,
  wholesaleCostBasisSelectable,
} from "@/lib/recipeCostReportCostBasis";
import { validateLcogThresholdsForCreate } from "@/lib/recipeCostReportLcogThreshold";
import { CostBasisRadios } from "./CostBasisRadios";
import { ItemKindBadge } from "./ItemKindBadge";

type Props = {
  pageMode: "wholesale" | "menu";
  isDark: boolean;
  candidatesTenantOnly: ItemCandidate[];
  candidatesCompanyOwned: ItemCandidate[];
  wlOptions: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    item_ids: string[];
    mode?: "company_owned" | "franchise";
    wholesale_list_id?: string | null;
    member_cost_basis?: Record<string, CostBasis>;
    caution?: number | null;
    over?: number | null;
  }) => void;
};

export function CreateListModal({
  pageMode,
  isDark,
  candidatesTenantOnly,
  candidatesCompanyOwned,
  wlOptions,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [cautionRaw, setCautionRaw] = useState("");
  const [overRaw, setOverRaw] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"company_owned" | "franchise">("company_owned");
  const [wlId, setWlId] = useState("");
  const [showMenu, setShowMenu] = useState(true);
  const [showPrepped, setShowPrepped] = useState(true);
  const [costBasisByItem, setCostBasisByItem] = useState<Map<string, CostBasis>>(
    new Map(),
  );
  const [wlMemberByItem, setWlMemberByItem] = useState<
    Map<string, Pick<ListMemberRow, "on_linked_wholesale_list" | "linked_wholesale_price">>
  >(new Map());
  const [wlRecipeImpact, setWlRecipeImpact] = useState<Set<string>>(new Set());
  const [wlMembersLoading, setWlMembersLoading] = useState(false);

  const impactCandidateIds = useMemo(
    () => candidatesTenantOnly.map((c) => c.id),
    [candidatesTenantOnly],
  );

  const activeCandidates =
    pageMode === "menu" && mode === "company_owned"
      ? candidatesCompanyOwned
      : candidatesTenantOnly;

  const showCostBasis =
    pageMode === "menu" && mode === "franchise" && wlId.length > 0;

  useEffect(() => {
    if (!showCostBasis) {
      setWlMemberByItem(new Map());
      setWlRecipeImpact(new Set());
      setWlMembersLoading(false);
      return;
    }
    let cancelled = false;
    setWlMembersLoading(true);
    void Promise.all([
      recipeCostReportAPI.getWholesaleList(wlId),
      recipeCostReportAPI.getWholesaleRecipeImpact(wlId, impactCandidateIds),
    ])
      .then(([{ members }, { item_ids: impactedIds }]) => {
        if (cancelled) return;
        const map = new Map<
          string,
          Pick<ListMemberRow, "on_linked_wholesale_list" | "linked_wholesale_price">
        >();
        for (const m of members) {
          map.set(m.item_id, {
            on_linked_wholesale_list: true,
            linked_wholesale_price: m.latest_wholesale_price,
          });
        }
        setWlMemberByItem(map);
        setWlRecipeImpact(new Set(impactedIds));
      })
      .finally(() => {
        if (!cancelled) setWlMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCostBasis, wlId, impactCandidateIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeCandidates.filter((c) => {
      if (c.is_menu_item && !showMenu) return false;
      if (!c.is_menu_item && !showPrepped) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q);
    });
  }, [activeCandidates, search, showMenu, showPrepped]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        setCostBasisByItem((basis) => {
          const next = new Map(basis);
          next.delete(id);
          return next;
        });
      } else {
        n.add(id);
        if (pageMode === "menu" && mode === "franchise" && wlId) {
          const wl = wlMemberByItem.get(id);
          const onWl = !!wl?.on_linked_wholesale_list;
          const price = wl?.linked_wholesale_price ?? null;
          const selectable = wlRecipeImpact.has(id);
          setCostBasisByItem((basis) => {
            const next = new Map(basis);
            next.set(
              id,
              defaultCostBasisForMenuMember("franchise", selectable, onWl, price),
            );
            return next;
          });
        }
      }
      return n;
    });
  };

  const setItemCostBasis = (itemId: string, basis: CostBasis) => {
    setCostBasisByItem((prev) => {
      const next = new Map(prev);
      next.set(itemId, basis);
      return next;
    });
  };

  const title =
    pageMode === "wholesale"
      ? "Create wholesale price list"
      : "Create retail price list";

  const canCreate =
    name.trim().length > 0 &&
    (pageMode !== "menu" || mode !== "franchise" || wlId.length > 0) &&
    (!showCostBasis || !wlMembersLoading);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const inputCls = `h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
  }`;
  const btnPrimary =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnSecondary = `inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;

  const thresholdFields = (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label
          htmlFor="create-caution"
          className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
        >
          Caution (%)
        </label>
        <input
          id="create-caution"
          type="text"
          inputMode="decimal"
          value={cautionRaw}
          onChange={(e) => setCautionRaw(e.target.value)}
          className={inputCls}
          placeholder="Optional"
        />
      </div>
      <div>
        <label
          htmlFor="create-over"
          className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
        >
          Over (%)
        </label>
        <input
          id="create-over"
          type="text"
          inputMode="decimal"
          value={overRaw}
          onChange={(e) => setOverRaw(e.target.value)}
          className={inputCls}
          placeholder="Optional"
        />
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-list-title"
    >
      <div
        className={`flex min-h-[90vh] max-h-[999vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl ${
          isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-6 py-4 ${border}`}
        >
          <h2 id="create-list-title" className={`text-lg font-semibold ${textMain}`}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              isDark ? "text-slate-400 hover:bg-slate-700" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label
              htmlFor="create-list-name"
              className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
            >
              Name
            </label>
            <input
              id="create-list-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="e.g. Cupertino"
            />
          </div>

          {pageMode === "wholesale" ? thresholdFields : null}

          {pageMode === "menu" && (
            <div className="space-y-3">
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">Mode</legend>
                <label
                  className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                >
                  <input
                    type="radio"
                    checked={mode === "company_owned"}
                    onChange={() => setMode("company_owned")}
                    className="h-4 w-4"
                  />
                  Direct
                </label>
                <label
                  className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                >
                  <input
                    type="radio"
                    checked={mode === "franchise"}
                    onChange={() => setMode("franchise")}
                    className="h-4 w-4"
                  />
                  Franchise
                </label>
              </fieldset>
              {mode === "franchise" && (
                <div>
                  <label
                    htmlFor="create-wl"
                    className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
                  >
                    Wholesale price list
                  </label>
                  <select
                    id="create-wl"
                    value={wlId}
                    onChange={(e) => setWlId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select wholesale price list…</option>
                    {wlOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className={`flex cursor-pointer items-center gap-2 text-sm ${textMain}`}>
              <input
                type="checkbox"
                checked={showMenu}
                onChange={(e) => setShowMenu(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Menu
            </label>
            <label className={`flex cursor-pointer items-center gap-2 text-sm ${textMain}`}>
              <input
                type="checkbox"
                checked={showPrepped}
                onChange={(e) => setShowPrepped(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Prepped
            </label>
          </div>

          <div>
            <label
              htmlFor="create-search"
              className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
            >
              Items ({selected.size} selected)
            </label>
            <input
              id="create-search"
              type="search"
              placeholder="Search prepped & menu items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls}
            />
          </div>

          <ul
            className={`max-h-64 overflow-y-auto rounded-lg border divide-y ${
              isDark ? "divide-slate-700 border-slate-700" : "divide-gray-200 border-gray-200"
            }`}
          >
            {filtered.length === 0 ? (
              <li className={`px-4 py-6 text-center text-sm ${muted}`}>No items match</li>
            ) : (
              filtered.map((c) => {
                const wl = wlMemberByItem.get(c.id);
                const onWl = !!wl?.on_linked_wholesale_list;
                const linkedPrice = wl?.linked_wholesale_price ?? null;
                const selectable = wlRecipeImpact.has(c.id);
                const wholesaleSelectable = wholesaleCostBasisSelectable(selectable);
                const basis =
                  costBasisByItem.get(c.id) ??
                  defaultCostBasisForMenuMember(
                    mode === "franchise" ? "franchise" : "company_owned",
                    selectable,
                    onWl,
                    linkedPrice,
                  );
                const isSelected = selected.has(c.id);

                return (
                  <li key={c.id}>
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                        isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                      }`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 shrink-0 rounded border-gray-300"
                        />
                        <span className={`min-w-0 font-medium ${textMain}`}>
                          {c.name}
                        </span>
                      </label>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {c.is_cross_tenant ? (
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              isDark
                                ? "bg-amber-900/40 text-amber-200"
                                : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            Shared
                          </span>
                        ) : null}
                        <ItemKindBadge isMenuItem={c.is_menu_item} isDark={isDark} />
                        {showCostBasis ? (
                          wlMembersLoading ? (
                            <Loader2
                              className={`h-4 w-4 shrink-0 animate-spin -translate-y-px ${
                                isDark ? "text-slate-400" : "text-gray-400"
                              }`}
                              aria-label="Loading cost basis"
                            />
                          ) : (
                            <CostBasisRadios
                              groupName={`create-basis-${c.id}`}
                              basis={basis}
                              wholesaleSelectable={wholesaleSelectable}
                              textMain={textMain}
                              onCorporate={() =>
                                setItemCostBasis(c.id, "corporate")
                              }
                              onWholesale={() =>
                                setItemCostBasis(c.id, "wholesale")
                              }
                            />
                          )
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          {pageMode === "menu" ? thresholdFields : null}
        </div>

        <div
          className={`flex shrink-0 justify-end gap-3 border-t px-6 py-4 ${border}`}
        >
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => {
              const item_ids = [...selected];
              const member_cost_basis: Record<string, CostBasis> = {};
              for (const id of item_ids) {
                if (showCostBasis) {
                  const wl = wlMemberByItem.get(id);
                  const selectable = wlRecipeImpact.has(id);
                  member_cost_basis[id] =
                    costBasisByItem.get(id) ??
                    defaultCostBasisForMenuMember(
                      "franchise",
                      selectable,
                      !!wl?.on_linked_wholesale_list,
                      wl?.linked_wholesale_price ?? null,
                    );
                } else {
                  member_cost_basis[id] = "corporate";
                }
              }
              const thresholdValidation = validateLcogThresholdsForCreate(
                cautionRaw,
                overRaw,
              );
              if (!thresholdValidation.ok) {
                alert(thresholdValidation.message);
                return;
              }
              onCreate({
                name: name.trim(),
                item_ids,
                mode: pageMode === "menu" ? mode : undefined,
                wholesale_list_id:
                  pageMode === "menu" && mode === "franchise" ? wlId || null : null,
                member_cost_basis:
                  pageMode === "menu" ? member_cost_basis : undefined,
                caution: thresholdValidation.caution,
                over: thresholdValidation.over,
              });
            }}
            className={btnPrimary}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
