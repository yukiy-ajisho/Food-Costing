"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  recipeCostReportAPI,
  type CostBreakdown,
  type ItemCandidate,
  type ListMemberRow,
} from "@/lib/recipeCostReport";
import {
  formatCostDisplay,
  listPriceInputDisplay,
  listPriceInputToStoredPerKg,
  lcogPercent,
} from "@/lib/recipeCostReportCalc";
import { subscribeWholesaleListLines } from "@/lib/recipeCostReportRealtime";
import { CreateListModal } from "./CreateListModal";

type PageMode = "wholesale" | "menu";

type ListSummary = { id: string; name: string };

type MenuListMeta = {
  mode: "company_owned" | "franchise";
  wholesale_list_id: string | null;
};

const PAGE_TITLES: Record<PageMode, string> = {
  wholesale: "Wholesale List",
  menu: "Menu Cost List",
};

type PendingMemberRow = {
  localId: string;
  item_id: string;
  price: string;
};

function newPendingLocalId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function memberRowFromCandidate(
  itemId: string,
  c: ItemCandidate,
): ListMemberRow {
  return {
    item_id: itemId,
    name: c.name,
    item_kind: "prepped",
    is_menu_item: c.is_menu_item,
    proceed_yield_amount: 0,
    proceed_yield_unit: c.proceed_yield_unit ?? "g",
    each_grams: c.each_grams ?? null,
    latest_wholesale_price: null,
    latest_retail_price: null,
  };
}

