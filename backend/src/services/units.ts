import {
  MASS_UNIT_CONVERSIONS,
  VOLUME_UNIT_TO_LITERS,
  isMassUnit,
  isNonMassUnit,
} from "../constants/units";
import { Item, RawItem } from "../types/database";

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
 */
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
 * @param rawItemsMap - Raw Itemsのマップ（raw_item_idをキーとして）
 * @returns グラム数
 */
export function convertToGrams(
  unit: string,
  quantity: number,
  itemId: string,
  itemsMap: Map<string, Item>,
  rawItemsMap: Map<string, RawItem>
): number {
  // 質量単位の場合
  if (isMassUnit(unit)) {
    return convertMassUnitToGrams(unit, quantity);
  }

  // 非質量単位の場合、itemからraw_item_idを取得
  const item = itemsMap.get(itemId);
  if (!item) {
    throw new Error(`Item ${itemId} not found in itemsMap`);
  }

  if (!item.raw_item_id) {
    throw new Error(`Item ${itemId} has no raw_item_id`);
  }

  const rawItem = rawItemsMap.get(item.raw_item_id);
  if (!rawItem) {
    throw new Error(
      `Raw item ${item.raw_item_id} not found in rawItemsMap for item ${itemId}`
    );
  }

  if (unit === "each") {
    // eachの場合
    if (!rawItem.each_grams) {
      throw new Error(
        `Item ${itemId} uses 'each' unit but raw_item ${item.raw_item_id} has no each_grams`
      );
    }
    return quantity * rawItem.each_grams;
  }

  // その他の非質量単位（gallon, liter, floz）
  if (!isNonMassUnit(unit)) {
    throw new Error(`Invalid unit: ${unit}`);
  }

  if (!rawItem.specific_weight) {
    throw new Error(
      `Item ${itemId} uses non-mass unit ${unit} but raw_item ${item.raw_item_id} has no specific_weight`
    );
  }

  // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
  const litersPerUnit = VOLUME_UNIT_TO_LITERS[unit];
  if (!litersPerUnit) {
    throw new Error(`Invalid non-mass unit: ${unit}`);
  }
  const gramsPerSourceUnit = rawItem.specific_weight * 1000 * litersPerUnit;
  return quantity * gramsPerSourceUnit;
}
