"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit,
  Plus,
  Printer,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";
import {
  recipeCostReportAPI,
  type CostBasis,
  type CostBreakdown,
  type ItemCandidate,
  type ListMemberRow,
} from "@/lib/recipeCostReport";
import {
  convertListPriceInputOnEachToggle,
  convertPriceDraftMapOnEachToggle,
  formatCostDisplay,
  formatListPriceDisplay,
  listPriceInputDisplay,
  listPriceInputToStoredPerKg,
  lcogPercent,
  lcogPercentValue,
} from "@/lib/recipeCostReportCalc";
import {
  defaultCostBasisForMenuMember,
  effectiveCostBasis,
  wholesaleCostBasisSelectable,
} from "@/lib/recipeCostReportCostBasis";
import { filterMembersByItemSearch } from "@/lib/recipeCostReportItemSearch";
import { pageModeToPrintReportType } from "@/lib/recipeCostReportPrint";
import {
  getEffectiveLcogThresholds,
  normalizeThresholdFromApi,
  readLcogThresholdColumnVisible,
  thresholdToDraftString,
  thresholdsEqual,
  validateLcogThresholdsForSave,
  writeLcogThresholdColumnVisible,
} from "@/lib/recipeCostReportLcogThreshold";
import { subscribeWholesaleListLines } from "@/lib/recipeCostReportRealtime";
import { CostBasisBadge } from "./CostBasisBadge";
import { CostBasisControlSlot } from "./CostBasisControlSlot";
import { CostBasisRadios } from "./CostBasisRadios";
import { CreateListModal } from "./CreateListModal";
import { DeleteListConfirmModal } from "./DeleteListConfirmModal";
import { HeaderHoverHint } from "./HeaderHoverHint";
import { ItemKindBadge } from "./ItemKindBadge";
import {
  LcogThresholdColumnToggle,
  LcogThresholdDataCell,
  LcogThresholdHeaderCell,
} from "./LcogThresholdColumn";
import { MenuListPickerSections } from "./MenuListPickerSections";
import { PricingListPickerRow } from "./PricingListPickerRow";
import { PrintModal } from "./PrintModal";

type PageMode = "wholesale" | "menu";

type ListSummary = {
  id: string;
  name: string;
  mode?: "company_owned" | "franchise";
};

type MenuListMeta = {
  mode: "company_owned" | "franchise";
  wholesale_list_id: string | null;
};

type PendingMemberRow = {
  localId: string;
  item_id: string;
  price: string;
  cost_basis?: CostBasis;
};

type ListSortKey = "item" | "lcog";

type ListSortState = {
  key: ListSortKey;
  ascending: boolean;
};

const DEFAULT_LIST_SORT: ListSortState = { key: "item", ascending: true };

