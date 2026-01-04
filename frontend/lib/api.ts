/**
 * APIクライアント
 * バックエンドAPIとの通信を管理
 */

import { createClient } from "./supabase-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * 変更履歴をlocalStorageに保存（Costingページの差分更新用）
 */
export function saveChangeHistory(changes: {
  changed_item_ids?: string[];
  changed_vendor_product_ids?: string[];
  changed_base_item_ids?: string[];
  changed_labor_role_names?: string[];
}) {
  try {
    // 既存の変更履歴を取得
    const existingStr = localStorage.getItem("costing_change_history");
    let existing: typeof changes = {};
    if (existingStr) {
      try {
        existing = JSON.parse(existingStr);
      } catch (e) {
        console.error("Failed to parse existing change history:", e);
      }
    }

    // 変更をマージ（重複を除去）
    const merged: typeof changes = {
      changed_item_ids: [
        ...new Set([
          ...(existing.changed_item_ids || []),
          ...(changes.changed_item_ids || []),
        ]),
      ],
      changed_vendor_product_ids: [
        ...new Set([
          ...(existing.changed_vendor_product_ids || []),
          ...(changes.changed_vendor_product_ids || []),
        ]),
      ],
      changed_base_item_ids: [
        ...new Set([
          ...(existing.changed_base_item_ids || []),
          ...(changes.changed_base_item_ids || []),
        ]),
      ],
      changed_labor_role_names: [
        ...new Set([
          ...(existing.changed_labor_role_names || []),
          ...(changes.changed_labor_role_names || []),
        ]),
      ],
    };

    // 空の配列は削除
    if (merged.changed_item_ids?.length === 0) delete merged.changed_item_ids;
    if (merged.changed_vendor_product_ids?.length === 0)
      delete merged.changed_vendor_product_ids;
    if (merged.changed_base_item_ids?.length === 0)
      delete merged.changed_base_item_ids;
    if (merged.changed_labor_role_names?.length === 0)
      delete merged.changed_labor_role_names;

    // localStorageに保存
    try {
      localStorage.setItem("costing_change_history", JSON.stringify(merged));
    } catch (storageError: unknown) {
      // QuotaExceededError → 古い履歴の半分を削除して再試行
      if (
        (storageError as Error).name === "QuotaExceededError" ||
        (storageError as { code?: number }).code === 22
      ) {
        console.warn(
          "LocalStorage quota exceeded. Clearing old history and retrying..."
        );

        // 各配列の古い半分を削除
        const halfLength = (arr: string[] | undefined) =>
          arr ? Math.floor(arr.length / 2) : 0;

        const reduced: typeof changes = {
          changed_item_ids: merged.changed_item_ids?.slice(
            halfLength(merged.changed_item_ids)
          ),
          changed_vendor_product_ids: merged.changed_vendor_product_ids?.slice(
            halfLength(merged.changed_vendor_product_ids)
          ),
          changed_base_item_ids: merged.changed_base_item_ids?.slice(
            halfLength(merged.changed_base_item_ids)
          ),
          changed_labor_role_names: merged.changed_labor_role_names?.slice(
            halfLength(merged.changed_labor_role_names)
          ),
        };

        try {
          localStorage.setItem(
            "costing_change_history",
            JSON.stringify(reduced)
          );
          console.log("Successfully saved reduced change history.");
        } catch (retryError) {
          console.error(
            "Failed to save even after reducing history:",
            retryError
          );
        }
      } else {
        throw storageError;
      }
    }
  } catch (error) {
    console.error("Failed to save change history:", error);
  }
}

/**
 * 変更履歴を取得してクリア（Cost Pageで使用）
 */
export function getAndClearChangeHistory() {
  try {
    const historyStr = localStorage.getItem("costing_change_history");
    if (historyStr) {
      localStorage.removeItem("costing_change_history");
      return JSON.parse(historyStr);
    }
    return null;
  } catch (error) {
    console.error("Failed to get and clear change history:", error);
    return null;
  }
}

// 型定義
export interface BaseItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
  deprecated?: string | null; // timestamp when deprecated
  user_id: string; // FK to users
}

export interface Vendor {
  id: string;
  name: string;
  user_id: string; // FK to users
}

export interface VendorProduct {
  id: string;
  // base_item_id removed in Phase 1b - use product_mappings instead
  vendor_id: string; // FK to vendors
  product_name?: string | null; // NULL可能
  brand_name?: string | null;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_cost: number;
  deprecated?: string | null; // timestamp when deprecated
  user_id: string; // FK to users
}

