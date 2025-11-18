import {
  MASS_UNIT_CONVERSIONS,
  VOLUME_UNIT_TO_LITERS,
  isMassUnit,
  isNonMassUnit,
} from "../constants/units";
import { Item, BaseItem, VendorProduct } from "../types/database";

/**
 * 単位変換サービス
 * 全ての単位をグラムに変換する
 */

/**
 * 質量単位をグラムに変換
 */
function convertMassUnitToGrams(unit: string, quantity: number): number {
  const multiplier = MASS_UNIT_CONVERSIONS[unit];
  if (!multiplier) {
    throw new Error(`Invalid mass unit: ${unit}`);
  }
  return quantity * multiplier;
}

/**
 * 非質量単位（each以外）をリットルに変換
 * @deprecated 現在未使用。将来的に使用する可能性があるため残しています。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function convertVolumeUnitToLiters(unit: string, quantity: number): number {
  const multiplier = VOLUME_UNIT_TO_LITERS[unit];
  if (!multiplier) {
    throw new Error(`Invalid volume unit: ${unit}`);
  }
  return quantity * multiplier;
}

/**
 * 単位と数量をグラムに変換
 * @param unit - 単位（g, kg, gallon, eachなど）
 * @param quantity - 数量
 * @param itemId - アイテムID（非質量単位の場合に必要）
 * @param itemsMap - Itemsのマップ（item_idをキーとして）
 * @param baseItemsMap - Base Itemsのマップ（base_item_idをキーとして）
 * @param vendorProductsMap - Vendor Productsのマップ（vendor_product_idをキーとして）
 * @returns グラム数
 */
export function convertToGrams(
  unit: string,
  quantity: number,
  itemId: string,
  itemsMap: Map<string, Item>,
  baseItemsMap: Map<string, BaseItem>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vendorProductsMap?: Map<string, VendorProduct>
): number {
  // 質量単位の場合
  if (isMassUnit(unit)) {
    return convertMassUnitToGrams(unit, quantity);
  }

  // 非質量単位の場合
  const item = itemsMap.get(itemId);
  if (!item) {
    throw new Error(`Item ${itemId} not found in itemsMap`);
  }

  if (unit === "each") {
    // eachの場合
    // Prepped ItemまたはRaw Itemのeach_gramsを使用
    if (!item.each_grams) {
      throw new Error(`Item ${itemId} uses 'each' unit but has no each_grams`);
    }
    return quantity * item.each_grams;
  }

  // その他の非質量単位（gallon, liter, floz）
  if (!isNonMassUnit(unit)) {
    throw new Error(`Invalid unit: ${unit}`);
  }

  // Raw Itemの場合、base_item → specific_weight
  if (item.item_kind === "raw") {
    if (!item.base_item_id) {
      throw new Error(`Raw item ${itemId} has no base_item_id`);
    }

    const baseItem = baseItemsMap.get(item.base_item_id);
    if (!baseItem) {
      throw new Error(
        `Base item ${item.base_item_id} not found for item ${itemId}`
      );
    }

    if (!baseItem.specific_weight) {
      throw new Error(
        `Item ${itemId} uses non-mass unit ${unit} but base_item ${item.base_item_id} has no specific_weight`
      );
    }

    // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
    const litersPerUnit = VOLUME_UNIT_TO_LITERS[unit];
    if (!litersPerUnit) {
      throw new Error(`Invalid non-mass unit: ${unit}`);
    }
    const gramsPerSourceUnit = baseItem.specific_weight * 1000 * litersPerUnit;
    return quantity * gramsPerSourceUnit;
  }

  // Prepped Itemの場合、非質量単位は使用できない
  throw new Error(`Prepped item ${itemId} cannot use non-mass unit ${unit}`);
}
