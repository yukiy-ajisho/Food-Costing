"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import {
  type BaseItem,
  type CrossTenantItemShare,
  getItemDisplayName,
  itemsAPI,
  type Item,
  recipeLinesAPI,
  recipeSummariesAPI,
  type RecipeSummary,
  type RecipeSummaryTechnicalSheet,
  type ResourceShare,
} from "@/lib/api";

type PreppedItemLite = {
  id: string;
  name: string | null;
  item_kind: "prepped";
  is_menu_item: boolean;
  responsible_user_id?: string | null;
};

type UserRole = "admin" | "director" | "manager" | "staff" | "company" | null;

type RecipeSummaryPanelProps = {
  isDark: boolean;
  items: PreppedItemLite[];
  availableItems: Item[];
  baseItems: BaseItem[];
  selectedTenantId: string | null;
  crossTenantAvailableItems: Array<{
    item: {
      id: string;
      name: string | null;
      tenant_id: string;
      proceed_yield_unit?: string | null;
      each_grams?: number | null;
      deprecated?: string | null;
      item_kind?: string | null;
      is_menu_item?: boolean | null;
      base_item_id?: string | null;
    };
    ownerTenantName: string;
  }>;
  userRole: UserRole;
  currentUserId: string | null;
  itemShares: Map<string, ResourceShare | null>;
  crossTenantShares: Map<string, CrossTenantItemShare[]>;
};

type TreeNode = {
  itemId: string;
  name: string;
  itemKind: "prepped" | "raw";
  canToggle: boolean;
  disabledReason: string | null;
  isSelected: boolean;
  children: TreeNode[];
};

type ItemNodeInfo = {
  id: string;
  name: string | null;
  item_kind: "prepped" | "raw";
  description?: string | null;
  procedure?: string | null;
  base_item_id?: string | null;
  tenant_id?: string | null;
  responsible_user_id?: string | null;
};

function getShareType(
  share: ResourceShare | null | undefined,
): "hide" | "view-only" | "editable" {
  if (!share || !share.allowed_actions || share.allowed_actions.length === 0) {
    return "hide";
  }
  if (
    share.allowed_actions.length === 2 &&
    share.allowed_actions.includes("read") &&
    share.allowed_actions.includes("update")
  ) {
    return "editable";
  }
  return "view-only";
}