export interface ProductMapping {
  id: string;
  base_item_id: string; // FK to base_items
  virtual_product_id: string; // FK to virtual_vendor_products
  tenant_id: string; // FK to tenants
  created_at?: string;
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
  deprecated?: string | null; // timestamp when deprecated
  deprecation_reason?: "direct" | "indirect" | null; // reason for deprecation
  wholesale?: number | null; // wholesale price
  retail?: number | null; // retail price
  user_id: string; // FK to users
  responsible_user_id?: string | null; // FK to users - The Manager who has the right to change access rights for this record
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
  last_change?: string | null; // vendor product change history
  user_id: string; // FK to users
}

export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
  user_id: string; // FK to users
}

export interface ProceedValidationSettings {
  id: string;
  user_id: string; // FK to users
  validation_mode: "permit" | "block" | "notify";
  created_at?: string;
  updated_at?: string;
}

export interface NonMassUnit {
  id: string;
  name: string;
}

// Phase 2: Authorization & Sharing
export interface ResourceShare {
  id: string;
  resource_type: string; // 'vendor_item', 'base_item', 'item', etc.
  resource_id: string;
  owner_tenant_id: string; // FK to tenants(id)
  target_type: "tenant" | "role" | "user";
  target_id: string | null; // tenant_id (uuid), role名 ('admin', 'manager', 'staff'), user_id (uuid) - nullable
  is_exclusion: boolean; // TRUE = FORBID（permitを上書き）
  allowed_actions: string[]; // ['read'] または ['read', 'update'] - View only または Editable
  show_history_to_shared: boolean; // 価格履歴の可視性
  created_at?: string;
  updated_at?: string;
}

/**
 * 認証付きAPIリクエスト
 * セッションからアクセストークンを取得してAuthorizationヘッダーに追加
 * @param endpoint - APIエンドポイント
 * @param options - リクエストオプション
 * @param tenantId - 現在のテナントID（オプション、テナント一覧取得時などは不要）
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  tenantId?: string | null
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session) {
    console.error("No session found or session error:", sessionError);
    // 認証エラー時にログインページにリダイレクト
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Authentication required.");
  }

  // ヘッダーを構築
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
    ...(options.headers as Record<string, string>),
  };

  // 選択されたテナントIDを取得（LocalStorageから）
  let selectedTenantId: string | null = null;
  if (typeof window !== "undefined") {
    selectedTenantId = localStorage.getItem("selectedTenantId");
  }

  // X-Tenant-IDヘッダーを追加（選択されたテナントIDがある場合）
  if (selectedTenantId) {
    headers["X-Tenant-ID"] = selectedTenantId;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // 401エラー（認証エラー）の場合はログインページにリダイレクト
    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Authentication required.");
    }

    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new Error(
      (errorData as { error?: string; message?: string }).error ||
        (errorData as { error?: string; message?: string }).message ||
        "API request failed"
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json();
}

// API呼び出しヘルパー（後方互換性のため残すが、apiRequestを使用）
// 注意: この関数はtenantIdを渡さないため、使用する際は注意が必要
// 新しいコードでは直接apiRequestを使用し、tenantIdを渡すことを推奨
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
  tenantId?: string | null
): Promise<T> {
  return apiRequest<T>(endpoint, options, tenantId);
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
  deprecate: (id: string) =>
    fetchAPI<{ message: string; affectedItems?: string[] }>(
      `/items/${id}/deprecate`,
      {
        method: "PATCH",
      }
    ),
};

// Recipe Lines API
export const recipeLinesAPI = {
  getByItemId: (itemId: string) =>
    fetchAPI<RecipeLine[]>(`/items/${itemId}/recipe`),
  getByItemIds: (itemIds: string[]) => {
    return fetchAPI<{ recipes: Record<string, RecipeLine[]> }>(
      "/items/recipes",
      {
        method: "POST",
        body: JSON.stringify({ item_ids: itemIds }),
      }
    );
  },
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
  batch: (operations: {
    creates: Partial<RecipeLine>[];
    updates: (Partial<RecipeLine> & { id: string })[];
    deletes: string[];
  }) => {
    return fetchAPI<{
      created: RecipeLine[];
      updated: RecipeLine[];
      deleted: string[];
    }>("/recipe-lines/batch", {
      method: "POST",
      body: JSON.stringify(operations),
    });
  },
};

// Cost API
export const costAPI = {
  getCost: (itemId: string, clearCache?: boolean) => {
    const query = clearCache ? "?clear_cache=true" : "";
    return fetchAPI<{ item_id: string; cost_per_gram: number }>(
      `/items/${itemId}/cost${query}`
    );
  },
  getCosts: (itemIds: string[]) => {
    return fetchAPI<{ costs: Record<string, number> }>("/items/costs", {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds }),
    });
  },
  // getCostsDifferential: フル計算に統一するため、コメントアウト
  // 将来的に差分更新が必要になった場合は、この関数を再実装してください
  /*
  getCostsDifferential: (params: {
    changed_item_ids?: string[];
    changed_vendor_product_ids?: string[];
    changed_base_item_ids?: string[];
    changed_labor_role_names?: string[];
  }) => {
    return fetchAPI<{ costs: Record<string, number> }>(
      "/items/costs/differential",
      {
        method: "POST",
        body: JSON.stringify({
          changed_item_ids: params.changed_item_ids || [],
          changed_vendor_product_ids: params.changed_vendor_product_ids || [],
          changed_base_item_ids: params.changed_base_item_ids || [],
          changed_labor_role_names: params.changed_labor_role_names || [],
        }),
      }
    );
  },
  */
  getCostsBreakdown: () => {
    return fetchAPI<{
      costs: Record<
        string,
        {
          food_cost_per_gram: number;
          labor_cost_per_gram: number;
          total_cost_per_gram: number;
        }
      >;
    }>("/items/costs/breakdown");
  },
};

