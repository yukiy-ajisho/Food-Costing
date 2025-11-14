// モックデータ（SettingsとItemsページで共有）

export interface UnitConversion {
  id: string;
  from_unit: string;
  multiplier_to_grams: number;
  is_mass_unit: boolean;
  isMarkedForDeletion?: boolean;
}

// モックデータ（exportしてItemsページでも使用）
export const initialUnitConversions: UnitConversion[] = [
  {
    id: "1",
    from_unit: "g",
    multiplier_to_grams: 1,
    is_mass_unit: true,
  },
  {
    id: "2",
    from_unit: "kg",
    multiplier_to_grams: 1000,
    is_mass_unit: true,
  },
  {
    id: "3",
    from_unit: "lb",
    multiplier_to_grams: 453.592,
    is_mass_unit: true,
  },
  {
    id: "4",
    from_unit: "oz",
    multiplier_to_grams: 28.3495,
    is_mass_unit: true,
  },
  {
    id: "5",
    from_unit: "gallon",
    multiplier_to_grams: 0,
    is_mass_unit: false,
  },
  {
    id: "6",
    from_unit: "each",
    multiplier_to_grams: 0,
    is_mass_unit: false,
  },
  {
    id: "7",
    from_unit: "liter",
    multiplier_to_grams: 0,
    is_mass_unit: false,
  },
  {
    id: "8",
    from_unit: "cup",
    multiplier_to_grams: 0,
    is_mass_unit: false,
  },
  {
    id: "9",
    from_unit: "tablespoon",
    multiplier_to_grams: 0,
    is_mass_unit: false,
  },
];

// Labor Roleの型定義
export interface LaborRole {
  id: string;
  name: string;
  hourly_wage: number;
  isMarkedForDeletion?: boolean;
}

// Labor Rolesのモックデータ
export const initialLaborRoles: LaborRole[] = [
  {
    id: "1",
    name: "Prep Cook",
    hourly_wage: 20,
  },
  {
    id: "2",
    name: "Line Cook",
    hourly_wage: 25,
  },
  {
    id: "3",
    name: "Chef",
    hourly_wage: 30,
  },
];
