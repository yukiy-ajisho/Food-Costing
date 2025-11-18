/**
 * APIクライアント
 * バックエンドAPIとの通信を管理
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// 型定義
export interface BaseItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
}

export interface Vendor {
  id: string;
  name: string;
}

export interface VendorProduct {
  id: string;
  base_item_id: string; // FK to base_items
  vendor_id: string; // FK to vendors
  product_name?: string | null; // NULL可能
  brand_name?: string | null;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_cost: number;
}

export interface Item {
  id: string;
  name: string;
  item_kind: "raw" | "prepped";
  is_menu_item: boolean;
  // Raw item fields
  base_item_id?: string | null; // FK to base_items
  // Prepped item fields
  proceed_yield_amount?: number | null;
  proceed_yield_unit?: string | null;
  // Common fields
  each_grams?: number | null; // grams for 'each' unit (used for both raw and prepped items)
  notes?: string | null;
}

export interface RecipeLine {
  id: string;
  parent_item_id: string;
  line_type: "ingredient" | "labor";
  child_item_id?: string | null;
  quantity?: number | null;
  unit?: string | null;
  specific_child?: string | null; // "lowest" or vendor_product.id (only for raw items)
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

// Base Items API
export const baseItemsAPI = {
  getAll: () => fetchAPI<BaseItem[]>("/base-items"),
  getById: (id: string) => fetchAPI<BaseItem>(`/base-items/${id}`),
  create: (baseItem: Partial<BaseItem>) =>
    fetchAPI<BaseItem>("/base-items", {
      method: "POST",
      body: JSON.stringify(baseItem),
    }),
  update: (id: string, baseItem: Partial<BaseItem>) =>
    fetchAPI<BaseItem>(`/base-items/${id}`, {
      method: "PUT",
      body: JSON.stringify(baseItem),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/base-items/${id}`, {
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

// Vendor Products API
export const vendorProductsAPI = {
  getAll: () => fetchAPI<VendorProduct[]>("/vendor-products"),
  getById: (id: string) => fetchAPI<VendorProduct>(`/vendor-products/${id}`),
  create: (vendorProduct: Partial<VendorProduct>) =>
    fetchAPI<VendorProduct>("/vendor-products", {
      method: "POST",
      body: JSON.stringify(vendorProduct),
    }),
  update: (id: string, vendorProduct: Partial<VendorProduct>) =>
    fetchAPI<VendorProduct>(`/vendor-products/${id}`, {
      method: "PUT",
      body: JSON.stringify(vendorProduct),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/vendor-products/${id}`, {
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