// Base Items API
export const baseItemsAPI = {
  getAll: () => fetchAPI<BaseItem[]>("/base-items"),
  getById: (id: string) => fetchAPI<BaseItem>(`/base-items/${id}`),
  getVendorProducts: (baseItemId: string) =>
    fetchAPI<VendorProduct[]>(`/base-items/${baseItemId}/vendor-products`),
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
  deprecate: (id: string) =>
    fetchAPI<{ message: string }>(`/base-items/${id}/deprecate`, {
      method: "PATCH",
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
  deprecate: (id: string) =>
    fetchAPI<{ message: string; affectedItems?: string[] }>(
      `/vendor-products/${id}/deprecate`,
      {
        method: "PATCH",
      }
    ),
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

// Proceed Validation Settings API
export const proceedValidationSettingsAPI = {
  get: () =>
    fetchAPI<ProceedValidationSettings>("/proceed-validation-settings"),
  update: (settings: Partial<ProceedValidationSettings>) =>
    fetchAPI<ProceedValidationSettings>("/proceed-validation-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
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

// Product Mappings API
export const productMappingsAPI = {
  getAll: (params?: { base_item_id?: string; virtual_product_id?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.base_item_id) queryParams.append("base_item_id", params.base_item_id);
    if (params?.virtual_product_id) queryParams.append("virtual_product_id", params.virtual_product_id);
    const query = queryParams.toString();
    return fetchAPI<ProductMapping[]>(`/product-mappings${query ? `?${query}` : ""}`);
  },
  getById: (id: string) => fetchAPI<ProductMapping>(`/product-mappings/${id}`),
  create: (mapping: Partial<ProductMapping>) =>
    fetchAPI<ProductMapping>("/product-mappings", {
      method: "POST",
      body: JSON.stringify(mapping),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/product-mappings/${id}`, {
      method: "DELETE",
    }),
};

// Resource Shares API
export const resourceSharesAPI = {
  getAll: (params?: {
    resource_type?: string;
    resource_id?: string;
    owner_tenant_id?: string;
    target_type?: string;
    target_id?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.resource_type) queryParams.append("resource_type", params.resource_type);
    if (params?.resource_id) queryParams.append("resource_id", params.resource_id);
    if (params?.owner_tenant_id) queryParams.append("owner_tenant_id", params.owner_tenant_id);
    if (params?.target_type) queryParams.append("target_type", params.target_type);
    if (params?.target_id) queryParams.append("target_id", params.target_id);
    const query = queryParams.toString();
    return fetchAPI<ResourceShare[]>(`/resource-shares${query ? `?${query}` : ""}`);
  },
  getById: (id: string) => fetchAPI<ResourceShare>(`/resource-shares/${id}`),
  create: (share: Partial<ResourceShare>) =>
    fetchAPI<ResourceShare>("/resource-shares", {
      method: "POST",
      body: JSON.stringify(share),
    }),
  update: (id: string, share: Partial<ResourceShare>) =>
    fetchAPI<ResourceShare>(`/resource-shares/${id}`, {
      method: "PUT",
      body: JSON.stringify(share),
    }),
  delete: (id: string) =>
    fetchAPI<void>(`/resource-shares/${id}`, {
      method: "DELETE",
    }),
};

