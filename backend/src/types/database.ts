// Database types based on the schema

export interface BaseItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
  deprecated?: string | null; // timestamp when deprecated
  user_id: string; // FK to users
  created_at?: string;
  updated_at?: string;
}

export interface Vendor {
  id: string;
  name: string;
  user_id: string; // FK to users
  created_at?: string;
  updated_at?: string;
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
  deprecated?: string | null; // timestamp when deprecated
  user_id: string; // FK to users
  created_at?: string;
  updated_at?: string;
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
  user_id: string; // FK to users
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
  user_id: string; // FK to users
  created_at?: string;
  updated_at?: string;
}

export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
  user_id: string; // FK to users
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
  user_id: string; // FK to users
  created_at?: string;
  updated_at?: string;
}