const LCOG_HEADER_TOOLTIP = "Labor and cost of goods";
const RETAIL_HEADER_TOOLTIP = "Price sold to the customer";
const LCOG_THRESHOLD_HEADER_TOOLTIP =
  "LCOG% caution and over thresholds. Yellow triangle at or above caution; red at or above over. Use Edit to change.";

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
    proceed_yield_amount: c.proceed_yield_amount ?? 0,
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
  const [draftRetail, setDraftRetail] = useState<Map<string, string>>(
    new Map(),
  );
  /** Edit-mode drafts for corporate/wholesale; persisted on Save (not on radio change). */
  const [draftCostBasis, setDraftCostBasis] = useState<Map<string, CostBasis>>(
    new Map(),
  );
  const [savedCostBasisByItem, setSavedCostBasisByItem] = useState<
    Map<string, CostBasis>
  >(new Map());
  const [candidatesTenantOnly, setCandidatesTenantOnly] = useState<
    ItemCandidate[]
  >([]);
  const [candidatesCompanyOwned, setCandidatesCompanyOwned] = useState<
    ItemCandidate[]
  >([]);
  const [wlOptions, setWlOptions] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [showCreate, setShowCreate] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    listId: string;
    listName: string;
    linkedRetailLists: { id: string; name: string }[];
  } | null>(null);
  const [deletingList, setDeletingList] = useState(false);
  const [pendingNewRows, setPendingNewRows] = useState<PendingMemberRow[]>([]);
  /** Removed in edit UI; persisted on Save, restored on Cancel via loadDetail. */
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [costsLoading, setCostsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkedWlByItem, setLinkedWlByItem] = useState<
    Map<string, number | null>
  >(new Map());
  const [wlRecipeImpactByItem, setWlRecipeImpactByItem] = useState<Set<string>>(
    new Set(),
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [costUnit, setCostUnit] = useState<"g" | "kg">("kg");
  const [eachMode, setEachMode] = useState(false);
  const [listSort, setListSort] = useState<ListSortState>(DEFAULT_LIST_SORT);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [savedCaution, setSavedCaution] = useState<number | null>(null);
  const [savedOver, setSavedOver] = useState<number | null>(null);
  const [draftCaution, setDraftCaution] = useState("");
  const [draftOver, setDraftOver] = useState("");
  const [thresholdColumnVisible, setThresholdColumnVisible] = useState(() =>
    readLcogThresholdColumnVisible(pageMode),
  );

  const menuPricingEach = pageMode === "menu";

  const costDisplayOptions = useMemo(
    () => ({ costUnit, eachMode, menuPricingEach }),
    [costUnit, eachMode, menuPricingEach],
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
    const rows: ListSummary[] =
      pageMode === "menu"
        ? (
            res.lists as {
              id: string;
              name: string;
              mode: "company_owned" | "franchise";
            }[]
          ).map((l) => ({
            id: l.id,
            name: l.name,
            mode: l.mode,
          }))
        : res.lists.map((l) => ({ id: l.id, name: l.name }));
    setLists(rows);
    if (rows.length > 0 && !selectedListId) {
      setSelectedListId(rows[0].id);
    }
  }, [pageMode, selectedTenantId, selectedListId]);

  const loadCosts = useCallback(
    async (
      listId: string,
      itemIds: string[],
      meta?: MenuListMeta,
      memberRows?: ListMemberRow[],
      pendingRows?: PendingMemberRow[],
    ) => {
      if (itemIds.length === 0) {
        setCosts({});
        return;
      }
      setCostsLoading(true);
      try {
        if (pageMode === "wholesale") {
          const { costs: c } = await recipeCostReportAPI.wholesaleListCosts(
            listId,
            itemIds,
          );
          setCosts(c);
        } else {
          const listMode = meta?.mode ?? "company_owned";
          const membersPayload = itemIds.map((item_id) => {
            const row = memberRows?.find((m) => m.item_id === item_id);
            if (row) {
              return {
                item_id,
                cost_basis: effectiveCostBasis(row, listMode),
              };
            }
            const pending = pendingRows?.find((p) => p.item_id === item_id);
            if (pending?.cost_basis) {
              return { item_id, cost_basis: pending.cost_basis };
            }
            const onWl = linkedWlByItem.has(item_id);
            const linkedPrice = linkedWlByItem.get(item_id) ?? null;
            const memberRow = memberRows?.find((m) => m.item_id === item_id);
            const selectable =
              memberRow?.wholesale_cost_basis_selectable ??
              wlRecipeImpactByItem.has(item_id);
            return {
              item_id,
              cost_basis: defaultCostBasisForMenuMember(
                listMode,
                selectable,
                onWl,
                linkedPrice,
              ),
            };
          });
          const { costs: c } = await recipeCostReportAPI.menuCostListCosts(
            listId,
            { item_ids: itemIds, members: membersPayload },
          );
          setCosts(c);
        }
      } finally {
        setCostsLoading(false);
      }
    },
    [pageMode, linkedWlByItem, wlRecipeImpactByItem],
  );

  const costItemIds = useMemo(() => {
    const ids = new Set(members.map((m) => m.item_id));
    for (const p of pendingNewRows) {
      if (p.item_id) ids.add(p.item_id);
    }
    return [...ids];
  }, [members, pendingNewRows]);

  /** Pending row price edits must not retrigger cost API (e.g. each display toggle). */
  const pendingCostBasisKey = useMemo(
    () =>
      pendingNewRows
        .filter((p) => p.item_id)
        .map((p) => `${p.item_id}:${p.cost_basis ?? "corporate"}`)
        .sort()
        .join("|"),
    [pendingNewRows],
  );

  const applyListThresholds = useCallback((caution: unknown, over: unknown) => {
    const c = normalizeThresholdFromApi(caution);
    const o = normalizeThresholdFromApi(over);
    setSavedCaution(c);
    setSavedOver(o);
    setDraftCaution(thresholdToDraftString(c));
    setDraftOver(thresholdToDraftString(o));
  }, []);

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
          applyListThresholds(list.caution, list.over);
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
          applyListThresholds(list.caution, list.over);
          const basisMap = new Map<string, CostBasis>();
          for (const row of m) {
            basisMap.set(
              row.item_id,
              row.cost_basis === "wholesale" ? "wholesale" : "corporate",
            );
          }
          setSavedCostBasisByItem(basisMap);
        }
        setDraftWholesale(new Map());
        setDraftRetail(new Map());
        setDraftCostBasis(new Map());
      } finally {
        setLoading(false);
      }
    },
    [pageMode, applyListThresholds],
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
      void recipeCostReportAPI
        .wholesaleListOptions()
        .then((r) => setWlOptions(r.lists));
    } else {
      setCandidatesCompanyOwned([]);
    }
  }, [selectedTenantId, pageMode, loadLists]);

  useEffect(() => {
    setIsEditMode(false);
    setPendingNewRows([]);
    setPendingRemovals(new Set());
    setListSort(DEFAULT_LIST_SORT);
    setItemSearchQuery("");
    if (!selectedListId) {
      setMembers([]);
      setCosts({});
      setSavedCaution(null);
      setSavedOver(null);
      setDraftCaution("");
      setDraftOver("");
      return;
    }
    void loadDetail(selectedListId);
  }, [selectedListId, loadDetail]);

  const menuCostBasisKey = useMemo(
    () =>
      members
        .map((m) => `${m.item_id}:${effectiveCostBasis(m, menuMeta.mode)}`)
        .join("|"),
    [members, menuMeta.mode],
  );

  useEffect(() => {
    if (pageMode !== "menu" || menuMeta.mode !== "franchise") {
      setLinkedWlByItem(new Map());
      setWlRecipeImpactByItem(new Set());
      return;
    }
    if (!menuMeta.wholesale_list_id) {
      setLinkedWlByItem(new Map());
      setWlRecipeImpactByItem(new Set());
      return;
    }
    const wlId = menuMeta.wholesale_list_id;
    const impactIds = candidatesTenantOnly.map((c) => c.id);
    let cancelled = false;
    void Promise.all([
      recipeCostReportAPI.getWholesaleList(wlId),
      recipeCostReportAPI.getWholesaleRecipeImpact(wlId, impactIds),
    ]).then(([{ members: wlMembers }, { item_ids: impactedIds }]) => {
      if (cancelled) return;
      const map = new Map<string, number | null>();
      for (const m of wlMembers) {
        map.set(m.item_id, m.latest_wholesale_price);
      }
      setLinkedWlByItem(map);
      setWlRecipeImpactByItem(new Set(impactedIds));
    });
    return () => {
      cancelled = true;
    };
  }, [
    pageMode,
    menuMeta.mode,
    menuMeta.wholesale_list_id,
    candidatesTenantOnly,
  ]);

  useEffect(() => {
    if (!selectedListId || loading) return;
    void loadCosts(
      selectedListId,
      costItemIds,
      menuMeta,
      members,
      pendingNewRows,
    );
  }, [
    selectedListId,
    loading,
    costItemIds,
    loadCosts,
    menuMeta.mode,
    menuMeta.wholesale_list_id,
    menuCostBasisKey,
    pendingCostBasisKey,
  ]);

  useEffect(() => {
    if (pageMode !== "menu" || menuMeta.mode !== "franchise") return;
    if (!menuMeta.wholesale_list_id || !selectedListId) return;
    return subscribeWholesaleListLines(menuMeta.wholesale_list_id, () => {
      void loadCosts(
        selectedListId,
        costItemIds,
        menuMetaRef.current,
        membersRef.current,
        pendingNewRowsRef.current,
      );
    });
  }, [
    pageMode,
    menuMeta.mode,
    menuMeta.wholesale_list_id,
    selectedListId,
    costItemIds,
    loadCosts,
    menuCostBasisKey,
    pendingCostBasisKey,
  ]);

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.item_id)),
    [members],
  );

  const handleListSortHeaderClick = useCallback((column: ListSortKey) => {
    setListSort((prev) =>
      prev.key !== column
        ? { key: column, ascending: true }
        : { key: column, ascending: !prev.ascending },
    );
  }, []);

  const filteredMembers = useMemo(
    () => filterMembersByItemSearch(members, itemSearchQuery),
    [members, itemSearchQuery],
  );

  const sortedMembers = useMemo(() => {
    const { key, ascending } = listSort;
    const dir = ascending ? 1 : -1;

    const pricePerKgForLcog = (row: ListMemberRow): number | null => {
      if (pageMode === "wholesale") {
        const ws = draftWholesale.has(row.item_id)
          ? draftWholesale.get(row.item_id)!
          : listPriceInputDisplay(
              row.latest_wholesale_price,
              row,
              eachMode,
              menuPricingEach,
            );
        return listPriceInputToStoredPerKg(ws, row, eachMode, menuPricingEach);
      }
      const rt = draftRetail.has(row.item_id)
        ? draftRetail.get(row.item_id)!
        : listPriceInputDisplay(
            row.latest_retail_price,
            row,
            eachMode,
            menuPricingEach,
          );
      return listPriceInputToStoredPerKg(rt, row, eachMode, menuPricingEach);
    };

    return [...filteredMembers].sort((a, b) => {
      if (key === "item") {
        const cmp = a.name
          .trim()
          .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
        if (cmp !== 0) return dir * cmp;
        return a.item_id.localeCompare(b.item_id);
      }
      const aVal = lcogPercentValue(costs[a.item_id], pricePerKgForLcog(a));
      const bVal = lcogPercentValue(costs[b.item_id], pricePerKgForLcog(b));
      if (aVal === null && bVal === null) {
        return a.name
          .trim()
          .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
      }
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = aVal - bVal;
      if (cmp !== 0) return dir * cmp;
      return a.name
        .trim()
        .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
    });
  }, [
    filteredMembers,
    listSort,
    costs,
    pageMode,
    draftWholesale,
    draftRetail,
    eachMode,
    menuPricingEach,
  ]);

  const printSortedMembers = useMemo(() => {
    const { key, ascending } = listSort;
    const dir = ascending ? 1 : -1;

    const pricePerKgForLcog = (row: ListMemberRow): number | null => {
      const stored =
        pageMode === "wholesale"
          ? row.latest_wholesale_price
          : row.latest_retail_price;
      return stored != null && Number.isFinite(stored) ? stored : null;
    };

    return [...members].sort((a, b) => {
      if (key === "item") {
        const cmp = a.name
          .trim()
          .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
        if (cmp !== 0) return dir * cmp;
        return a.item_id.localeCompare(b.item_id);
      }
      const aVal = lcogPercentValue(costs[a.item_id], pricePerKgForLcog(a));
      const bVal = lcogPercentValue(costs[b.item_id], pricePerKgForLcog(b));
      if (aVal === null && bVal === null) {
        return a.name
          .trim()
          .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
      }
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = aVal - bVal;
      if (cmp !== 0) return dir * cmp;
      return a.name
        .trim()
        .localeCompare(b.name.trim(), undefined, { sensitivity: "base" });
    });
  }, [members, listSort, costs, pageMode]);

  const itemSearchActive = itemSearchQuery.trim().length > 0;
  const noItemSearchMatches =
    itemSearchActive && members.length > 0 && sortedMembers.length === 0;

  const candidateById = useMemo(
    () => new Map(pickerCandidates.map((c) => [c.id, c])),
    [pickerCandidates],
  );

  const membersRef = useRef(members);
  membersRef.current = members;
  const pendingNewRowsRef = useRef(pendingNewRows);
  pendingNewRowsRef.current = pendingNewRows;
  const menuMetaRef = useRef(menuMeta);
  menuMetaRef.current = menuMeta;

  const prevEachModeRef = useRef(eachMode);
  useEffect(() => {
    const prev = prevEachModeRef.current;
    if (prev === eachMode) return;
    prevEachModeRef.current = eachMode;

    const memberById = new Map(
      membersRef.current.map((m) => [m.item_id, m] as const),
    );

    setDraftWholesale((drafts) =>
      convertPriceDraftMapOnEachToggle(
        drafts,
        memberById,
        prev,
        eachMode,
        menuPricingEach,
      ),
    );
    setDraftRetail((drafts) =>
      convertPriceDraftMapOnEachToggle(
        drafts,
        memberById,
        prev,
        eachMode,
        menuPricingEach,
      ),
    );

    setPendingNewRows((rows) => {
      if (rows.length === 0) return rows;
      let changed = false;
      const next = rows.map((p) => {
        if (!p.price.trim() || !p.item_id) return p;
        const c = candidateById.get(p.item_id);
        if (!c) return p;
        const row = memberRowFromCandidate(p.item_id, c);
        const converted = convertListPriceInputOnEachToggle(
          p.price,
          row,
          prev,
          eachMode,
          menuPricingEach,
        );
        if (converted === p.price) return p;
        changed = true;
        return { ...p, price: converted };
      });
      return changed ? next : rows;
    });
  }, [eachMode, candidateById, menuPricingEach]);

  const hasDraftPrices = useMemo(() => {
    const drafts = pageMode === "wholesale" ? draftWholesale : draftRetail;
    for (const [, v] of drafts) {
      const n = parseFloat(v);
      if (v !== "" && Number.isFinite(n) && n >= 0) return true;
    }
    return false;
  }, [pageMode, draftWholesale, draftRetail]);

  const effectiveThresholds = useMemo(
    () => getEffectiveLcogThresholds(draftCaution, draftOver),
    [draftCaution, draftOver],
  );

  const rowThresholds = useMemo(
    () =>
      isEditMode
        ? effectiveThresholds
        : getEffectiveLcogThresholds(
            thresholdToDraftString(savedCaution),
            thresholdToDraftString(savedOver),
          ),
    [isEditMode, effectiveThresholds, savedCaution, savedOver],
  );

  const showThresholdColumn = thresholdColumnVisible;

  const tableColSpan = showThresholdColumn ? 7 : 6;

  const draftThresholdsEdited = useMemo(
    () =>
      draftCaution !== thresholdToDraftString(savedCaution) ||
      draftOver !== thresholdToDraftString(savedOver),
    [draftCaution, draftOver, savedCaution, savedOver],
  );

  const hasThresholdChanges = useMemo(() => {
    if (!thresholdColumnVisible || !draftThresholdsEdited) return false;
    const validation = validateLcogThresholdsForSave(draftCaution, draftOver);
    if (!validation.ok) return false;
    return (
      !thresholdsEqual(validation.caution, savedCaution) ||
      !thresholdsEqual(validation.over, savedOver)
    );
  }, [
    thresholdColumnVisible,
    draftThresholdsEdited,
    draftCaution,
    draftOver,
    savedCaution,
    savedOver,
  ]);

  const canSaveThresholds = useMemo(() => {
    if (!thresholdColumnVisible || !draftThresholdsEdited) return true;
    return validateLcogThresholdsForSave(draftCaution, draftOver).ok;
  }, [thresholdColumnVisible, draftThresholdsEdited, draftCaution, draftOver]);

  const hasMetaChanges = useMemo(() => {
    if (listName.trim() !== savedListName.trim()) return true;
    if (hasThresholdChanges) return true;
    if (pageMode !== "menu") return false;
    return (
      menuMeta.mode !== savedMenuMeta.mode ||
      menuMeta.wholesale_list_id !== savedMenuMeta.wholesale_list_id
    );
  }, [
    listName,
    savedListName,
    pageMode,
    menuMeta,
    savedMenuMeta,
    hasThresholdChanges,
  ]);

  const hasPendingAdds = pendingNewRows.length > 0;
  const hasPendingRemovals = pendingRemovals.size > 0;

  const hasCostBasisChanges = useMemo(() => {
    for (const [itemId, basis] of draftCostBasis) {
      if (savedCostBasisByItem.get(itemId) !== basis) return true;
    }
    return false;
  }, [draftCostBasis, savedCostBasisByItem]);

  const canSave =
    canSaveThresholds &&
    (hasDraftPrices ||
      hasMetaChanges ||
      hasPendingAdds ||
      hasPendingRemovals ||
      hasCostBasisChanges);

  const handleEditClick = () => {
    setPendingRemovals(new Set());
    setDraftCostBasis(new Map());
    setIsEditMode(true);
  };

  const handleEditCancel = () => {
    setListName(savedListName);
    setMenuMeta({ ...savedMenuMeta });
    setDraftCaution(thresholdToDraftString(savedCaution));
    setDraftOver(thresholdToDraftString(savedOver));
    setDraftWholesale(new Map());
    setDraftRetail(new Map());
    setDraftCostBasis(new Map());
    setPendingNewRows([]);
    setPendingRemovals(new Set());
    setIsEditMode(false);
    if (selectedListId) void loadDetail(selectedListId);
  };

  const handleThresholdColumnToggle = () => {
    const next = !thresholdColumnVisible;
    setThresholdColumnVisible(next);
    writeLcogThresholdColumnVisible(pageMode, next);
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
    setDraftCostBasis((prev) => {
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
          (p) =>
            p.localId !== localId && p.item_id !== "" && p.item_id === c.id,
        )
      )
        return false;
      return true;
    });

  const handleAddPendingRow = () => {
    setPendingNewRows((prev) => [
      { localId: newPendingLocalId(), item_id: "", price: "" },
      ...prev,
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
      prev.map((p) => {
        if (p.localId !== localId) return p;
        if (!itemId) return { ...p, item_id: itemId, cost_basis: undefined };
        if (pageMode !== "menu" || menuMeta.mode !== "franchise") {
          return { ...p, item_id: itemId, cost_basis: "corporate" as const };
        }
        const onWl = linkedWlByItem.has(itemId);
        const linkedPrice = linkedWlByItem.get(itemId) ?? null;
        const selectable = wlRecipeImpactByItem.has(itemId);
        return {
          ...p,
          item_id: itemId,
          cost_basis: defaultCostBasisForMenuMember(
            "franchise",
            selectable,
            onWl,
            linkedPrice,
          ),
        };
      }),
    );
  };

  const handleCostBasisChange = (itemId: string, basis: CostBasis) => {
    if (!selectedListId || pageMode !== "menu" || !isEditMode) return;
    setDraftCostBasis((prev) => {
      const next = new Map(prev);
      next.set(itemId, basis);
      return next;
    });
    setMembers((prev) =>
      prev.map((m) => (m.item_id === itemId ? { ...m, cost_basis: basis } : m)),
    );
  };

  const updatePendingCostBasis = (localId: string, basis: CostBasis) => {
    setPendingNewRows((prev) =>
      prev.map((p) =>
        p.localId === localId ? { ...p, cost_basis: basis } : p,
      ),
    );
    const row = pendingNewRows.find((p) => p.localId === localId);
    if (row?.item_id && selectedListId) {
      void loadCosts(
        selectedListId,
        costItemIds,
        menuMeta,
        members,
        pendingNewRows.map((p) =>
          p.localId === localId ? { ...p, cost_basis: basis } : p,
        ),
      );
    }
  };

  const showMenuCostBasis =
    pageMode === "menu" &&
    menuMeta.mode === "franchise" &&
    !!menuMeta.wholesale_list_id;

  const renderCostBasisControl = (
    itemId: string,
    row: ListMemberRow | null,
    pendingLocalId?: string,
    pendingBasis?: CostBasis,
  ) => {
    if (!showMenuCostBasis || !itemId) return null;
    const onWl = row?.on_linked_wholesale_list ?? linkedWlByItem.has(itemId);
    const linkedPrice =
      row?.linked_wholesale_price ?? linkedWlByItem.get(itemId) ?? null;
    const wholesaleSelectable = wholesaleCostBasisSelectable(
      row?.wholesale_cost_basis_selectable ?? wlRecipeImpactByItem.has(itemId),
    );
    const basis =
      pendingBasis ??
      (row ? effectiveCostBasis(row, menuMeta.mode) : "corporate");
    const name = `cost-basis-${pendingLocalId ?? itemId}`;

    return (
      <CostBasisRadios
        groupName={name}
        basis={basis}
        wholesaleSelectable={wholesaleSelectable}
        textMain={textMain}
        onCorporate={() => {
          if (pendingLocalId) {
            updatePendingCostBasis(pendingLocalId, "corporate");
          } else {
            void handleCostBasisChange(itemId, "corporate");
          }
        }}
        onWholesale={() => {
          if (pendingLocalId) {
            updatePendingCostBasis(pendingLocalId, "wholesale");
          } else {
            void handleCostBasisChange(itemId, "wholesale");
          }
        }}
      />
    );
  };

  const renderCostBasisBadge = (row: ListMemberRow) => {
    if (!showMenuCostBasis) return null;
    return (
      <CostBasisBadge
        basis={effectiveCostBasis(row, menuMeta.mode)}
        isDark={isDark}
      />
    );
  };

  const renderCostBasisSlot = (
    itemId: string,
    row: ListMemberRow | null,
    pendingLocalId?: string,
    pendingBasis?: CostBasis,
    loading = false,
  ) => {
    if (!showMenuCostBasis) return null;
    return (
      <CostBasisControlSlot loading={loading} isDark={isDark}>
        {itemId
          ? renderCostBasisControl(itemId, row, pendingLocalId, pendingBasis)
          : null}
      </CostBasisControlSlot>
    );
  };

  const updatePendingPrice = (localId: string, price: string) => {
    setPendingNewRows((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, price } : p)),
    );
  };

  const trashButtonClass = (visible: boolean) =>
    `inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
      isDark
        ? "text-red-400 hover:bg-red-900/30"
        : "text-red-600 hover:bg-red-50"
    } ${visible ? "" : "invisible pointer-events-none"}`;

  const handleCreate = async (payload: {
    name: string;
    item_ids: string[];
    mode?: "company_owned" | "franchise";
    wholesale_list_id?: string | null;
    member_cost_basis?: Record<string, CostBasis>;
    caution?: number | null;
    over?: number | null;
  }) => {
    if (pageMode === "wholesale") {
      const res = await recipeCostReportAPI.createWholesaleList({
        name: payload.name,
        item_ids: payload.item_ids,
        caution: payload.caution ?? null,
        over: payload.over ?? null,
      });
      setLists((prev) => [...prev, { id: res.list.id, name: res.list.name }]);
      setSelectedListId(res.list.id);
      setListName(res.list.name);
      setSavedListName(res.list.name);
      setMembers(res.members);
      applyListThresholds(res.list.caution, res.list.over);
      setCosts({});
    } else {
      const res = (await recipeCostReportAPI.createMenuCostList({
        name: payload.name,
        mode: payload.mode ?? "company_owned",
        wholesale_list_id: payload.wholesale_list_id ?? null,
        item_ids: payload.item_ids,
        member_cost_basis: payload.member_cost_basis,
        caution: payload.caution ?? null,
        over: payload.over ?? null,
      })) as {
        list: {
          id: string;
          name: string;
          mode: "company_owned" | "franchise";
          wholesale_list_id: string | null;
          caution: number | null;
          over: number | null;
        };
        members: ListMemberRow[];
      };
      const meta = {
        mode: res.list.mode,
        wholesale_list_id: res.list.wholesale_list_id,
      };
      setLists((prev) => [
        ...prev,
        { id: res.list.id, name: res.list.name, mode: res.list.mode },
      ]);
      setSelectedListId(res.list.id);
      setListName(res.list.name);
      setSavedListName(res.list.name);
      setMenuMeta(meta);
      setSavedMenuMeta(meta);
      setMembers(res.members);
      applyListThresholds(res.list.caution, res.list.over);
      await loadCosts(
        res.list.id,
        res.members.map((m) => m.item_id),
        meta,
        res.members,
      );
    }
    setShowCreate(false);
  };

  const handleSave = async () => {
    if (!selectedListId || !canSave) return;

    if (thresholdColumnVisible && hasThresholdChanges) {
      const thresholdValidation = validateLcogThresholdsForSave(
        draftCaution,
        draftOver,
      );
      if (!thresholdValidation.ok) {
        alert(thresholdValidation.message);
        return;
      }
    }

    for (const row of pendingNewRows) {
      if (!row.item_id) {
        alert("Choose an item for each new row before saving.");
        return;
      }
      const c = candidateById.get(row.item_id);
      const pendingMember = c ? memberRowFromCandidate(row.item_id, c) : null;
      if (!pendingMember) continue;
      const stored = listPriceInputToStoredPerKg(
        row.price,
        pendingMember,
        eachMode,
        menuPricingEach,
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
          await recipeCostReportAPI.removeMenuCostMember(
            selectedListId,
            itemId,
          );
        }
      }
      setPendingRemovals(new Set());

      if (pageMode === "wholesale") {
        const wholesalePatch: Partial<{
          name: string;
          caution: number | null;
          over: number | null;
        }> = {};
        if (listName.trim() !== savedListName.trim()) {
          wholesalePatch.name = listName.trim();
        }
        if (thresholdColumnVisible && hasThresholdChanges) {
          const thresholdValidation = validateLcogThresholdsForSave(
            draftCaution,
            draftOver,
          );
          if (thresholdValidation.ok) {
            wholesalePatch.caution = thresholdValidation.caution;
            wholesalePatch.over = thresholdValidation.over;
          }
        }
        if (Object.keys(wholesalePatch).length > 0) {
          const { list: updatedList } =
            (await recipeCostReportAPI.updateWholesaleList(
              selectedListId,
              wholesalePatch,
            )) as {
              list: {
                name: string;
                caution: number | null;
                over: number | null;
              };
            };
          if (wholesalePatch.name != null) {
            setSavedListName(updatedList.name);
          }
          if (
            wholesalePatch.caution !== undefined ||
            wholesalePatch.over !== undefined
          ) {
            const c = normalizeThresholdFromApi(updatedList.caution);
            const o = normalizeThresholdFromApi(updatedList.over);
            setSavedCaution(c);
            setSavedOver(o);
            setDraftCaution(thresholdToDraftString(c));
            setDraftOver(thresholdToDraftString(o));
          }
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
            menuPricingEach,
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
          const n = listPriceInputToStoredPerKg(
            raw,
            memberRow,
            eachMode,
            menuPricingEach,
          );
          if (n == null) continue;
          await recipeCostReportAPI.saveWholesalePrice(
            selectedListId,
            itemId,
            n,
          );
        }
      } else {
        const menuPatch: Partial<{
          name: string;
          mode: "company_owned" | "franchise";
          wholesale_list_id: string | null;
          caution: number | null;
          over: number | null;
        }> = {};
        if (listName.trim() !== savedListName.trim()) {
          menuPatch.name = listName.trim();
        }
        if (
          menuMeta.mode !== savedMenuMeta.mode ||
          menuMeta.wholesale_list_id !== savedMenuMeta.wholesale_list_id
        ) {
          menuPatch.mode = menuMeta.mode;
          menuPatch.wholesale_list_id =
            menuMeta.mode === "franchise" ? menuMeta.wholesale_list_id : null;
        }
        if (thresholdColumnVisible && hasThresholdChanges) {
          const thresholdValidation = validateLcogThresholdsForSave(
            draftCaution,
            draftOver,
          );
          if (thresholdValidation.ok) {
            menuPatch.caution = thresholdValidation.caution;
            menuPatch.over = thresholdValidation.over;
          }
        }
        if (Object.keys(menuPatch).length > 0) {
          const { list: updatedList } =
            (await recipeCostReportAPI.updateMenuCostList(
              selectedListId,
              menuPatch,
            )) as {
              list: {
                name: string;
                mode: "company_owned" | "franchise";
                wholesale_list_id: string | null;
                caution: number | null;
                over: number | null;
              };
            };
          if (menuPatch.name != null) {
            setSavedListName(updatedList.name);
          }
          if (menuPatch.mode != null) {
            setSavedMenuMeta({
              mode: updatedList.mode,
              wholesale_list_id: updatedList.wholesale_list_id,
            });
            setMenuMeta({
              mode: updatedList.mode,
              wholesale_list_id: updatedList.wholesale_list_id,
            });
          }
          if (menuPatch.caution !== undefined || menuPatch.over !== undefined) {
            const c = normalizeThresholdFromApi(updatedList.caution);
            const o = normalizeThresholdFromApi(updatedList.over);
            setSavedCaution(c);
            setSavedOver(o);
            setDraftCaution(thresholdToDraftString(c));
            setDraftOver(thresholdToDraftString(o));
          }
        }
        for (const row of pendingNewRows) {
          await recipeCostReportAPI.addMenuCostMember(
            selectedListId,
            row.item_id,
          );
          if (row.cost_basis === "wholesale" && menuMeta.mode === "franchise") {
            await recipeCostReportAPI.updateMenuMemberCostBasis(
              selectedListId,
              row.item_id,
              "wholesale",
            );
          }
          const c = candidateById.get(row.item_id)!;
          const n = listPriceInputToStoredPerKg(
            row.price,
            memberRowFromCandidate(row.item_id, c),
            eachMode,
            menuPricingEach,
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
          const n = listPriceInputToStoredPerKg(
            raw,
            memberRow,
            eachMode,
            menuPricingEach,
          );
          if (n == null) continue;
          await recipeCostReportAPI.saveRetailPrice(selectedListId, itemId, n);
        }
        for (const [itemId, basis] of draftCostBasis) {
          if (savedCostBasisByItem.get(itemId) === basis) continue;
          await recipeCostReportAPI.updateMenuMemberCostBasis(
            selectedListId,
            itemId,
            basis,
          );
        }
        setDraftCostBasis(new Map());
      }
      setPendingNewRows([]);
      await loadDetail(selectedListId);
      setLists((prev) =>
        prev.map((l) => {
          if (l.id !== selectedListId) return l;
          if (pageMode === "menu") {
            return {
              ...l,
              name: listName.trim(),
              mode: menuMeta.mode,
            };
          }
          return { ...l, name: listName.trim() };
        }),
      );
      setIsEditMode(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const thCls = `h-14 align-middle px-4 py-3 text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300 bg-slate-700" : "text-gray-500 bg-gray-50"
  }`;
  const tbodyRowDividerCls = `[&>tr:not(:last-child)>td]:border-b ${
    isDark
      ? "[&>tr:not(:last-child)>td]:border-slate-700"
      : "[&>tr:not(:last-child)>td]:border-gray-200"
  }`;

  const renderListSortHeader = (
    column: ListSortKey,
    label: string,
    hint?: string,
  ) => {
    const active = listSort.key === column;
    const asc = listSort.ascending;
    const iconMuted = isDark ? "text-slate-500" : "text-gray-400";
    const iconActive = isDark ? "text-slate-100" : "text-gray-800";
    const button = (
      <button
        type="button"
        onClick={() => handleListSortHeaderClick(column)}
        className={`flex items-center gap-1.5 normal-case tracking-wider ${
          isDark ? "hover:text-slate-100" : "hover:text-gray-800"
        }`}
      >
        <span>{label}</span>
        {active ? (
          asc ? (
            <ChevronUp
              className={`h-4 w-4 shrink-0 ${iconActive}`}
              aria-hidden
            />
          ) : (
            <ChevronDown
              className={`h-4 w-4 shrink-0 ${iconActive}`}
              aria-hidden
            />
          )
        ) : (
          <ChevronDown
            className={`h-4 w-4 shrink-0 ${iconMuted}`}
            aria-hidden
          />
        )}
      </button>
    );
    if (!hint) return button;
    return (
      <HeaderHoverHint hint={hint} isDark={isDark}>
        {button}
      </HeaderHoverHint>
    );
  };

  const cardShell = `flex min-h-0 flex-col overflow-hidden rounded-lg border shadow-sm ${card} ${border}`;

  const listSectionLabel =
    pageMode === "wholesale" ? "Wholesale price name" : "Retail price name";
  const createButtonLabel = "Create New List";

  const directLists = useMemo(
    () => lists.filter((l) => l.mode === "company_owned"),
    [lists],
  );
  const franchiseLists = useMemo(
    () => lists.filter((l) => l.mode === "franchise"),
    [lists],
  );

  const renderListPickerRows = (sectionLists: ListSummary[]) => {
    if (sectionLists.length === 0) {
      return (
        <li className={`px-3 py-6 text-center text-sm ${muted}`}>
          No lists yet
        </li>
      );
    }
    return sectionLists.map((l) => (
      <PricingListPickerRow
        key={l.id}
        name={l.name}
        active={selectedListId === l.id}
        isDark={isDark}
        menuOpen={openListMenuId === l.id}
        onSelect={() => {
          setOpenListMenuId(null);
          setSelectedListId(l.id);
        }}
        onToggleMenu={() =>
          setOpenListMenuId((prev) => (prev === l.id ? null : l.id))
        }
        onCloseMenu={() => setOpenListMenuId(null)}
        onDelete={() => void beginDeleteList(l)}
      />
    ));
  };

  const applyListSelectionAfterDelete = useCallback(
    (deletedId: string, remaining: ListSummary[]) => {
      if (selectedListId !== deletedId) return;
      if (remaining.length === 0) {
        setSelectedListId(null);
        setMembers([]);
        setCosts({});
        return;
      }
      setSelectedListId(remaining[0].id);
    },
    [selectedListId],
  );

  const beginDeleteList = useCallback(
    async (list: ListSummary) => {
      setOpenListMenuId(null);
      if (isEditMode) {
        const ok = window.confirm(
          "You have unsaved edits. Discard them and delete this list?",
        );
        if (!ok) return;
        setIsEditMode(false);
        setPendingNewRows([]);
        setPendingRemovals(new Set());
      }

      if (pageMode === "menu") {
        setDeleteConfirm({
          listId: list.id,
          listName: list.name,
          linkedRetailLists: [],
        });
        return;
      }

      try {
        const impact = await recipeCostReportAPI.getWholesaleListDeleteImpact(
          list.id,
        );
        setDeleteConfirm({
          listId: list.id,
          listName: impact.list.name,
          linkedRetailLists: impact.linked_retail_lists,
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : "Failed to load delete details");
      }
    },
    [pageMode, isEditMode],
  );

  const confirmDeleteList = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeletingList(true);
    try {
      if (pageMode === "wholesale") {
        await recipeCostReportAPI.deleteWholesaleList(deleteConfirm.listId, {
          delete_linked_retail_lists:
            deleteConfirm.linkedRetailLists.length > 0,
        });
      } else {
        await recipeCostReportAPI.deleteMenuCostList(deleteConfirm.listId);
      }

      const remaining = lists.filter((l) => l.id !== deleteConfirm.listId);
      setLists(remaining);
      applyListSelectionAfterDelete(deleteConfirm.listId, remaining);
      setDeleteConfirm(null);

      if (pageMode === "menu") {
        void recipeCostReportAPI.wholesaleListOptions().then((r) => {
          setWlOptions(r.lists);
        });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingList(false);
    }
  }, [deleteConfirm, pageMode, lists, applyListSelectionAfterDelete]);

  const listPickerCard = (
    <div
      className={`${cardShell} flex h-full min-h-0 w-[240px] shrink-0 flex-col`}
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>
          {listSectionLabel}
        </p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!selectedTenantId}
          className={`${btnPrimary} mt-3 w-full`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {createButtonLabel}
        </button>
      </div>
      <div className={`shrink-0 border-b ${border}`} />
      {pageMode === "menu" ? (
        <MenuListPickerSections
          directCount={directLists.length}
          franchiseCount={franchiseLists.length}
          mutedClass={muted}
          renderDirectRows={() => renderListPickerRows(directLists)}
          renderFranchiseRows={() => renderListPickerRows(franchiseLists)}
        />
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {lists.length === 0 ? (
            <li className={`px-3 py-8 text-center text-sm ${muted}`}>
              No lists yet
            </li>
          ) : (
            renderListPickerRows(lists)
          )}
        </ul>
      )}
    </div>
  );

  const detailBody = !selectedTenantId ? (
    <div
      className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}
    >
      Select a tenant to continue.
    </div>
  ) : !selectedListId ? (
    <div
      className={`flex flex-1 items-center justify-center p-12 text-center text-sm ${muted}`}
    >
      Create a list or select one from the lists panel.
    </div>
  ) : loading ? (
    <div
      className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}
    >
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
                        Direct
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
                          Wholesale price list
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
                  <p
                    className={`flex min-h-10 items-center text-sm ${textMain}`}
                  >
                    {menuMeta.mode === "company_owned" ? "Direct" : "Franchise"}
                    {menuMeta.mode === "franchise" && menuMeta.wholesale_list_id
                      ? ` · ${wlOptions.find((w) => w.id === menuMeta.wholesale_list_id)?.name ?? "Wholesale list"}`
                      : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-end gap-2">
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
              <>
                <LcogThresholdColumnToggle
                  isDark={isDark}
                  checked={showThresholdColumn}
                  onChange={handleThresholdColumnToggle}
                />
                <button
                  type="button"
                  disabled={!selectedListId || loading || members.length === 0}
                  onClick={() => setShowPrint(true)}
                  className={btnSecondary}
                >
                  <Printer className="h-4 w-4 shrink-0" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={handleEditClick}
                  className={btnEdit}
                >
                  <Edit className="h-4 w-4 shrink-0" />
                  Edit
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!isEditMode && members.length === 0 ? (
          <div
            className={`flex flex-1 items-center justify-center p-12 text-sm ${muted}`}
          >
            No items on this list. Click Edit to add items.
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className={`sticky top-0 z-10 border-b ${border}`}>
                <tr>
                  <th className={`${thCls} text-left min-w-48`}>
                    <div className="flex items-center justify-between gap-2 pr-1">
                      <div className="flex min-w-0 flex-1 items-center gap-6">
                        {renderListSortHeader("item", "Item")}
                        <input
                          type="search"
                          value={itemSearchQuery}
                          onChange={(e) => setItemSearchQuery(e.target.value)}
                          placeholder="Search items…"
                          aria-label="Search items"
                          className={`h-8 min-w-0 flex-1 max-w-44 rounded-md border px-2 text-xs font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-500/40 sm:max-w-52 ${
                            isDark
                              ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
                              : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                          }`}
                        />
                      </div>
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
                    {pageMode === "wholesale" ? (
                      "Wholesale"
                    ) : (
                      <HeaderHoverHint
                        hint={RETAIL_HEADER_TOOLTIP}
                        isDark={isDark}
                      >
                        <span>Retail</span>
                      </HeaderHoverHint>
                    )}
                  </th>
                  <th className={`${thCls} text-left w-24`}>
                    {renderListSortHeader("lcog", "LCOG%", LCOG_HEADER_TOOLTIP)}
                  </th>
                  {showThresholdColumn ? (
                    <th
                      className={`${thCls} w-[7.25rem] min-w-[7.25rem] px-2 text-center ${
                        isEditMode ? "py-1" : ""
                      }`}
                    >
                      <LcogThresholdHeaderCell
                        isEditMode={isEditMode}
                        isDark={isDark}
                        headerTooltip={
                          isEditMode ? undefined : LCOG_THRESHOLD_HEADER_TOOLTIP
                        }
                        cautionRaw={draftCaution}
                        overRaw={draftOver}
                        savedCaution={savedCaution}
                        savedOver={savedOver}
                        onCautionChange={setDraftCaution}
                        onOverChange={setDraftOver}
                        cautionInvalid={effectiveThresholds.cautionInvalid}
                        overInvalid={effectiveThresholds.overInvalid}
                      />
                    </th>
                  ) : null}
                  <th className={`${thCls} w-16`} aria-label="Row actions" />
                </tr>
              </thead>
              <tbody className={tbodyRowDividerCls}>
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
                          menuPricingEach,
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
                        <div className="flex min-w-0 items-center gap-2">
                          <select
                            value={pending.item_id}
                            onChange={(e) =>
                              updatePendingItemId(
                                pending.localId,
                                e.target.value,
                              )
                            }
                            className={`${inputCls} min-w-0 flex-1 ${
                              showMenuCostBasis && isEditMode
                                ? "max-w-[calc(100%-12rem)]"
                                : ""
                            }`}
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
                          {isEditMode &&
                            renderCostBasisSlot(
                              pending.item_id,
                              pendingRow,
                              pending.localId,
                              pending.cost_basis,
                            )}
                        </div>
                      </td>
                      <td className={`px-4 py-2 ${muted}`}>
                        {c ? (
                          <ItemKindBadge
                            isMenuItem={c.is_menu_item}
                            isDark={isDark}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-left tabular-nums ${muted}`}
                      >
                        {costsLoading &&
                        pending.item_id &&
                        pendingBd === undefined ? (
                          <span className={muted}>…</span>
                        ) : pendingRow ? (
                          formatCostDisplay(
                            pendingRow,
                            pendingBd,
                            costDisplayOptions,
                          )
                        ) : (
                          "—"
                        )}
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
                      {showThresholdColumn ? (
                        <LcogThresholdDataCell
                          lcogPercent={lcogPercentValue(
                            pendingBd,
                            pendingPriceStored,
                          )}
                          thresholds={rowThresholds}
                          mutedClass={muted}
                        />
                      ) : null}
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
                {noItemSearchMatches && (
                  <tr>
                    <td
                      colSpan={tableColSpan}
                      className={`px-4 py-6 text-center text-sm ${muted}`}
                    >
                      No items match your search.
                    </td>
                  </tr>
                )}
                {sortedMembers.map((row) => {
                  const bd = costs[row.item_id];
                  const ws = draftWholesale.has(row.item_id)
                    ? draftWholesale.get(row.item_id)!
                    : listPriceInputDisplay(
                        row.latest_wholesale_price,
                        row,
                        eachMode,
                        menuPricingEach,
                      );
                  const rt = draftRetail.has(row.item_id)
                    ? draftRetail.get(row.item_id)!
                    : listPriceInputDisplay(
                        row.latest_retail_price,
                        row,
                        eachMode,
                        menuPricingEach,
                      );
                  const priceForLcog =
                    pageMode === "wholesale"
                      ? listPriceInputToStoredPerKg(
                          ws,
                          row,
                          eachMode,
                          menuPricingEach,
                        )
                      : listPriceInputToStoredPerKg(
                          rt,
                          row,
                          eachMode,
                          menuPricingEach,
                        );
                  const rowDrafted =
                    pageMode === "wholesale"
                      ? draftWholesale.has(row.item_id)
                      : draftRetail.has(row.item_id) ||
                        (draftCostBasis.has(row.item_id) &&
                          draftCostBasis.get(row.item_id) !==
                            savedCostBasisByItem.get(row.item_id));
                  return (
                    <tr
                      key={row.item_id}
                      className={`transition-[background-color] ${
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
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span>{row.name}</span>
                          {!isEditMode && renderCostBasisBadge(row)}
                          {isEditMode && renderCostBasisSlot(row.item_id, row)}
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
                        <ItemKindBadge
                          isMenuItem={row.is_menu_item}
                          isDark={isDark}
                        />
                      </td>
                      <td
                        className={`px-4 py-2 text-left tabular-nums ${muted}`}
                      >
                        {costsLoading && bd === undefined ? (
                          <span className={muted}>…</span>
                        ) : (
                          formatCostDisplay(row, bd, costDisplayOptions)
                        )}
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
                              ? formatListPriceDisplay(
                                  row.latest_wholesale_price,
                                  row,
                                  eachMode,
                                  menuPricingEach,
                                )
                              : formatListPriceDisplay(
                                  row.latest_retail_price,
                                  row,
                                  eachMode,
                                  menuPricingEach,
                                )}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-left tabular-nums font-medium ${textMain}`}
                      >
                        {lcogPercent(bd, priceForLcog)}
                      </td>
                      {showThresholdColumn ? (
                        <LcogThresholdDataCell
                          lcogPercent={lcogPercentValue(bd, priceForLcog)}
                          thresholds={rowThresholds}
                          mutedClass={muted}
                        />
                      ) : null}
                      <td className="w-16 whitespace-nowrap px-4 py-2">
                        <button
                          type="button"
                          title={isEditMode ? "Remove from list" : undefined}
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
    ? "mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col"
    : "flex h-full min-h-0 flex-1 flex-col";

  return (
    <div className={shellCls}>
      <div className={innerCls}>
        {showPageHeading && (
          <header className="shrink-0">
            <h1 className={`text-2xl font-semibold tracking-tight ${textMain}`}>
              Pricing
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

      {deleteConfirm && (
        <DeleteListConfirmModal
          isDark={isDark}
          pageMode={pageMode}
          listName={deleteConfirm.listName}
          linkedRetailLists={deleteConfirm.linkedRetailLists}
          deleting={deletingList}
          onCancel={() => {
            if (!deletingList) setDeleteConfirm(null);
          }}
          onConfirm={() => void confirmDeleteList()}
        />
      )}

      {showPrint && selectedListId ? (
        <PrintModal
          isDark={isDark}
          reportType={pageModeToPrintReportType(pageMode)}
          listName={listName}
          members={printSortedMembers}
          costs={costs}
          costDisplayOptions={costDisplayOptions}
          onClose={() => setShowPrint(false)}
        />
      ) : null}
    </div>
  );
}
