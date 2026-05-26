import { apiRequest } from "./api";
import type { PrintColumnSelection, PrintPreset, PrintReportType } from "./recipeCostReportPrint";

export type CostBreakdown = {
  food_cost_per_gram: number;
  labor_cost_per_gram: number;
  total_cost_per_gram: number;
};

export type CostBasis = "corporate" | "wholesale";

export type ListMemberRow = {
  item_id: string;
  name: string;
  item_kind: string;
  is_menu_item: boolean;
  proceed_yield_amount: number;
  proceed_yield_unit: string;
  each_grams: number | null;
  latest_wholesale_price: number | null;
  latest_retail_price: number | null;
  cost_basis?: CostBasis;
  on_linked_wholesale_list?: boolean;
  linked_wholesale_price?: number | null;
  wholesale_cost_basis_selectable?: boolean;
  deprecation_reason?: "indirect" | null;
};

export type RecipeCostListThresholds = {
  caution: number | null;
  over: number | null;
};

export type ItemCandidate = {
  id: string;
  name: string;
  is_menu_item: boolean;
  proceed_yield_amount: number;
  proceed_yield_unit: string | null;
  each_grams: number | null;
  /** 他テナントから read 共有されている品目（直営 MCL のみ候補に含む） */
  is_cross_tenant?: boolean;
};

