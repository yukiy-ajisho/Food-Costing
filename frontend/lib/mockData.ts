// モックデータ（SettingsとItemsページで共有）

export interface UnitConversion {
  id: string;
  from_unit: string;
  multiplier_to_grams: number;
  isMarkedForDeletion?: boolean;
}

// モックデータ（exportしてItemsページでも使用）
export const initialUnitConversions: UnitConversion[] = [
  {
    id: "1",
    from_unit: "g",
    multiplier_to_grams: 1,
  },
  {
    id: "2",
    from_unit: "kg",
    multiplier_to_grams: 1000,
  },
  {
    id: "3",
    from_unit: "lb",
    multiplier_to_grams: 453.592,
  },
  {
    id: "4",
    from_unit: "oz",
    multiplier_to_grams: 28.3495,
  },
];

// Non-Mass Unitの型定義
export interface NonMassUnit {
  id: string;
  name: string;
  isMarkedForDeletion?: boolean;
}

// Non-Mass Unitsのモックデータ
export const initialNonMassUnits: NonMassUnit[] = [
  {
    id: "1",
    name: "gallon",
  },
  {
    id: "2",
    name: "each",
  },
  {
    id: "3",
    name: "liter",
  },
  {
    id: "4",
    name: "cup",
  },
  {
    id: "5",
    name: "tablespoon",
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
