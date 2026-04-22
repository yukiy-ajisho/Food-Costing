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
  current_price: number;
  case_unit?: number | null; // 1ケース = 何ユニット。NULL = ばら前提
  deprecated?: string | null; // timestamp when deprecated
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
  name: string | null; // Raw Itemの場合はnull（Base Itemのnameを使用）
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

// Company layer (companies, company_members, company_tenants)
export interface Company {
  id: string;
  company_name: string;
  created_at?: string;
  updated_at?: string;
}

export type CompanyMemberRole = "company_admin" | "company_director";

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role: CompanyMemberRole;
  created_at?: string;
  updated_at?: string;
}

export interface CompanyTenant {
  id: string;
  company_id: string;
  tenant_id: string;
  created_at?: string;
}

export type CompanyInvitationStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "canceled";

export interface CompanyInvitation {
  id: string;
  email: string;
  company_id: string;
  token: string;
  status: CompanyInvitationStatus;
  email_status?: "delivered" | "failed" | null;
  created_by: string;
  created_at?: string;
  expires_at: string;
  email_id?: string | null;
}

export interface Profile {
  id: string;
  user_id: string; // FK to public.users(id)
  tenant_id: string; // FK to tenants(id)
  role: "admin" | "manager" | "staff" | "director";
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

// Cross-tenant item sharing（同一 company 内テナント間での prepped item 公開設定）
export interface CrossTenantItemShare {
  id: string;
  company_id: string; // FK to companies(id)
  item_id: string; // FK to items(id)（item_kind = 'prepped' のみ）
  owner_tenant_id: string; // FK to tenants(id)
  target_type: "company" | "tenant";
  // 'company': company_id（全テナント公開）, 'tenant': 対象 tenant_id（特定テナント）
  target_id: string;
  created_by: string; // FK to users(id)
  allowed_actions: string[]; // ['read'] = view, [] = 明示的 hide
  created_at?: string;
  updated_at?: string;
}

// Phase 2: Authorization & Sharing
export interface ResourceShare {
  id: string;
  resource_type: string; // 'vendor_item', 'base_item', 'item', etc.
  resource_id: string;
  owner_tenant_id: string; // FK to tenants(id)
  target_type: "tenant" | "role" | "user";
  target_id: string | null; // tenant_id (uuid), role名 ('admin', 'manager', 'staff', 'director'), user_id (uuid) - nullable
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

// Reminder: Employee Requirements (要件の定義)
export interface UserRequirement {
  id: string;
  title: string;
  company_id: string;
  jurisdiction_id: string;
  validity_period: number | null;
  validity_period_unit: string | null; // 'years' | 'months' | 'days'. NULL = years
  first_due_date: number | null; // 雇われてから何日以内に取得が必要か（日数）。Days from hire のとき使用
  first_due_on_date: string | null; // date YYYY-MM-DD。First due date on のとき使用。first_due_date と排他
  renewal_advance_days: number | null;
  expiry_rule: string | null;
  created_at?: string;
  updated_at?: string;
  created_by: string | null; // FK to users(id)
}

// Reminder: 適用状態（誰にどの要件を適用しているか）
// user_requirement_id は要件削除時に ON DELETE SET NULL で NULL になる
export interface UserRequirementAssignment {
  id: string;
  user_id: string;
  user_requirement_id: string | null;
  is_currently_assigned: boolean;
  created_at?: string;
  deleted_at?: string | null;
}

// Reminder: 人×要件の紐付け（発行日・期限）
export interface MappingUserRequirement {
  id: string;
  user_id: string;
  user_requirement_id: string;
  issued_date: string | null; // date YYYY-MM-DD
  specific_date: string | null; // date YYYY-MM-DD（手入力の期限日。auto OFF のとき使用）
  created_at?: string;
  updated_at?: string;
}

/** Invoice document stored in R2 (value = R2 object key) */
export interface DocumentMetadataInvoice {
  id: string;
  tenant_id: string;
  vendor_id: string | null;
  value: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  invoice_date: string | null; // date YYYY-MM-DD（未確定時は NULL）
  total_amount: number | null;
  created_at?: string;
  created_by: string;
}

/** Employee requirement document (R2 key in value) */
export interface DocumentMetadataUserRequirement {
  id: string;
  mapping_user_requirement_id: string;
  value: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  created_at?: string;
}

// Tenant Requirements v2（設計: tenant_requirements_design_v2.txt）
export interface TenantRequirement {
  id: string;
  title: string;
  tenant_id: string;
  created_at?: string;
  updated_at?: string;
}

export type TenantRequirementDataType = "date" | "int";

export interface TenantRequirementValueType {
  id: string;
  name: string;
  data_type: TenantRequirementDataType;
}

export interface TenantRequirementRealData {
  id: string;
  tenant_requirement_id: string;
  group_key: number;
  type_id: string;
  value: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Legacy: mapping_tenant_requirements テーブル用（v2 でテーブル削除済み・ルート未マウント） */
export interface MappingTenantRequirement {
  id: string;
  tenant_id: string;
  tenant_requirement_id: string;
  due_date: string | null;
  pay_date: string | null;
  notice_date: string | null;
  created_at?: string;
  updated_at?: string;
}

// Company Requirements（tenant と同じ構成、認可は company_members）
export interface CompanyRequirement {
  id: string;
  title: string;
  company_id: string;
  created_at?: string;
  updated_at?: string;
}

export type CompanyRequirementDataType = "date" | "int" | "text";

export interface CompanyRequirementValueType {
  id: string;
  name: string;
  data_type: CompanyRequirementDataType;
}

export interface CompanyRequirementRealData {
  id: string;
  company_requirement_id: string;
  group_key: number;
  type_id: string;
  value: string | null;
  created_at?: string;
  updated_at?: string;
}
