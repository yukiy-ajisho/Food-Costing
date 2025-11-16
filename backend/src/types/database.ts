// Database types based on the schema

export interface RawItem {
  id: string;
  name: string;
  specific_weight?: number | null; // g/ml for non-mass units (gallon, liter, floz)
  each_grams?: number | null; // grams for 'each' unit
  created_at?: string;
  updated_at?: string;
}

export interface Vendor {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface Item {
  id: string;
  name: string;
  item_kind: "raw" | "prepped";
  is_menu_item: boolean;
  // Raw item fields
  raw_item_id?: string | null; // FK to raw_items
  vendor_id?: string | null; // FK to vendors
  purchase_unit?: string | null;
  purchase_quantity?: number | null;
  purchase_cost?: number | null;
  // Prepped item fields
  yield_amount?: number | null;
  yield_unit?: string | null;
  notes?: string | null;
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
  // Labor line fields
  labor_role?: string | null;
  minutes?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
  created_at?: string;
  updated_at?: string;
}

export interface NonMassUnit {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}