export function RecipeSummaryPanel({
  isDark,
  items,
  availableItems,
  baseItems,
  selectedTenantId,
  crossTenantAvailableItems,
  userRole,
  currentUserId,
  itemShares,
  crossTenantShares,
}: RecipeSummaryPanelProps) {
  const [summaries, setSummaries] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [summaryName, setSummaryName] = useState("");
  const [sourceType, setSourceType] = useState<"menu" | "prepped">("menu");
  const [sourceItemId, setSourceItemId] = useState("");
  const [selectedExpandIds, setSelectedExpandIds] = useState<Set<string>>(
    new Set(),
  );
  const [childrenByParent, setChildrenByParent] = useState<
    Map<string, string[]>
  >(new Map());
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(new Set());
  const [savePending, setSavePending] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(
    new Set(),
  );
  const [sourceDescription, setSourceDescription] = useState("");
  const [initialSourceDescription, setInitialSourceDescription] = useState("");
  const [procedureByItemId, setProcedureByItemId] = useState<
    Map<string, string>
  >(new Map());
  const [initialProcedureByItemId, setInitialProcedureByItemId] = useState<
    Map<string, string>
  >(new Map());
  const [touchedProcedureItemIds, setTouchedProcedureItemIds] = useState<
    Set<string>
  >(new Set());
  const [viewSummaryId, setViewSummaryId] = useState<string | null>(null);
  const [technicalSheet, setTechnicalSheet] =
    useState<RecipeSummaryTechnicalSheet | null>(null);
  const [technicalSheetLoading, setTechnicalSheetLoading] = useState(false);

  const itemMap = useMemo(() => {
    const m = new Map<string, ItemNodeInfo>();
    availableItems.forEach((i) =>
      m.set(i.id, {
        id: i.id,
        name: i.name,
        item_kind: i.item_kind,
        description: i.description ?? "",
        procedure: i.procedure ?? "",
        base_item_id: i.base_item_id ?? null,
        responsible_user_id: i.responsible_user_id ?? null,
      }),
    );
    crossTenantAvailableItems.forEach((row) => {
      if (!row.item) return;
      m.set(row.item.id, {
        id: row.item.id,
        name: row.item.name ?? "",
        item_kind: (row.item.item_kind as "raw" | "prepped") ?? "prepped",
        description: "",
        procedure: "",
        base_item_id: row.item.base_item_id ?? null,
        tenant_id: row.item.tenant_id,
        responsible_user_id: null,
      });
    });
    return m;
  }, [availableItems, crossTenantAvailableItems]);

  const crossTenantItemIds = useMemo(
    () => new Set(crossTenantAvailableItems.map((row) => row.item.id)),
    [crossTenantAvailableItems],
  );

  const sourceCandidates = useMemo(() => {
    const own = items.filter((i) =>
      sourceType === "menu" ? i.is_menu_item : !i.is_menu_item,
    );

    const cross = crossTenantAvailableItems
      .filter((row) => {
        const isMenu = !!row.item.is_menu_item;
        return sourceType === "menu" ? isMenu : !isMenu;
      })
      .map((row) => ({
        id: row.item.id,
        name: row.item.name,
        item_kind: "prepped" as const,
        is_menu_item: !!row.item.is_menu_item,
        responsible_user_id: null,
      }));

    const merged = new Map<string, PreppedItemLite>();
    [...own, ...cross].forEach((it) => merged.set(it.id, it));
    return Array.from(merged.values());
  }, [items, sourceType, crossTenantAvailableItems]);

  const getItemRoleAccess = useCallback(
    (itemId: string, responsibleUserId?: string | null) => {
      const isCrossTenant = (crossTenantShares.get(itemId) ?? []).length > 0;
      const fallbackCrossTenant =
        selectedTenantId &&
        itemMap.get(itemId)?.tenant_id &&
        itemMap.get(itemId)!.tenant_id !== selectedTenantId;
      const finalIsCrossTenant =
        isCrossTenant ||
        crossTenantItemIds.has(itemId) ||
        !!fallbackCrossTenant;
      if (finalIsCrossTenant) {
        const allowCompany = userRole === "company";
        return {
          allowed: allowCompany,
          reason: allowCompany
            ? null
            : "Cross-tenant item is restricted for your role",
        };
      }

      if (userRole !== "manager") {
        return { allowed: true, reason: null };
      }

      const shareType = getShareType(itemShares.get(itemId));
      if (shareType !== "hide") {
        return { allowed: true, reason: null };
      }
      const isResponsible =
        !!currentUserId && responsibleUserId === currentUserId;
      return {
        allowed: isResponsible,
        reason: isResponsible ? null : "Hidden by access control",
      };
    },
    [
      crossTenantShares,
      crossTenantItemIds,
      selectedTenantId,
      itemMap,
      userRole,
      itemShares,
      currentUserId,
    ],
  );

  const sourceOptions = useMemo(() => {
    return sourceCandidates.map((candidate) => {
      const access = getItemRoleAccess(
        candidate.id,
        candidate.responsible_user_id,
      );
      return {
        ...candidate,
        label: getItemDisplayName(candidate as Item, baseItems) || "(Unnamed)",
        disabled: !access.allowed,
      };
    });
  }, [
    sourceCandidates,
    baseItems,
    itemShares,
    crossTenantShares,
    userRole,
    currentUserId,
  ]);

  const loadSummaries = async () => {
    setLoading(true);
    try {
      const data = await recipeSummariesAPI.getAll();
      setSummaries(data);
    } catch (error) {
      console.error("Failed to load recipe summaries:", error);
      alert("Failed to load recipe summaries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummaries();
  }, []);

  useEffect(() => {
    if (!isModalOpen) return;
    setSourceItemId("");
    setSelectedExpandIds(new Set());
    setChildrenByParent(new Map());
    setSourceDescription("");
    setInitialSourceDescription("");
    setProcedureByItemId(new Map());
    setInitialProcedureByItemId(new Map());
    setTouchedProcedureItemIds(new Set());
  }, [sourceType, isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;
    if (!sourceItemId) {
      setSourceDescription("");
      setInitialSourceDescription("");
      return;
    }
    const source = itemMap.get(sourceItemId);
    const nextDescription = source?.description ?? "";
    setSourceDescription(nextDescription);
    setInitialSourceDescription(nextDescription);

    const procMap = new Map<string, string>();
    itemMap.forEach((item, id) => {
      if (item.item_kind === "prepped") {
        procMap.set(id, item.procedure ?? "");
      }
    });
    setProcedureByItemId(procMap);
    setInitialProcedureByItemId(new Map(procMap));
    setTouchedProcedureItemIds(new Set());
  }, [isModalOpen, sourceItemId, itemMap]);

  const loadChildren = useCallback(
    async (parentItemId: string) => {
      if (
        childrenByParent.has(parentItemId) ||
        loadingNodeIds.has(parentItemId)
      )
        return;
      setLoadingNodeIds((prev) => new Set(prev).add(parentItemId));
      try {
        const lines = await recipeLinesAPI.getByItemId(parentItemId);
        const childIds = lines
          .filter((l) => l.line_type === "ingredient" && l.child_item_id)
          .map((l) => l.child_item_id as string);
        setChildrenByParent((prev) => {
          const next = new Map(prev);
          next.set(parentItemId, childIds);
          return next;
        });
      } catch (error) {
        console.error("Failed to load recipe children:", error);
        setChildrenByParent((prev) => {
          const next = new Map(prev);
          next.set(parentItemId, []);
          return next;
        });
      } finally {
        setLoadingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(parentItemId);
          return next;
        });
      }
    },
    [childrenByParent, loadingNodeIds],
  );

  useEffect(() => {
    if (!sourceItemId) return;
    void loadChildren(sourceItemId);
  }, [sourceItemId]);

  const toggleExpandTarget = async (itemId: string) => {
    const next = new Set(selectedExpandIds);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
      await loadChildren(itemId);
    }
    setSelectedExpandIds(next);
  };

  const buildTree = (parentId: string): TreeNode[] => {
    const childIds = childrenByParent.get(parentId) ?? [];
    return childIds.map((childId) => {
      const item = itemMap.get(childId);
      const isPrepped = item?.item_kind === "prepped";
      const access = getItemRoleAccess(
        childId,
        item?.responsible_user_id ?? null,
      );
      const isSelected = selectedExpandIds.has(childId);
      const children = isSelected && isPrepped ? buildTree(childId) : [];

      return {
        itemId: childId,
        name: item
          ? getItemDisplayName(item, baseItems) || "(Unnamed)"
          : "(Unknown Item)",
        itemKind: isPrepped ? "prepped" : "raw",
        canToggle: isPrepped && access.allowed,
        disabledReason: isPrepped && !access.allowed ? access.reason : null,
        isSelected,
        children,
      };
    });
  };

  const rootChildren = sourceItemId ? buildTree(sourceItemId) : [];
  const sourceItem = sourceItemId ? itemMap.get(sourceItemId) : null;
  const sourceIsCrossTenant =
    !!sourceItem &&
    !!selectedTenantId &&
    !!sourceItem.tenant_id &&
    sourceItem.tenant_id !== selectedTenantId;
  const sourceCanEditText =
    !!sourceItem && sourceItem.item_kind === "prepped" && !sourceIsCrossTenant;

  const handleProcedureChange = (itemId: string, value: string) => {
    setProcedureByItemId((prev) => {
      const next = new Map(prev);
      next.set(itemId, value);
      return next;
    });
    setTouchedProcedureItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  };

  const handleCreate = async () => {
    const name = summaryName.trim();
    if (!name) {
      alert("Summary name is required");
      return;
    }
    if (!sourceItemId) {
      alert("Please select a source recipe");
      return;
    }

    setSavePending(true);
    try {
      if (sourceCanEditText) {
        const nextDescription = sourceDescription.trim();
        const prevDescription = initialSourceDescription.trim();
        if (nextDescription !== prevDescription) {
          await itemsAPI.update(sourceItemId, {
            description: nextDescription.length > 0 ? nextDescription : null,
          });
        }
      }

      if (sourceCanEditText && touchedProcedureItemIds.size > 0) {
        const procedureUpdatePromises: Promise<unknown>[] = [];
        touchedProcedureItemIds.forEach((itemId) => {
          const item = itemMap.get(itemId);
          if (!item || item.item_kind !== "prepped") return;
          const isCrossTenantItem =
            !!selectedTenantId &&
            !!item.tenant_id &&
            item.tenant_id !== selectedTenantId;
          if (isCrossTenantItem) return;

          const nextProcedure = (procedureByItemId.get(itemId) ?? "").trim();
          const prevProcedure = (
            initialProcedureByItemId.get(itemId) ?? ""
          ).trim();
          if (nextProcedure === prevProcedure) return;
          procedureUpdatePromises.push(
            itemsAPI.update(itemId, {
              procedure: nextProcedure.length > 0 ? nextProcedure : null,
            }),
          );
        });
        if (procedureUpdatePromises.length > 0) {
          await Promise.all(procedureUpdatePromises);
        }
      }

      await recipeSummariesAPI.create({
        summary_name: name,
        source_item_id: sourceItemId,
        expand_target_item_ids: Array.from(selectedExpandIds),
      });
      setIsModalOpen(false);
      setSummaryName("");
      setSourceItemId("");
      setSelectedExpandIds(new Set());
      setChildrenByParent(new Map());
      setSourceDescription("");
      setInitialSourceDescription("");
      setProcedureByItemId(new Map());
      setInitialProcedureByItemId(new Map());
      setTouchedProcedureItemIds(new Set());
      await loadSummaries();
    } catch (error) {
      console.error("Failed to create recipe summary:", error);
      alert("Failed to create recipe summary");
    } finally {
      setSavePending(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await recipeSummariesAPI.delete(id);
    } catch (error) {
      console.error("Failed to delete recipe summary:", error);
      throw error;
    }
  };

  const handleEditClick = () => {
    setIsEditMode(true);
    setPendingDeleteIds(new Set());
  };

  const handleEditCancel = () => {
    setPendingDeleteIds(new Set());
    setIsEditMode(false);
  };

  const togglePendingDelete = (id: string) => {
    setPendingDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEditSave = async () => {
    if (pendingDeleteIds.size === 0) {
      setIsEditMode(false);
      return;
    }
    if (!window.confirm(`Delete ${pendingDeleteIds.size} summary(s)?`)) return;

    setSavePending(true);
    try {
      await Promise.all(
        Array.from(pendingDeleteIds).map((id) => handleDelete(id)),
      );
      setPendingDeleteIds(new Set());
      setIsEditMode(false);
      await loadSummaries();
    } catch {
      alert("Failed to delete one or more summaries");
    } finally {
      setSavePending(false);
    }
  };

  const handleViewSummary = async (summaryId: string) => {
    setViewSummaryId(summaryId);
    setTechnicalSheet(null);
    setTechnicalSheetLoading(true);
    try {
      const data = await recipeSummariesAPI.getTechnicalSheet(summaryId);
      setTechnicalSheet(data);
    } catch (error) {
      console.error("Failed to load technical sheet:", error);
      alert("Failed to load technical sheet");
      setViewSummaryId(null);
    } finally {
      setTechnicalSheetLoading(false);
    }
  };

  const closeTechnicalSheet = () => {
    setViewSummaryId(null);
    setTechnicalSheet(null);
    setTechnicalSheetLoading(false);
  };

  const renderTree = (
    nodes: TreeNode[],
    depth = 0,
    parentHasNext: boolean[] = [],
  ): JSX.Element[] =>
    nodes.flatMap((node, index) => {
      const isLast = index === nodes.length - 1;
      const nextParentHasNext = [...parentHasNext, !isLast];
      const row = (
        <div key={`${node.itemId}-${depth}-${index}`} className="">
          <div className="flex min-h-7 items-start gap-2">
            <div className="flex self-stretch items-start gap-0.5 select-none">
              {parentHasNext.map((hasNext, i) => (
                <div
                  key={`${node.itemId}-guide-${depth}-${i}`}
                  className="relative w-5 self-stretch"
                >
                  {hasNext && (
                    <span
                      className={`absolute -bottom-px -top-px left-2 border-l ${
                        isDark ? "border-slate-400" : "border-gray-500"
                      }`}
                    />
                  )}
                </div>
              ))}
              {depth > 0 && (
                <div className="relative w-5 self-stretch">
                  <span
                    className={`absolute -top-px left-2 border-l ${
                      isDark ? "border-slate-400" : "border-gray-500"
                    } ${isLast ? "h-[calc(0.875rem+1px)]" : "-bottom-px"}`}
                  />
                  <span
                    className={`absolute left-2 top-3.5 w-3 border-t ${
                      isDark ? "border-slate-400" : "border-gray-500"
                    }`}
                  />
                </div>
              )}
            </div>
            {node.itemKind === "prepped" ? (
              <input
                type="checkbox"
                checked={node.isSelected}
                disabled={!node.canToggle || savePending}
                onChange={() => void toggleExpandTarget(node.itemId)}
                title={node.disabledReason ?? undefined}
                className="mt-1"
              />
            ) : (
              <span className="mt-1 inline-block w-4" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-h-7 items-center gap-2">
                <span
                  className={`text-sm ${isDark ? "text-slate-200" : "text-gray-800"}`}
                >
                  {node.name}
                </span>
                <span
                  className={`text-[10px] rounded px-1 ${
                    node.itemKind === "prepped"
                      ? isDark
                        ? "bg-blue-900 text-blue-200"
                        : "bg-blue-100 text-blue-700"
                      : isDark
                        ? "bg-slate-700 text-slate-300"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {node.itemKind === "prepped" ? "Prepped" : "Base"}
                </span>
              </div>
              {node.itemKind === "prepped" && node.isSelected && (
                <div className="relative pb-1 pl-6">
                  <span
                    className={`absolute bottom-1 left-2 top-0 border-l ${
                      isDark ? "border-slate-400" : "border-gray-500"
                    }`}
                  />
                  <textarea
                    value={procedureByItemId.get(node.itemId) ?? ""}
                    onChange={(e) =>
                      handleProcedureChange(node.itemId, e.target.value)
                    }
                    rows={2}
                    disabled={!sourceCanEditText || savePending}
                    className={`w-full rounded border px-2 py-1 text-xs ${
                      isDark
                        ? "bg-slate-900 border-slate-600 text-slate-100"
                        : "bg-white border-gray-300 text-gray-900"
                    } disabled:opacity-60`}
                    placeholder="Procedure for this prepped item"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      );
      const children = node.isSelected
        ? renderTree(node.children, depth + 1, nextParentHasNext)
        : [];
      return [row, ...children];
    });

  const thClass = `px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
    isDark ? "text-slate-300" : "text-gray-500"
  }`;
  const technicalStepKeys = technicalSheet?.steps.map((s) => s.step_key) ?? [];
  const formatSheetNumber = (value: number, digits = 2) =>
    value === 0 ? "" : value.toFixed(digits);

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Toolbar above the table card (same idea as Items page — not inside the table panel) */}
        <div className="flex flex-wrap items-center justify-between gap-2 min-h-[40px]">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50 bg-blue-600 text-white hover:bg-blue-700`}
          >
            <Plus className="w-5 h-5" />
            Create Summary
          </button>
          <div className="flex items-center gap-2">
            {isEditMode ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleEditSave()}
                  disabled={savePending}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:pointer-events-none disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  {savePending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  disabled={savePending}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    isDark
                      ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  <X className="w-5 h-5" />
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleEditClick}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Edit className="w-5 h-5" />
                Edit
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            Loading...
          </div>
        ) : (
          <div
            className={`rounded-lg shadow-sm border transition-colors overflow-hidden ${
              isDark
                ? "bg-slate-800 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ tableLayout: "fixed", width: "100%" }}
              >
                <thead
                  className={`border-b transition-colors ${
                    isDark
                      ? "bg-slate-700 border-slate-600"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <tr>
                    <th className={thClass} style={{ width: "28%" }}>
                      Summary name
                    </th>
                    <th className={thClass} style={{ width: "36%" }}>
                      Base recipe
                    </th>
                    <th className={thClass} style={{ width: "22%" }}>
                      Created at
                    </th>
                    <th className={thClass} style={{ width: "14%" }}>
                      Action
                    </th>
                    <th
                      className="px-1 py-3"
                      style={{ width: "2%" }}
                      aria-hidden
                    />
                  </tr>
                </thead>
                <tbody
                  className={`divide-y transition-colors ${
                    isDark ? "divide-slate-700" : "divide-gray-200"
                  }`}
                >
                  {summaries.map((s) => (
                    <tr
                      key={s.id}
                      className={`transition-colors ${
                        isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"
                      }`}
                    >
                      <td
                        className={`px-6 py-3 align-middle ${isDark ? "text-slate-100" : "text-gray-900"}`}
                      >
                        <div className="min-w-0 truncate font-medium">
                          {s.summary_name}
                        </div>
                      </td>
                      <td
                        className={`px-6 py-3 align-middle ${isDark ? "text-slate-200" : "text-gray-800"}`}
                      >
                        <div className="min-w-0 truncate">
                          {s.source_item_name ?? "—"}
                        </div>
                      </td>
                      <td
                        className={`px-6 py-3 align-middle whitespace-nowrap ${
                          isDark ? "text-slate-400" : "text-gray-600"
                        }`}
                      >
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-3 align-middle">
                        <button
                          type="button"
                          onClick={() => void handleViewSummary(s.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isDark
                              ? "bg-blue-900/50 text-blue-200 border border-blue-800 hover:bg-blue-900/70"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          View
                        </button>
                      </td>
                      <td className="px-1 py-3 align-middle">
                        <div className="flex justify-end items-center">
                          <button
                            type="button"
                            onClick={() => togglePendingDelete(s.id)}
                            disabled={!isEditMode || savePending}
                            className={`p-2 rounded-md transition-colors ${
                              pendingDeleteIds.has(s.id)
                                ? "bg-red-500 text-white hover:bg-red-600"
                                : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                            } ${!isEditMode ? "invisible pointer-events-none" : ""}`}
                            title={isEditMode ? "Mark for deletion" : undefined}
                            aria-hidden={!isEditMode}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {summaries.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className={`px-6 py-12 text-center text-sm ${
                          isDark ? "text-slate-400" : "text-gray-500"
                        }`}
                      >
                        No summaries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/40 p-4 sm:p-6">
          <div
            className={`flex h-[110vh] max-h-[110vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg shadow-xl border ${
              isDark
                ? "bg-slate-900 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold">Create Summary</h3>
              <button type="button" onClick={() => setIsModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              <div>
                <label className="block text-sm mb-1">Summary Name</label>
                <input
                  value={summaryName}
                  onChange={(e) => setSummaryName(e.target.value)}
                  className={`w-full rounded border px-3 py-2 ${
                    isDark
                      ? "bg-slate-800 border-slate-600"
                      : "bg-white border-gray-300"
                  }`}
                  placeholder="e.g. Tonkatsu Curry - Full"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Type</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={sourceType === "menu"}
                      onChange={() => setSourceType("menu")}
                    />
                    Menu
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={sourceType === "prepped"}
                      onChange={() => setSourceType("prepped")}
                    />
                    Prepped
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1">Select Recipe</label>
                <select
                  value={sourceItemId}
                  onChange={(e) => setSourceItemId(e.target.value)}
                  className={`w-full rounded border px-3 py-2 ${
                    isDark
                      ? "bg-slate-800 border-slate-600"
                      : "bg-white border-gray-300"
                  }`}
                >
                  <option value="">Select...</option>
                  {sourceOptions.map((opt) => (
                    <option key={opt.id} value={opt.id} disabled={opt.disabled}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">
                  Description (Top item)
                </label>
                <textarea
                  value={sourceDescription}
                  onChange={(e) => setSourceDescription(e.target.value)}
                  rows={3}
                  disabled={!sourceCanEditText || savePending}
                  className={`w-full rounded border px-3 py-2 ${
                    isDark
                      ? "bg-slate-800 border-slate-600"
                      : "bg-white border-gray-300"
                  } disabled:opacity-60`}
                  placeholder="Top item description"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">
                  Expansion Level (Prepped only)
                </label>
                <div
                  className={`min-h-[min(36rem,68vh)] rounded border p-4 ${
                    isDark
                      ? "border-slate-700 bg-slate-800"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  {sourceItemId ? (
                    <>
                      {loadingNodeIds.has(sourceItemId) ? (
                        <div className="text-sm text-gray-500">
                          Loading hierarchy...
                        </div>
                      ) : (
                        <div className="space-y-0">
                          <div className="py-1">
                            <div className="flex min-h-7 items-start gap-2">
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div className="flex min-h-7 items-center gap-2">
                                  <span
                                    className={`text-sm font-medium ${isDark ? "text-slate-100" : "text-gray-900"}`}
                                  >
                                    {sourceItem
                                      ? getItemDisplayName(
                                          sourceItem as Item,
                                          baseItems,
                                        ) || "(Unnamed)"
                                      : "(Unknown Item)"}
                                  </span>
                                  <span
                                    className={`text-[10px] rounded px-1 ${
                                      isDark
                                        ? "bg-red-900 text-red-200"
                                        : "bg-red-100 text-red-700"
                                    }`}
                                  >
                                    ROOT
                                  </span>
                                </div>
                                {sourceItem?.item_kind === "prepped" && (
                                  <div className="relative pb-1 pl-6">
                                    <span
                                      className={`absolute bottom-1 left-2 top-0 border-l ${
                                        isDark
                                          ? "border-slate-400"
                                          : "border-gray-500"
                                      }`}
                                    />
                                    <textarea
                                      value={
                                        procedureByItemId.get(sourceItemId) ??
                                        ""
                                      }
                                      onChange={(e) =>
                                        handleProcedureChange(
                                          sourceItemId,
                                          e.target.value,
                                        )
                                      }
                                      rows={2}
                                      disabled={
                                        !sourceCanEditText || savePending
                                      }
                                      className={`w-full rounded border px-2 py-1 text-xs ${
                                        isDark
                                          ? "bg-slate-900 border-slate-600 text-slate-100"
                                          : "bg-white border-gray-300 text-gray-900"
                                      } disabled:opacity-60`}
                                      placeholder="Procedure for top item"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {renderTree(rootChildren, 1)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">
                      Select a recipe first.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className={`px-3 py-2 rounded ${isDark ? "bg-slate-700" : "bg-gray-200"}`}
                disabled={savePending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={savePending}
              >
                {savePending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewSummaryId && (
        <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/50 p-4">
          <div
            className={`flex h-[110vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-xl border shadow-2xl ${
              isDark
                ? "border-slate-700 bg-slate-900 text-slate-100"
                : "border-gray-200 bg-white text-gray-900"
            }`}
          >
            <div
              className={`flex items-center justify-between border-b px-6 py-4 ${isDark ? "border-slate-700" : "border-gray-200"}`}
            >
              <h3 className="text-lg font-semibold">Technical Sheet</h3>
              <button
                type="button"
                onClick={closeTechnicalSheet}
                className={`rounded px-2 py-1 text-sm ${isDark ? "hover:bg-slate-800" : "hover:bg-gray-100"}`}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              {technicalSheetLoading || !technicalSheet ? (
                <div
                  className={`rounded border p-6 text-sm ${isDark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-gray-200 bg-gray-50 text-gray-600"}`}
                >
                  Loading technical sheet...
                </div>
              ) : (
                <>
                  <div
                    className={`rounded border p-4 text-sm ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div>
                      <span className="font-semibold">Product:</span>{" "}
                      {technicalSheet.product.name}
                    </div>
                    <div>
                      <span className="font-semibold">Summary:</span>{" "}
                      {technicalSheet.summary_name}
                    </div>
                  </div>

                  <div
                    className={`rounded border p-4 ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                  >
                    <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                      Description
                    </h4>
                    <p
                      className={`whitespace-pre-wrap text-sm ${isDark ? "text-slate-200" : "text-gray-700"}`}
                    >
                      {technicalSheet.product.description?.trim() || "—"}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                    <div
                      className={`rounded border p-4 xl:col-span-4 ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                    >
                      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                        Procedure
                      </h4>
                      <div className="space-y-3">
                        {technicalSheet.steps.length === 0 ? (
                          <div
                            className={`text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}
                          >
                            —
                          </div>
                        ) : (
                          technicalSheet.steps.map((step) => (
                            <div
                              key={step.step_key}
                              className={`rounded border p-3 ${isDark ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}
                            >
                              <div className="text-sm font-semibold">
                                {step.title}
                              </div>
                              <div
                                className={`mt-1 whitespace-pre-wrap text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}
                              >
                                {step.procedure?.trim() || "—"}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div
                      className={`rounded border p-4 xl:col-span-8 ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                    >
                      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide">
                        Ingredient Cost Table
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] border-collapse text-xs">
                          <thead>
                            <tr className={isDark ? "bg-slate-900" : "bg-white"}>
                              <th className="border px-2 py-1 text-left">
                                Nature
                              </th>
                              <th className="border px-2 py-1 text-left">Unit</th>
                              {technicalStepKeys.map((key) => (
                                <th
                                  key={key}
                                  className="border px-2 py-1 text-right"
                                >
                                  {key}
                                </th>
                              ))}
                              <th className="border px-2 py-1 text-right">
                                Total
                              </th>
                              <th className="border px-2 py-1 text-right">PU</th>
                              <th className="border px-2 py-1 text-right">PT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {technicalSheet.ingredient_rows.map((row) => (
                              <tr
                                key={row.item_id}
                                className={isDark ? "bg-slate-800" : "bg-gray-50"}
                              >
                                <td className="border px-2 py-1">{row.nature}</td>
                                <td className="border px-2 py-1">{row.unit}</td>
                                {technicalStepKeys.map((key) => (
                                  <td
                                    key={`${row.item_id}-${key}`}
                                    className="border px-2 py-1 text-right"
                                  >
                                    {formatSheetNumber(
                                      row.step_quantities[key] ?? 0,
                                    )}
                                  </td>
                                ))}
                                <td className="border px-2 py-1 text-right">
                                  {formatSheetNumber(row.total)}
                                </td>
                                <td className="border px-2 py-1 text-right">
                                  {formatSheetNumber(row.pu, 4)}
                                </td>
                                <td className="border px-2 py-1 text-right">
                                  {formatSheetNumber(row.pt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded border p-4 text-right text-sm font-semibold ${isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-gray-50"}`}
                  >
                    Total Ingredient Cost: $
                    {technicalSheet.total_ingredient_cost.toFixed(2)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
