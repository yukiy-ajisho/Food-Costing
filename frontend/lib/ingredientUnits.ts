import {
  MASS_UNIT_CONVERSIONS,
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  VOLUME_UNIT_TO_LITERS,
  isMassUnit,
  isNonMassUnit,
} from "@/lib/constants";
import type { BaseItem, Item } from "@/lib/api";

export function getAvailableUnitsForItem(
  item: Item | undefined,
  baseItems: BaseItem[],
): string[] {
  if (!item) return [...MASS_UNITS_ORDERED];

  if (item.item_kind === "prepped") {
    if (item.proceed_yield_unit === "each") {
      return [...MASS_UNITS_ORDERED, "each"];
    }
    return [...MASS_UNITS_ORDERED];
  }

  if (item.item_kind === "raw" && item.base_item_id) {
    const base = baseItems.find((b) => b.id === item.base_item_id);
    if (base?.specific_weight && base.specific_weight > 0) {
      return [
        ...MASS_UNITS_ORDERED,
        ...NON_MASS_UNITS_ORDERED.filter((u) => u !== "each"),
      ];
    }
  }

  return [...MASS_UNITS_ORDERED];
}

export function convertIngredientToGrams(
  quantity: number,
  unit: string,
  item: Item | undefined,
  baseItems: BaseItem[],
): number {
  if (!item || !Number.isFinite(quantity) || quantity <= 0) return 0;

  if (isMassUnit(unit)) {
    const multiplier = MASS_UNIT_CONVERSIONS[unit];
    return multiplier != null ? quantity * multiplier : 0;
  }

  if (unit === "each") {
    if (!item.each_grams || item.each_grams <= 0) return 0;
    return quantity * item.each_grams;
  }

  if (!isNonMassUnit(unit) || item.item_kind !== "raw" || !item.base_item_id) {
    return 0;
  }

  const base = baseItems.find((b) => b.id === item.base_item_id);
  if (!base?.specific_weight) return 0;

  const litersPerUnit = VOLUME_UNIT_TO_LITERS[unit];
  if (!litersPerUnit) return 0;

  const gramsPerSourceUnit = base.specific_weight * 1000 * litersPerUnit;
  return quantity * gramsPerSourceUnit;
}
