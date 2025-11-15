// Database types based on the schema

export interface Item {
  id: string;
  name: string;
  item_kind: "raw" | "prepped";
  is_menu_item: boolean;
  // Raw item fields
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

export interface ItemUnitProfile {
  id: string;
  item_id: string;
  source_unit: string;
  grams_per_source_unit: number;
  notes?: string | null;
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
