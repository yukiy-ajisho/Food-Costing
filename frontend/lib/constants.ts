/**
 * ハードコードされた単位変換定数
 * バックエンドと同じ値を使用
 */

// 質量単位の変換表（単位 → グラム）
export const MASS_UNIT_CONVERSIONS: Record<string, number> = {
  g: 1,
  kg: 1000,
  lb: 453.592,
  oz: 28.3495,
};

// 非質量単位 → リットルの変換表（eachは除外）
export const VOLUME_UNIT_TO_LITERS: Record<string, number> = {
  gallon: 3.78541, // 1 gallon = 3.78541 liters
  liter: 1, // 1 liter = 1 liter
  floz: 0.0295735, // 1 floz = 0.0295735 liters
  ml: 0.001, // 1 ml = 0.001 liter
};

// 非質量単位のリスト
export const NON_MASS_UNITS: string[] = [
  "gallon",
  "liter",
  "floz",
  "ml",
  "each",
];

// 質量単位の順番（表示順序を制御）
export const MASS_UNITS_ORDERED: string[] = ["g", "kg", "oz", "lb"];

// 非質量単位の順番（表示順序を制御）
export const NON_MASS_UNITS_ORDERED: string[] = [
  "floz",
  "ml",
  "liter",
  "gallon",
  "each",
];

/**
 * 質量単位かどうかを判定
 */
export function isMassUnit(unit: string): boolean {
  return unit in MASS_UNIT_CONVERSIONS;
}

/**
 * 非質量単位かどうかを判定
 */
export function isNonMassUnit(unit: string): boolean {
  return NON_MASS_UNITS.includes(unit);
}
