import {
  MASS_UNIT_CONVERSIONS,
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  VOLUME_UNIT_TO_LITERS,
  isMassUnit,
  isNonMassUnit,
} from "@/lib/constants";
import type { BaseItem, Item } from "@/lib/api";

export type UnitLookupVendorProduct = {
  base_item_id: string;
  purchase_unit: string;
};

export function ensureUnitInList(units: string[], unit: string): string[] {
  const normalized = unit.trim();
  if (!normalized || units.includes(normalized)) return units;
  return [...units, normalized];
}

export function getAvailableUnitsForItem(
  item: Item | undefined,
  baseItems: BaseItem[],
  vendorProducts: readonly UnitLookupVendorProduct[] = [],
): string[] {
  if (!item) return [...MASS_UNITS_ORDERED];

  if (item.item_kind === "prepped") {
    if (item.proceed_yield_unit === "each") {
      return [...MASS_UNITS_ORDERED, "each"];
    }
    return [...MASS_UNITS_ORDERED];
  }

  if (item.item_kind === "raw") {
    if (!item.base_item_id) {
      return withEachWhenConfigured(item, [...MASS_UNITS_ORDERED]);
    }

    const base = baseItems.find((b) => b.id === item.base_item_id);
    if (!base) {
      return withEachWhenConfigured(item, [...MASS_UNITS_ORDERED]);
    }

    const productsForBase = vendorProducts.filter(
      (vp) => vp.base_item_id === item.base_item_id,
    );

    if (productsForBase.length > 0) {
      const hasVolumePurchase = productsForBase.some(
        (vp) =>
          vp.purchase_unit &&
          isNonMassUnit(vp.purchase_unit) &&
          vp.purchase_unit !== "each",
      );
      if (hasVolumePurchase) {
        return [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED];
      }

      const hasEachPurchase = productsForBase.some(
        (vp) => vp.purchase_unit === "each",
      );
      if (hasEachPurchase) {
        return [...MASS_UNITS_ORDERED, "each"];
      }

      return withEachWhenConfigured(item, [...MASS_UNITS_ORDERED]);
    }

    if (base.specific_weight && base.specific_weight > 0) {
      return [
        ...MASS_UNITS_ORDERED,
        ...NON_MASS_UNITS_ORDERED.filter((u) => u !== "each"),
      ];
    }

    return withEachWhenConfigured(item, [...MASS_UNITS_ORDERED]);
  }

  return [...MASS_UNITS_ORDERED];
}

function withEachWhenConfigured(item: Item, units: string[]): string[] {
  if (item.each_grams && item.each_grams > 0 && !units.includes("each")) {
    return [...units, "each"];
  }
  return units;
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