export const recipeCostReportAPI = {
  getItemCandidates: (options?: { includeCrossTenant?: boolean }) => {
    const q = options?.includeCrossTenant ? "?include_cross_tenant=true" : "";
    return apiRequest<{ items: ItemCandidate[] }>(
      `/recipe-cost-report/item-candidates${q}`,
    );
  },

  // Wholesale lists
  listWholesaleLists: () =>
    apiRequest<{
      lists: {
        id: string;
        name: string;
        caution: number | null;
        over: number | null;
        created_at: string;
      }[];
    }>("/recipe-cost-report/wholesale-lists"),
  getWholesaleList: (listId: string) =>
    apiRequest<{
      list: { id: string; name: string; caution: number | null; over: number | null };
      members: ListMemberRow[];
    }>(`/recipe-cost-report/wholesale-lists/${listId}`),
  createWholesaleList: (body: {
    name: string;
    item_ids: string[];
    caution?: number | null;
    over?: number | null;
  }) =>
    apiRequest<{
      list: { id: string; name: string; caution: number | null; over: number | null };
      members: ListMemberRow[];
    }>("/recipe-cost-report/wholesale-lists", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateWholesaleList: (
    listId: string,
    body: Partial<{ name: string; caution: number | null; over: number | null }>,
  ) =>
    apiRequest<{
      list: {
        id: string;
        name: string;
        caution: number | null;
        over: number | null;
        created_at: string;
      };
    }>(`/recipe-cost-report/wholesale-lists/${listId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getWholesaleRecipeImpact: (listId: string, item_ids: string[]) =>
    apiRequest<{ item_ids: string[] }>(
      `/recipe-cost-report/wholesale-lists/${listId}/wholesale-recipe-impact`,
      {
        method: "POST",
        body: JSON.stringify({ item_ids }),
      },
    ),
  getWholesaleListDeleteImpact: (listId: string) =>
    apiRequest<{
      list: { id: string; name: string };
      linked_retail_lists: { id: string; name: string }[];
    }>(`/recipe-cost-report/wholesale-lists/${listId}/delete-impact`),
  deleteWholesaleList: (
    listId: string,
    options?: { delete_linked_retail_lists?: boolean },
  ) =>
    apiRequest(`/recipe-cost-report/wholesale-lists/${listId}`, {
      method: "DELETE",
      body: options ? JSON.stringify(options) : undefined,
    }),
  addWholesaleMember: (listId: string, item_id: string) =>
    apiRequest(`/recipe-cost-report/wholesale-lists/${listId}/members`, {
      method: "POST",
      body: JSON.stringify({ item_id }),
    }),
  removeWholesaleMember: (listId: string, itemId: string) =>
    apiRequest(`/recipe-cost-report/wholesale-lists/${listId}/members/${itemId}`, {
      method: "DELETE",
    }),
  saveWholesalePrice: (listId: string, item_id: string, wholesale_price: number) =>
    apiRequest(`/recipe-cost-report/wholesale-lists/${listId}/wholesale-prices`, {
      method: "POST",
      body: JSON.stringify({ item_id, wholesale_price }),
    }),
  wholesaleListCosts: (listId: string, item_ids: string[]) =>
    apiRequest<{ costs: Record<string, CostBreakdown> }>(
      `/recipe-cost-report/wholesale-lists/${listId}/costs`,
      { method: "POST", body: JSON.stringify({ item_ids }) },
    ),

  // Menu cost lists
  listMenuCostLists: () =>
    apiRequest<{
      lists: {
        id: string;
        name: string;
        mode: "company_owned" | "franchise";
        wholesale_list_id: string | null;
        caution: number | null;
        over: number | null;
      }[];
    }>("/recipe-cost-report/menu-cost-lists"),
  wholesaleListOptions: () =>
    apiRequest<{ lists: { id: string; name: string }[] }>(
      "/recipe-cost-report/menu-cost-lists/wholesale-list-options",
    ),
  getMenuCostList: (listId: string) =>
    apiRequest<{
      list: {
        id: string;
        name: string;
        mode: "company_owned" | "franchise";
        wholesale_list_id: string | null;
        caution: number | null;
        over: number | null;
      };
      members: ListMemberRow[];
    }>(`/recipe-cost-report/menu-cost-lists/${listId}`),
  createMenuCostList: (body: {
    name: string;
    mode: "company_owned" | "franchise";
    wholesale_list_id?: string | null;
    item_ids: string[];
    member_cost_basis?: Record<string, CostBasis>;
    caution?: number | null;
    over?: number | null;
  }) =>
    apiRequest(`/recipe-cost-report/menu-cost-lists`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMenuCostList: (
    listId: string,
    body: Partial<{
      name: string;
      mode: "company_owned" | "franchise";
      wholesale_list_id: string | null;
      caution: number | null;
      over: number | null;
    }>,
  ) =>
    apiRequest<{
      list: {
        id: string;
        name: string;
        mode: "company_owned" | "franchise";
        wholesale_list_id: string | null;
        caution: number | null;
        over: number | null;
        created_at: string;
      };
    }>(`/recipe-cost-report/menu-cost-lists/${listId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMenuCostList: (listId: string) =>
    apiRequest(`/recipe-cost-report/menu-cost-lists/${listId}`, {
      method: "DELETE",
    }),
  addMenuCostMember: (listId: string, item_id: string) =>
    apiRequest(`/recipe-cost-report/menu-cost-lists/${listId}/members`, {
      method: "POST",
      body: JSON.stringify({ item_id }),
    }),
  removeMenuCostMember: (listId: string, itemId: string) =>
    apiRequest(`/recipe-cost-report/menu-cost-lists/${listId}/members/${itemId}`, {
      method: "DELETE",
    }),
  saveRetailPrice: (listId: string, item_id: string, retail_price: number) =>
    apiRequest(`/recipe-cost-report/menu-cost-lists/${listId}/retail-prices`, {
      method: "POST",
      body: JSON.stringify({ item_id, retail_price }),
    }),
  menuCostListCosts: (
    listId: string,
    body: {
      item_ids?: string[];
      members?: Array<{ item_id: string; cost_basis: CostBasis }>;
    } = {},
  ) =>
    apiRequest<{ costs: Record<string, CostBreakdown> }>(
      `/recipe-cost-report/menu-cost-lists/${listId}/costs`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateMenuMemberCostBasis: (
    listId: string,
    itemId: string,
    cost_basis: CostBasis,
  ) =>
    apiRequest<{ ok: true; cost_basis: CostBasis }>(
      `/recipe-cost-report/menu-cost-lists/${listId}/members/${itemId}/cost-basis`,
      { method: "PATCH", body: JSON.stringify({ cost_basis }) },
    ),

  listPrintPresets: (reportType: PrintReportType) =>
    apiRequest<{ presets: PrintPreset[] }>(
      `/recipe-cost-report/print-presets?report_type=${reportType}`,
    ),
  savePrintPreset: (
    slot: number,
    body: {
      report_type: PrintReportType;
      name: string;
      columns: PrintColumnSelection;
    },
  ) =>
    apiRequest<{ preset: PrintPreset }>(
      `/recipe-cost-report/print-presets/${slot}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
};
