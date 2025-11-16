/**
 * APIクライアント
 * バックエンドAPIとの通信を管理
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// 型定義
export interface RawItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
  each_grams?: number | null; // grams for 'each' unit
}

export interface Vendor {
  id: string;
  name: string;
}

export interface Item {
  id: string;
  name: string;
  item_kind: "raw" | "prepped";
  is_menu_item: boolean;
  raw_item_id?: string | null; // FK to raw_items
  vendor_id?: string | null; // FK to vendors
  purchase_unit?: string | null;
  purchase_quantity?: number | null;
  purchase_cost?: number | null;
  yield_amount?: number | null;
  yield_unit?: string | null;
  notes?: string | null;
}

export interface RecipeLine {
  id: string;
  parent_item_id: string;
  line_type: "ingredient" | "labor";
  child_item_id?: string | null;
  quantity?: number | null;
  unit?: string | null;
  labor_role?: string | null;
  minutes?: number | null;
}

export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
}

export interface NonMassUnit {
  id: string;
  name: string;
}

// API呼び出しヘルパー
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.error || "API request failed");
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json();
}

// Items API
export const itemsAPI = {
  getAll: (params?: { item_kind?: string; is_menu_item?: boolean }) => {
    const queryParams = new URLSearchParams();
    if (params?.item_kind) queryParams.append("item_kind", params.item_kind);
    if (params?.is_menu_item !== undefined)
      queryParams.append("is_menu_item", String(params.is_menu_item));
    const query = queryParams.toString();
    return fetchAPI<Item[]>(`/items${query ? `?${query}` : ""}`);
  },
  getById: (id: string) => fetchAPI<Item>(`/items/${id}`),
  create: (item: Partial<Item>) =>
    fetchAPI<Item>("/items", {
      method: "POST",
      body: JSON.stringify(item),
    }),
  update: (id: string, item: Partial<Item>) =>
    fetchAPI<Item>(`/items/${id}`, {
      method: "PUT",
      body: JSON.stringify(item),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/items/${id}`, {
      method: "DELETE",
    }),
};

// Recipe Lines API
export const recipeLinesAPI = {
  getByItemId: (itemId: string) =>
    fetchAPI<RecipeLine[]>(`/items/${itemId}/recipe`),
  create: (line: Partial<RecipeLine>) =>
    fetchAPI<RecipeLine>("/recipe-lines", {
      method: "POST",
      body: JSON.stringify(line),
    }),
  update: (id: string, line: Partial<RecipeLine>) =>
    fetchAPI<RecipeLine>(`/recipe-lines/${id}`, {
      method: "PUT",
      body: JSON.stringify(line),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/recipe-lines/${id}`, {
      method: "DELETE",
    }),
};

// Cost API
export const costAPI = {
  getCost: (itemId: string, clearCache?: boolean) => {
    const query = clearCache ? "?clear_cache=true" : "";
    return fetchAPI<{ item_id: string; cost_per_gram: number }>(
      `/items/${itemId}/cost${query}`
    );
  },
};

// Raw Items API
export const rawItemsAPI = {
  getAll: () => fetchAPI<RawItem[]>("/raw-items"),
  getById: (id: string) => fetchAPI<RawItem>(`/raw-items/${id}`),
  create: (rawItem: Partial<RawItem>) =>
    fetchAPI<RawItem>("/raw-items", {
      method: "POST",
      body: JSON.stringify(rawItem),
    }),
  update: (id: string, rawItem: Partial<RawItem>) =>
    fetchAPI<RawItem>(`/raw-items/${id}`, {
      method: "PUT",
      body: JSON.stringify(rawItem),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/raw-items/${id}`, {
      method: "DELETE",
    }),
};

// Vendors API
export const vendorsAPI = {
  getAll: () => fetchAPI<Vendor[]>("/vendors"),
  getById: (id: string) => fetchAPI<Vendor>(`/vendors/${id}`),
  create: (vendor: Partial<Vendor>) =>
    fetchAPI<Vendor>("/vendors", {
      method: "POST",
      body: JSON.stringify(vendor),
    }),
  update: (id: string, vendor: Partial<Vendor>) =>
    fetchAPI<Vendor>(`/vendors/${id}`, {
      method: "PUT",
      body: JSON.stringify(vendor),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/vendors/${id}`, {
      method: "DELETE",
    }),
};

// Labor Roles API
export const laborRolesAPI = {
  getAll: () => fetchAPI<LaborRole[]>("/labor-roles"),
  getById: (id: string) => fetchAPI<LaborRole>(`/labor-roles/${id}`),
  create: (role: Partial<LaborRole>) =>
    fetchAPI<LaborRole>("/labor-roles", {
      method: "POST",
      body: JSON.stringify(role),
    }),
  update: (id: string, role: Partial<LaborRole>) =>
    fetchAPI<LaborRole>(`/labor-roles/${id}`, {
      method: "PUT",
      body: JSON.stringify(role),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/labor-roles/${id}`, {
      method: "DELETE",
    }),
};

// Non Mass Units API
export const nonMassUnitsAPI = {
  getAll: () => fetchAPI<NonMassUnit[]>("/non-mass-units"),
  create: (unit: Partial<NonMassUnit>) =>
    fetchAPI<NonMassUnit>("/non-mass-units", {
      method: "POST",
      body: JSON.stringify(unit),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/non-mass-units/${id}`, {
      method: "DELETE",
    }),
};