export function RecipeCostReportListPage({
  pageMode,
  showPageHeading = true,
}: {
  pageMode: PageMode;
  showPageHeading?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { selectedTenantId } = useTenant();
  const pageTitle = PAGE_TITLES[pageMode];

  const [lists, setLists] = useState<ListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [savedListName, setSavedListName] = useState("");
  const [menuMeta, setMenuMeta] = useState<MenuListMeta>({
    mode: "company_owned",
    wholesale_list_id: null,
  });
  const [savedMenuMeta, setSavedMenuMeta] = useState<MenuListMeta>({
    mode: "company_owned",
    wholesale_list_id: null,
  });
  const [members, setMembers] = useState<ListMemberRow[]>([]);
  const [costs, setCosts] = useState<Record<string, CostBreakdown>>({});
  const [draftWholesale, setDraftWholesale] = useState<Map<string, string>>(
    new Map(),
  );
  const [draftRetail, setDraftRetail] = useState<Map<string, string>>(new Map());
  const [candidatesTenantOnly, setCandidatesTenantOnly] = useState<
    ItemCandidate[]
  >([]);
  const [candidatesCompanyOwned, setCandidatesCompanyOwned] = useState<
    ItemCandidate[]
  >([]);
  const [wlOptions, setWlOptions] = useState<{ id: string; name: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingNewRows, setPendingNewRows] = useState<PendingMemberRow[]>([]);
  /** Removed in edit UI; persisted on Save, restored on Cancel via loadDetail. */
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [costUnit, setCostUnit] = useState<"g" | "kg">("kg");
  const [eachMode, setEachMode] = useState(false);

  const costDisplayOptions = useMemo(
    () => ({ costUnit, eachMode }),
    [costUnit, eachMode],
  );

  const card = isDark
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-gray-200";
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
  const btnSecondary = `inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;
  const btnEdit =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gray-600 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700";

  const loadLists = useCallback(async () => {
    if (!selectedTenantId) return;
    const res =
      pageMode === "wholesale"
        ? await recipeCostReportAPI.listWholesaleLists()
        : await recipeCostReportAPI.listMenuCostLists();
    const rows = res.lists.map((l) => ({ id: l.id, name: l.name }));
    setLists(rows);
    if (rows.length > 0 && !selectedListId) {
      setSelectedListId(rows[0].id);
    }
  }, [pageMode, selectedTenantId, selectedListId]);

  const loadCosts = useCallback(
    async (listId: string, itemIds: string[], meta?: MenuListMeta) => {
      if (itemIds.length === 0) {
        setCosts({});
        return;
      }
      if (pageMode === "wholesale") {
        const { costs: c } = await recipeCostReportAPI.wholesaleListCosts(
          listId,
          itemIds,
        );
        setCosts(c);
      } else {
        const { costs: c } = await recipeCostReportAPI.menuCostListCosts(
          listId,
          itemIds,
        );
        setCosts(c);
        void meta;
      }
    },
    [pageMode],
  );

  const costItemIds = useMemo(() => {
    const ids = new Set(members.map((m) => m.item_id));
    for (const p of pendingNewRows) {
      if (p.item_id) ids.add(p.item_id);
    }
    return [...ids];
  }, [members, pendingNewRows]);

  const loadDetail = useCallback(
    async (listId: string) => {
      setLoading(true);
      try {
        if (pageMode === "wholesale") {
          const { list, members: m } =
            await recipeCostReportAPI.getWholesaleList(listId);
          setListName(list.name);
          setSavedListName(list.name);
          setMembers(m);
        } else {
          const { list, members: m } =
            await recipeCostReportAPI.getMenuCostList(listId);
          const meta = {
            mode: list.mode,
            wholesale_list_id: list.wholesale_list_id,
          };
          setListName(list.name);
          setSavedListName(list.name);
          setMenuMeta(meta);
          setSavedMenuMeta(meta);
          setMembers(m);
        }
        setDraftWholesale(new Map());
        setDraftRetail(new Map());
      } finally {
        setLoading(false);
      }
    },
    [pageMode],
  );

  const pickerCandidates = useMemo(() => {
    if (pageMode === "wholesale") return candidatesTenantOnly;
    return menuMeta.mode === "franchise"
      ? candidatesTenantOnly
      : candidatesCompanyOwned;
  }, [pageMode, menuMeta.mode, candidatesTenantOnly, candidatesCompanyOwned]);

  useEffect(() => {
    if (!selectedTenantId) return;
    void loadLists();
    void recipeCostReportAPI
      .getItemCandidates({ includeCrossTenant: false })
      .then((r) => setCandidatesTenantOnly(r.items));
    if (pageMode === "menu") {
      void recipeCostReportAPI
        .getItemCandidates({ includeCrossTenant: true })
        .then((r) => setCandidatesCompanyOwned(r.items));
      void recipeCostReportAPI.wholesaleListOptions().then((r) => setWlOptions(r.lists));
    } else {
      setCandidatesCompanyOwned([]);
    }
  }, [selectedTenantId, pageMode, loadLists]);

  useEffect(() => {
    setIsEditMode(false);
    setPendingNewRows([]);
    setPendingRemovals(new Set());
    if (!selectedListId) {
      setMembers([]);
      setCosts({});
      return;
    }
    void loadDetail(selectedListId);
  }, [selectedListId, loadDetail]);

  useEffect(() => {
    if (!selectedListId || loading) return;
    void loadCosts(selectedListId, costItemIds, menuMeta);
  }, [
    selectedListId,
    loading,
    costItemIds,
    loadCosts,
    menuMeta.mode,
    menuMeta.wholesale_list_id,
  ]);

  useEffect(() => {
    if (pageMode !== "menu" || menuMeta.mode !== "franchise") return;
    if (!menuMeta.wholesale_list_id || !selectedListId) return;
    return subscribeWholesaleListLines(menuMeta.wholesale_list_id, () => {
      void loadCosts(selectedListId, costItemIds, menuMeta);
    });
  }, [
    pageMode,
    menuMeta.mode,
    menuMeta.wholesale_list_id,
    selectedListId,
    costItemIds,
    loadCosts,
  ]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.item_id)), [members]);

  const candidateById = useMemo(
    () => new Map(pickerCandidates.map((c) => [c.id, c])),
    [pickerCandidates],
  );

  const prevEachModeRef = useRef(eachMode);
  useEffect(() => {
    const prev = prevEachModeRef.current;
    if (prev === eachMode) return;
    prevEachModeRef.current = eachMode;

    setDraftWholesale(new Map());
    setDraftRetail(new Map());

    setPendingNewRows((rows) =>
      rows.map((p) => {
        if (!p.price.trim() || !p.item_id) return p;
        const c = candidateById.get(p.item_id);
        if (!c) return p;
        const row = memberRowFromCandidate(p.item_id, c);
        const n = parseFloat(p.price);
        if (!Number.isFinite(n)) return p;
        if (row.proceed_yield_unit !== "each" || !row.each_grams || row.each_grams <= 0) {
          return p;
        }
        if (prev && !eachMode) {
          return { ...p, price: String((n / row.each_grams) * 1000) };
        }
        if (!prev && eachMode) {
          return { ...p, price: String((n / 1000) * row.each_grams) };
        }
        return p;
      }),
    );
  }, [eachMode, candidateById]);

  const hasDraftPrices = useMemo(() => {
    const drafts = pageMode === "wholesale" ? draftWholesale : draftRetail;
    for (const [, v] of drafts) {
      const n = parseFloat(v);
      if (v !== "" && Number.isFinite(n) && n >= 0) return true;
    }
    return false;
  }, [pageMode, draftWholesale, draftRetail]);

  const hasMetaChanges = useMemo(() => {
    if (listName.trim() !== savedListName.trim()) return true;
    if (pageMode !== "menu") return false;
    return (
      menuMeta.mode !== savedMenuMeta.mode ||
      menuMeta.wholesale_list_id !== savedMenuMeta.wholesale_list_id
    );
  }, [listName, savedListName, pageMode, menuMeta, savedMenuMeta]);

  const hasPendingAdds = pendingNewRows.length > 0;
  const hasPendingRemovals = pendingRemovals.size > 0;

  const canSave =
    hasDraftPrices || hasMetaChanges || hasPendingAdds || hasPendingRemovals;

  const handleEditClick = () => {
    setPendingRemovals(new Set());
    setIsEditMode(true);
  };

  const handleEditCancel = () => {
    setListName(savedListName);
    setMenuMeta({ ...savedMenuMeta });
    setDraftWholesale(new Map());
    setDraftRetail(new Map());
    setPendingNewRows([]);
    setPendingRemovals(new Set());
    setIsEditMode(false);
    if (selectedListId) void loadDetail(selectedListId);
  };

  const markMemberRemoved = (itemId: string) => {
    setMembers((prev) => prev.filter((m) => m.item_id !== itemId));
    setPendingRemovals((prev) => new Set(prev).add(itemId));
    setDraftWholesale((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
    setDraftRetail((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
    setCosts((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const addableCandidatesForPendingRow = (
    localId: string,
    currentItemId: string,
  ) =>
    pickerCandidates.filter((c) => {
      if (memberIds.has(c.id)) return false;
      if (
        pendingNewRows.some(
          (p) => p.localId !== localId && p.item_id !== "" && p.item_id === c.id,
        )
      )
        return false;
      return true;
    });

  const handleAddPendingRow = () => {
    setPendingNewRows((prev) => [
      ...prev,
      { localId: newPendingLocalId(), item_id: "", price: "" },
    ]);
  };

  const removePendingRow = (localId: string) => {
    setPendingNewRows((prev) => prev.filter((p) => p.localId !== localId));
  };

  const updatePendingItemId = (localId: string, itemId: string) => {
    if (
      itemId &&
      (memberIds.has(itemId) ||
        pendingNewRows.some(
          (p) => p.localId !== localId && p.item_id === itemId,
        ))
    ) {
      alert("This item is already on the list or queued to add.");
      return;
    }
    setPendingNewRows((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, item_id: itemId } : p)),
    );
  };

  const updatePendingPrice = (localId: string, price: string) => {
    setPendingNewRows((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, price } : p)),
    );
  };

  const tableColSpan = 6;

  const trashButtonClass = (visible: boolean) =>
    `inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
      isDark
        ? "text-red-400 hover:bg-red-900/30"
        : "text-red-600 hover:bg-red-50"
    } ${visible ? "" : "invisible pointer-events-none"}`;

  const formatPricePerKg = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return `$${value.toFixed(2)}/kg`;
  };

  const handleCreate = async (payload: {
    name: string;
    item_ids: string[];
    mode?: "company_owned" | "franchise";
    wholesale_list_id?: string | null;
  }) => {
    if (pageMode === "wholesale") {
      const res = await recipeCostReportAPI.createWholesaleList({
        name: payload.name,
        item_ids: payload.item_ids,
      });
      setLists((prev) => [...prev, { id: res.list.id, name: res.list.name }]);
      setSelectedListId(res.list.id);
      setListName(res.list.name);
      setSavedListName(res.list.name);
      setMembers(res.members);
      setCosts({});
    } else {
      const res = (await recipeCostReportAPI.createMenuCostList({
        name: payload.name,
        mode: payload.mode ?? "company_owned",
        wholesale_list_id: payload.wholesale_list_id ?? null,
        item_ids: payload.item_ids,
      })) as {
        list: {
          id: string;
          name: string;
          mode: "company_owned" | "franchise";
          wholesale_list_id: string | null;
        };
        members: ListMemberRow[];
      };
      const meta = {
        mode: res.list.mode,
        wholesale_list_id: res.list.wholesale_list_id,
      };
      setLists((prev) => [...prev, { id: res.list.id, name: res.list.name }]);
      setSelectedListId(res.list.id);
      setListName(res.list.name);
      setSavedListName(res.list.name);
      setMenuMeta(meta);
      setSavedMenuMeta(meta);
      setMembers(res.members);
      await loadCosts(
        res.list.id,
        res.members.map((m) => m.item_id),
        meta,
      );
    }
    setShowCreate(false);
  };

  const handleSave = async () => {
    if (!selectedListId || !canSave) return;

    for (const row of pendingNewRows) {
      if (!row.item_id) {
        alert("Choose an item for each new row before saving.");
        return;
      }
      const c = candidateById.get(row.item_id);
      const pendingMember = c
        ? memberRowFromCandidate(row.item_id, c)
        : null;
      if (!pendingMember) continue;
      const stored = listPriceInputToStoredPerKg(
        row.price,
        pendingMember,
        eachMode,
      );
      if (stored == null) {
        const name = c?.name ?? "Item";
        alert(
          `Enter ${
            pageMode === "wholesale" ? "wholesale" : "retail"
          } price for "${name}" before saving.`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      for (const itemId of pendingRemovals) {
        if (pageMode === "wholesale") {
          await recipeCostReportAPI.removeWholesaleMember(
            selectedListId,
            itemId,
          );
        } else {
          await recipeCostReportAPI.removeMenuCostMember(selectedListId, itemId);
        }
      }
      setPendingRemovals(new Set());

      if (pageMode === "wholesale") {
        if (hasMetaChanges) {
          await recipeCostReportAPI.updateWholesaleList(selectedListId, {
            name: listName.trim(),
          });
          setSavedListName(listName.trim());
        }
        for (const row of pendingNewRows) {
          await recipeCostReportAPI.addWholesaleMember(
            selectedListId,
            row.item_id,
          );
          const c = candidateById.get(row.item_id)!;
          const n = listPriceInputToStoredPerKg(
            row.price,
            memberRowFromCandidate(row.item_id, c),
            eachMode,
          )!;
          await recipeCostReportAPI.saveWholesalePrice(
            selectedListId,
            row.item_id,
            n,
          );
        }
        for (const [itemId, raw] of draftWholesale) {
          const memberRow = members.find((m) => m.item_id === itemId);
          if (!memberRow) continue;
          const n = listPriceInputToStoredPerKg(raw, memberRow, eachMode);
          if (n == null) continue;
          await recipeCostReportAPI.saveWholesalePrice(selectedListId, itemId, n);
        }
      } else {
        if (hasMetaChanges) {
          await recipeCostReportAPI.updateMenuCostList(selectedListId, {
            name: listName.trim(),
            mode: menuMeta.mode,
            wholesale_list_id:
              menuMeta.mode === "franchise" ? menuMeta.wholesale_list_id : null,
          });
          setSavedListName(listName.trim());
          setSavedMenuMeta({ ...menuMeta });
        }
        for (const row of pendingNewRows) {
          await recipeCostReportAPI.addMenuCostMember(selectedListId, row.item_id);
          const c = candidateById.get(row.item_id)!;
          const n = listPriceInputToStoredPerKg(
            row.price,
            memberRowFromCandidate(row.item_id, c),
            eachMode,
          )!;
          await recipeCostReportAPI.saveRetailPrice(
            selectedListId,
            row.item_id,
            n,
          );
        }
        for (const [itemId, raw] of draftRetail) {
          const memberRow = members.find((m) => m.item_id === itemId);
          if (!memberRow) continue;
          const n = listPriceInputToStoredPerKg(raw, memberRow, eachMode);
          if (n == null) continue;
          await recipeCostReportAPI.saveRetailPrice(selectedListId, itemId, n);
        }
      }
      setPendingNewRows([]);
      await loadDetail(selectedListId);
      setLists((prev) =>
        prev.map((l) =>
          l.id === selectedListId ? { ...l, name: listName.trim() } : l,
        ),
      );
      setIsEditMode(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const thCls = `px-4 py-3 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700/80" : "text-gray-500 bg-gray-50"
  }`;
  const cardShell = `flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-sm ${card} ${border}`;

  const listPickerCard = (
    <div className={`${cardShell} h-full min-h-0 w-[240px] shrink-0`}>
      <div className={`shrink-0 border-b px-4 py-4 ${border}`}>
        <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>
          Lists
        </p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!selectedTenantId}
          className={`${btnPrimary} mt-3 w-full`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          Create list
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {lists.length === 0 ? (
          <li className={`px-3 py-8 text-center text-sm ${muted}`}>No lists yet</li>
        ) : (
          lists.map((l) => {
            const active = selectedListId === l.id;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setSelectedListId(l.id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    active
                      ? isDark
                        ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/50"
                        : "bg-blue-50 text-blue-800 ring-1 ring-blue-200"
                      : isDark
                        ? "text-slate-300 hover:bg-slate-700/80"
                        : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="line-clamp-2">{l.name}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  const detailBody = !selectedTenantId ? (
    <div className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}>
      Select a tenant to continue.
    </div>
  ) : !selectedListId ? (
    <div className={`flex flex-1 items-center justify-center p-12 text-center text-sm ${muted}`}>
      Create a list or select one from the lists panel.
    </div>
  ) : loading ? (
    <div className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}>
      Loading…
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`shrink-0 border-b p-4 ${border}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1">
              {isEditMode ? (
                <input
                  id="rcr-list-name"
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  aria-label="Name"
                  className={inputCls}
                />
              ) : (
                <p
                  className={`flex min-h-10 items-center text-lg font-semibold ${textMain}`}
                >
                  {listName}
                </p>
              )}
            </div>

            {pageMode === "menu" && (
              <div className="flex flex-wrap items-end gap-4">
                {isEditMode ? (
                  <>
                    <fieldset className="flex h-10 items-center gap-4">
                      <legend className="sr-only">Mode</legend>
                      <label
                        className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                      >
                        <input
                          type="radio"
                          name="mcl-mode"
                          checked={menuMeta.mode === "company_owned"}
                          onChange={() =>
                            setMenuMeta((m) => ({
                              ...m,
                              mode: "company_owned",
                              wholesale_list_id: null,
                            }))
                          }
                          className="h-4 w-4 border-gray-300 text-blue-600"
                        />
                        Company-owned
                      </label>
                      <label
                        className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                      >
                        <input
                          type="radio"
                          name="mcl-mode"
                          checked={menuMeta.mode === "franchise"}
                          onChange={() =>
                            setMenuMeta((m) => ({ ...m, mode: "franchise" }))
                          }
                          className="h-4 w-4 border-gray-300 text-blue-600"
                        />
                        Franchise
                      </label>
                    </fieldset>
                    {menuMeta.mode === "franchise" && (
                      <div className="min-w-[180px]">
                        <label
                          htmlFor="rcr-wl-select"
                          className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
                        >
                          Wholesale list
                        </label>
                        <select
                          id="rcr-wl-select"
                          value={menuMeta.wholesale_list_id ?? ""}
                          onChange={(e) =>
                            setMenuMeta((m) => ({
                              ...m,
                              wholesale_list_id: e.target.value || null,
                            }))
                          }
                          className={inputCls}
                        >
                          <option value="">Select…</option>
                          {wlOptions.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                ) : (
                  <p className={`flex min-h-10 items-center text-sm ${textMain}`}>
                    {menuMeta.mode === "company_owned"
                      ? "Company-owned"
                      : "Franchise"}
                    {menuMeta.mode === "franchise" && menuMeta.wholesale_list_id
                      ? ` · ${wlOptions.find((w) => w.id === menuMeta.wholesale_list_id)?.name ?? "Wholesale list"}`
                      : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex h-10 shrink-0 items-center gap-2">
            {isEditMode ? (
              <>
                <button
                  type="button"
                  disabled={!canSave || saving}
                  onClick={() => void handleSave()}
                  className={btnPrimary}
                >
                  <Save className="h-4 w-4 shrink-0" />
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleEditCancel}
                  className={btnSecondary}
                >
                  <X className="h-4 w-4 shrink-0" />
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={handleEditClick} className={btnEdit}>
                <Edit className="h-4 w-4 shrink-0" />
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!isEditMode && members.length === 0 ? (
                <div className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}>
                  No items on this list. Click Edit to add items.
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className={`sticky top-0 z-10 border-b ${border}`}>
                      <tr>
                        <th className={`${thCls} text-left`}>
                          <div className="flex items-center justify-between gap-2 pr-1">
                            <span>Item</span>
                            <button
                              type="button"
                              onClick={() => setEachMode((v) => !v)}
                              className={`shrink-0 rounded px-2 py-0.5 text-xs normal-case transition-colors ${
                                eachMode
                                  ? "bg-blue-500 font-semibold text-white"
                                  : isDark
                                    ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                              }`}
                            >
                              each
                            </button>
                          </div>
                        </th>
                        <th className={`${thCls} text-left w-24`}>Type</th>
                        <th className={`${thCls} min-w-36 w-40 text-left`}>
                          <div className="flex items-center gap-1">
                            <span className="min-w-[40px] shrink-0">Cost</span>
                            <div className="flex items-center gap-1">
                              <span
                                className={`text-xs normal-case ${
                                  costUnit === "g"
                                    ? `font-semibold ${textMain}`
                                    : muted
                                }`}
                              >
                                g
                              </span>
                              <label className="relative inline-flex cursor-pointer items-center">
                                <input
                                  type="checkbox"
                                  checked={costUnit === "kg"}
                                  onChange={(e) =>
                                    setCostUnit(e.target.checked ? "kg" : "g")
                                  }
                                  className="peer sr-only"
                                />
                                <div
                                  className={`h-4 w-8 rounded-full after:absolute after:left-[1px] after:top-[1px] after:h-3 after:w-3 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:after:translate-x-4 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-300 after:content-[''] ${
                                    isDark ? "bg-slate-600" : "bg-gray-300"
                                  }`}
                                />
                              </label>
                              <span
                                className={`text-xs normal-case ${
                                  costUnit === "kg"
                                    ? `font-semibold ${textMain}`
                                    : muted
                                }`}
                              >
                                kg
                              </span>
                            </div>
                          </div>
                        </th>
                        <th className={`${thCls} text-left w-40`}>
                          {pageMode === "wholesale"
                            ? "Wholesale ($/kg)"
                            : "Retail ($/kg)"}
                        </th>
                        <th className={`${thCls} text-left w-24`}>LCOG%</th>
                        <th
                          className={`${thCls} w-16`}
                          aria-label="Row actions"
                        />
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${isDark ? "divide-slate-700" : "divide-gray-200"}`}
                    >
                      {isEditMode && (
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
                      )}
                      {pendingNewRows.map((pending) => {
                        const c = pending.item_id
                          ? candidateById.get(pending.item_id)
                          : undefined;
                        const pendingRow =
                          pending.item_id && c
                            ? memberRowFromCandidate(pending.item_id, c)
                            : null;
                        const pendingBd = pending.item_id
                          ? costs[pending.item_id]
                          : undefined;
                        const pendingPriceStored =
                          pendingRow && pending.price !== ""
                            ? listPriceInputToStoredPerKg(
                                pending.price,
                                pendingRow,
                                eachMode,
                              )
                            : null;
                        const rowOptions = addableCandidatesForPendingRow(
                          pending.localId,
                          pending.item_id,
                        );
                        return (
                          <tr
                            key={pending.localId}
                            className={
                              isDark ? "bg-emerald-900/15" : "bg-emerald-50/80"
                            }
                            style={{ height: 52 }}
                          >
                            <td className="px-4 py-2">
                              <select
                                value={pending.item_id}
                                onChange={(e) =>
                                  updatePendingItemId(
                                    pending.localId,
                                    e.target.value,
                                  )
                                }
                                className={inputCls}
                                aria-label="Item to add"
                              >
                                <option value="">Choose an item…</option>
                                {pending.item_id &&
                                  c &&
                                  !rowOptions.some((o) => o.id === c.id) && (
                                    <option value={c.id}>
                                      {c.name} (
                                      {c.is_menu_item ? "menu" : "prepped"})
                                    </option>
                                  )}
                                {rowOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.name}
                                    {opt.is_cross_tenant ? " · shared" : ""} (
                                    {opt.is_menu_item ? "menu" : "prepped"})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className={`px-4 py-2 ${muted}`}>
                              {c ? (
                                <span
                                  className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                                    c.is_menu_item
                                      ? isDark
                                        ? "bg-violet-900/40 text-violet-200"
                                        : "bg-violet-100 text-violet-800"
                                      : isDark
                                        ? "bg-slate-700 text-slate-300"
                                        : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {c.is_menu_item ? "Menu" : "Prepped"}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={`px-4 py-2 text-left tabular-nums ${muted}`}>
                              {pendingRow
                                ? formatCostDisplay(
                                    pendingRow,
                                    pendingBd,
                                    costDisplayOptions,
                                  )
                                : "—"}
                            </td>
                            <td className="px-4 py-2 text-left tabular-nums">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="0.00"
                                disabled={!pending.item_id}
                                aria-label={`${
                                  pageMode === "wholesale" ? "Wholesale" : "Retail"
                                } price`}
                                className={`${inputCls} w-full max-w-34 text-left tabular-nums disabled:opacity-50`}
                                value={pending.price}
                                onChange={(e) =>
                                  updatePendingPrice(pending.localId, e.target.value)
                                }
                              />
                            </td>
                            <td
                              className={`px-4 py-2 text-left tabular-nums font-medium ${textMain}`}
                            >
                              {pendingRow
                                ? lcogPercent(pendingBd, pendingPriceStored)
                                : "—"}
                            </td>
                            <td className="w-16 whitespace-nowrap px-4 py-2">
                              <button
                                type="button"
                                title="Remove row"
                                onClick={() => removePendingRow(pending.localId)}
                                className={trashButtonClass(isEditMode)}
                                aria-hidden={!isEditMode}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {members.map((row) => {
                        const bd = costs[row.item_id];
                        const ws = draftWholesale.has(row.item_id)
                          ? draftWholesale.get(row.item_id)!
                          : listPriceInputDisplay(
                              row.latest_wholesale_price,
                              row,
                              eachMode,
                            );
                        const rt = draftRetail.has(row.item_id)
                          ? draftRetail.get(row.item_id)!
                          : listPriceInputDisplay(
                              row.latest_retail_price,
                              row,
                              eachMode,
                            );
                        const priceForLcog =
                          pageMode === "wholesale"
                            ? listPriceInputToStoredPerKg(ws, row, eachMode)
                            : listPriceInputToStoredPerKg(rt, row, eachMode);
                        const rowDrafted =
                          pageMode === "wholesale"
                            ? draftWholesale.has(row.item_id)
                            : draftRetail.has(row.item_id);
                        return (
                          <tr
                            key={row.item_id}
                            className={`transition-colors ${
                              rowDrafted
                                ? isDark
                                  ? "bg-amber-900/15"
                                  : "bg-amber-50/80"
                                : isDark
                                  ? "hover:bg-slate-700/50"
                                  : "hover:bg-gray-50"
                            }`}
                            style={{ height: 52 }}
                          >
                            <td className={`px-4 py-2 font-medium ${textMain}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>{row.name}</span>
                                {row.deprecation_reason === "indirect" && (
                                  <span
                                    className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                                      isDark
                                        ? "border-yellow-700 bg-yellow-900/40 text-yellow-200"
                                        : "border-yellow-300 bg-yellow-100 text-yellow-800"
                                    }`}
                                    title="Affected by a deprecated ingredient; cost cannot be calculated"
                                  >
                                    ⚠ Affected
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-4 py-2 ${muted}`}>
                              <span
                                className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                                  row.is_menu_item
                                    ? isDark
                                      ? "bg-violet-900/40 text-violet-200"
                                      : "bg-violet-100 text-violet-800"
                                    : isDark
                                      ? "bg-slate-700 text-slate-300"
                                      : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {row.is_menu_item ? "Menu" : "Prepped"}
                              </span>
                            </td>
                            <td className={`px-4 py-2 text-left tabular-nums ${muted}`}>
                              {formatCostDisplay(row, bd, costDisplayOptions)}
                            </td>
                            <td className="px-4 py-2 text-left tabular-nums">
                              {isEditMode ? (
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  aria-label={`${
                                    pageMode === "wholesale" ? "Wholesale" : "Retail"
                                  } for ${row.name}`}
                                  className={`${inputCls} w-full max-w-34 text-left tabular-nums`}
                                  value={pageMode === "wholesale" ? ws : rt}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (pageMode === "wholesale") {
                                      setDraftWholesale((prev) => {
                                        const n = new Map(prev);
                                        n.set(row.item_id, v);
                                        return n;
                                      });
                                    } else {
                                      setDraftRetail((prev) => {
                                        const n = new Map(prev);
                                        n.set(row.item_id, v);
                                        return n;
                                      });
                                    }
                                  }}
                                />
                              ) : (
                                <span className={textMain}>
                                  {pageMode === "wholesale"
                                    ? formatPricePerKg(row.latest_wholesale_price)
                                    : formatPricePerKg(row.latest_retail_price)}
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-4 py-2 text-left tabular-nums font-medium ${textMain}`}
                            >
                              {lcogPercent(bd, priceForLcog)}
                            </td>
                            <td className="w-16 whitespace-nowrap px-4 py-2">
                              <button
                                type="button"
                                title={
                                  isEditMode ? "Remove from list" : undefined
                                }
                                disabled={!isEditMode}
                                onClick={() => {
                                  if (!isEditMode) return;
                                  markMemberRemoved(row.item_id);
                                }}
                                className={trashButtonClass(isEditMode)}
                                aria-hidden={!isEditMode}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
      </div>
    </div>
  );

  const shellCls = showPageHeading
    ? `flex h-full min-h-0 flex-col overflow-hidden px-6 py-4 lg:px-8 [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`
    : "flex min-h-0 flex-1 flex-col overflow-hidden [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed";

  const innerCls = showPageHeading
    ? "mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col"
    : "flex h-full min-h-0 flex-1 flex-col";

  return (
    <div className={shellCls}>
      <div className={innerCls}>
        {showPageHeading && (
          <header className="shrink-0">
            <h1 className={`text-2xl font-semibold tracking-tight ${textMain}`}>
              {pageTitle}
            </h1>
          </header>
        )}

        <div
          className={`flex min-h-0 flex-1 items-stretch gap-4 ${showPageHeading ? "mt-4" : ""}`}
        >
          {listPickerCard}
          <div className={`${cardShell} h-full min-h-0 min-w-0 flex-1`}>
            {detailBody}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateListModal
          pageMode={pageMode}
          isDark={isDark}
          candidatesTenantOnly={candidatesTenantOnly}
          candidatesCompanyOwned={candidatesCompanyOwned}
          wlOptions={wlOptions}
          onClose={() => setShowCreate(false)}
          onCreate={(p) => void handleCreate(p)}
        />
      )}
    </div>
  );
}
