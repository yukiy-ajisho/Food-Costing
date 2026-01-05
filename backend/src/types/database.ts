// Database types based on the schema

export interface BaseItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
  deprecated?: string | null; // timestamp when deprecated
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
}

export interface Vendor {
  id: string;
  name: string;
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
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
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
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
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  responsible_user_id?: string | null; // FK to users - The Manager who has the right to change access rights for this record
  created_at?: string;
  updated_at?: string;
}

export interface RecipeLine {
  id: string;
  parent_item_id: string;
  line_type: "ingredient" | "labor";
  // Ingredient line fields
  child_item_id?: string | null;
  quantity?: number | null;
  unit?: string | null;
  specific_child?: string | null; // "lowest" or vendor_product.id (only for raw items)
  // Labor line fields
  labor_role?: string | null;
  minutes?: number | null;
  last_change?: string | null; // vendor product change history (e.g., "Vendor A → Vendor B → Vendor C")
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
}

export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
}

export interface NonMassUnit {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface ItemUnitProfile {
  id: string;
  item_id: string; // FK to items
  source_unit: string;
  grams_per_source_unit: number;
  user_id: string; // FK to users (deprecated, use tenant_id)
  tenant_id: string; // FK to tenants
  created_at?: string;
  updated_at?: string;
}

export interface ProceedValidationSettings {
  id: string;
  user_id: string; // FK to users (user preference, not tenant-specific)
  validation_mode: "permit" | "block" | "notify";
  created_at?: string;
  updated_at?: string;
}

export interface Tenant {
  id: string;
  name: string;
  type: "restaurant" | "vendor";
  created_at?: string;
}

export interface Profile {
  id: string;
  user_id: string; // FK to public.users(id)
  tenant_id: string; // FK to tenants(id)
  role: "admin" | "manager" | "staff";
  created_at?: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: "manager" | "staff";
  tenant_id: string; // FK to tenants(id)
  token: string;
  status: "pending" | "accepted" | "expired" | "canceled";
  email_status?: "delivered" | "failed" | null;
  email_id?: string | null; // Resendが返すメール送信の一意ID（Webhook更新用）
  created_by: string; // FK to users(id)
  created_at?: string;
  expires_at: string;
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

export interface HistoryLog {
  id: string;
  resource_type: string; // 'vendor_item', 'base_item', 'item', etc.
  resource_id: string;
  action: "create" | "update" | "delete";
  changed_fields?: Record<string, unknown> | null; // JSONB
  changed_by: string; // FK to users(id)
  tenant_id: string; // FK to tenants(id)
  visibility: "internal" | "shared";
  created_at?: string;
}
