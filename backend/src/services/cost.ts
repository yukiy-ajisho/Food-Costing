import { supabase } from "../config/supabase";
import { Item, RecipeLine, RawItem, LaborRole } from "../types/database";
import { convertToGrams } from "./units";
import {
  MASS_UNIT_CONVERSIONS,
  VOLUME_UNIT_TO_LITERS,
  isNonMassUnit,
} from "../constants/units";

/**
 * コスト計算サービス
 * PDF仕様のセクション5.1に基づく再帰的コスト計算
 */

// キャッシュ（計算済みのコストを保存）
const costCache = new Map<string, number>();

/**
 * Raw Itemのコストを計算
 */
function computeRawCost(item: Item, rawItemsMap: Map<string, RawItem>): number {
  if (!item.purchase_unit || !item.purchase_quantity || !item.purchase_cost) {
    throw new Error(`Raw item ${item.id} is missing purchase information`);
  }

  if (!item.raw_item_id) {
    throw new Error(`Raw item ${item.id} is missing raw_item_id`);
  }

  // 質量単位の場合
  const multiplier = MASS_UNIT_CONVERSIONS[item.purchase_unit];
  if (multiplier) {
    const grams = item.purchase_quantity * multiplier;
    return item.purchase_cost / grams;
  }

  // 非質量単位の場合、raw_itemsから取得
  const rawItem = rawItemsMap.get(item.raw_item_id);
  if (!rawItem) {
    throw new Error(
      `Raw item ${item.id} references non-existent raw_item_id: ${item.raw_item_id}`
    );
  }

  let grams: number;

  if (item.purchase_unit === "each") {
    // eachの場合
    if (!rawItem.each_grams) {
      throw new Error(
        `Raw item ${item.id} uses 'each' unit but raw_item ${item.raw_item_id} has no each_grams`
      );
    }
    grams = item.purchase_quantity * rawItem.each_grams;
  } else if (isNonMassUnit(item.purchase_unit)) {
    // その他の非質量単位（gallon, liter, floz）
    if (!rawItem.specific_weight) {
      throw new Error(
        `Raw item ${item.id} uses non-mass unit ${item.purchase_unit} but raw_item ${item.raw_item_id} has no specific_weight`
      );
    }
    // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
    const litersPerUnit = VOLUME_UNIT_TO_LITERS[item.purchase_unit];
    if (!litersPerUnit) {
      throw new Error(`Invalid non-mass unit: ${item.purchase_unit}`);
    }
    const gramsPerSourceUnit = rawItem.specific_weight * 1000 * litersPerUnit;
    grams = item.purchase_quantity * gramsPerSourceUnit;
  } else {
    throw new Error(`Invalid unit: ${item.purchase_unit}`);
  }

  return item.purchase_cost / grams;
}

/**
 * 再帰的なコスト計算
 * @param itemId - アイテムID
 * @param visited - 訪問済みアイテムのセット（循環検出用）
 * @param rawItemsMap - Raw Itemsのマップ（raw_item_idをキーとして）
 * @param itemsMap - Itemsのマップ（item_idをキーとして）
 * @param laborRoles - 役職のマップ
 * @returns 1グラムあたりのコスト
 */
export async function getCost(
  itemId: string,
  visited: Set<string> = new Set(),
  rawItemsMap: Map<string, RawItem> = new Map(),
  itemsMap: Map<string, Item> = new Map(),
  laborRoles: Map<string, LaborRole> = new Map()
): Promise<number> {
  // 1. キャッシュチェック
  if (costCache.has(itemId)) {
    return costCache.get(itemId)!;
  }

  // 2. 循環検出
  if (visited.has(itemId)) {
    const path = Array.from(visited).join(" → ");
    throw new Error(
      `Cycle detected in recipe dependency chain. Item "${itemId}" creates a circular dependency. Path: ${path} → ${itemId}`
    );
  }

  // 3. 訪問済みマーク
  visited.add(itemId);

  try {
    // アイテムを取得
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      throw new Error(`Item ${itemId} not found: ${itemError?.message}`);
    }

    // Raw Itemの場合
    if (item.item_kind === "raw") {
      const costPerGram = computeRawCost(item, rawItemsMap);
      costCache.set(itemId, costPerGram);
      return costPerGram;
    }

    // Prepped Itemの場合
    if (!item.yield_amount || !item.yield_unit) {
      throw new Error(`Prepped item ${itemId} has no yield defined`);
    }

    // Yieldをグラムに変換
    // Yieldの単位は"g"または"each"のみ許可
    if (item.yield_unit !== "g" && item.yield_unit !== "each") {
      throw new Error(
        `Prepped item ${itemId} has invalid yield unit: ${item.yield_unit}. Only "g" and "each" are allowed.`
      );
    }

    let yieldGrams: number;
    if (item.yield_unit === "each") {
      // Yieldが"each"の場合、グラムに変換できない
      // この場合、コスト計算は1 eachあたりのコストを計算する
      // yieldGramsとしてYieldの数量をそのまま使用
      yieldGrams = item.yield_amount;
    } else {
      // Yieldが"g"の場合
      const yieldMultiplier = MASS_UNIT_CONVERSIONS[item.yield_unit];
      if (!yieldMultiplier) {
        throw new Error(
          `Prepped item ${itemId} has invalid yield unit: ${item.yield_unit}`
        );
      }
      yieldGrams = item.yield_amount * yieldMultiplier;
    }

    if (yieldGrams === 0) {
      throw new Error(`Prepped item ${itemId} has zero yield`);
    }

    // レシピラインを取得
    const { data: recipeLines, error: linesError } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", itemId);

    if (linesError) {
      throw new Error(
        `Failed to fetch recipe lines for item ${itemId}: ${linesError.message}`
      );
    }

    if (!recipeLines || recipeLines.length === 0) {
      throw new Error(
        `Prepped item ${itemId} must have at least one recipe line`
      );
    }

    let ingredientCost = 0;
    let laborCost = 0;

    // 各レシピラインを処理
    for (const line of recipeLines) {
      if (line.line_type === "ingredient") {
        if (!line.child_item_id || !line.quantity || !line.unit) {
          throw new Error(
            `Ingredient line ${line.id} is missing required fields`
          );
        }

        // 数量をグラムに変換
        const grams = convertToGrams(
          line.unit,
          line.quantity,
          line.child_item_id,
          itemsMap,
          rawItemsMap
        );

        // 子アイテムのコストを再帰的に取得
        const childCostPerGram = await getCost(
          line.child_item_id,
          visited,
          rawItemsMap,
          itemsMap,
          laborRoles
        );

        ingredientCost += grams * childCostPerGram;
      } else if (line.line_type === "labor") {
        if (!line.minutes || line.minutes <= 0) {
          throw new Error(`Labor line ${line.id} has invalid minutes`);
        }

        if (line.labor_role) {
          const role = laborRoles.get(line.labor_role);
          if (!role) {
            throw new Error(`Labor role ${line.labor_role} not found`);
          }
          const hourlyWage = role.hourly_wage;
          laborCost += (line.minutes / 60) * hourlyWage;
        }
      }
    }

    const totalBatchCost = ingredientCost + laborCost;
    const costPerGram = totalBatchCost / yieldGrams;

    // キャッシュに保存
    costCache.set(itemId, costPerGram);
    return costPerGram;
  } finally {
    // 訪問済みマークを削除
    visited.delete(itemId);
  }
}

/**
 * コストキャッシュをクリア
 */
export function clearCostCache(): void {
  costCache.clear();
}

/**
 * Raw Itemsを取得してマップに変換（raw_item_idをキーとして）
 */
export async function getRawItemsMap(): Promise<Map<string, RawItem>> {
  const { data, error } = await supabase.from("raw_items").select("*");

  if (error) {
    throw new Error(`Failed to fetch raw items: ${error.message}`);
  }

  const map = new Map<string, RawItem>();
  if (data) {
    for (const rawItem of data) {
      map.set(rawItem.id, rawItem);
    }
  }
  return map;
}

/**
 * Itemsを取得してマップに変換（item_idをキーとして）
 */
export async function getItemsMap(): Promise<Map<string, Item>> {
  const { data, error } = await supabase.from("items").select("*");

  if (error) {
    throw new Error(`Failed to fetch items: ${error.message}`);
  }

  const map = new Map<string, Item>();
  if (data) {
    for (const item of data) {
      map.set(item.id, item);
    }
  }
  return map;
}

/**
 * 役職を取得してマップに変換（nameをキーとして）
 */
export async function getLaborRolesMap(): Promise<Map<string, LaborRole>> {
  const { data, error } = await supabase.from("labor_roles").select("*");

  if (error) {
    throw new Error(`Failed to fetch labor roles: ${error.message}`);
  }

  const map = new Map<string, LaborRole>();
  if (data) {
    for (const role of data) {
      map.set(role.name, role);
    }
  }
  return map;
}

/**
 * コスト計算のエントリーポイント（ヘルパーデータを自動取得）
 */
export async function calculateCost(itemId: string): Promise<number> {
  const rawItemsMap = await getRawItemsMap();
  const itemsMap = await getItemsMap();
  const laborRoles = await getLaborRolesMap();
  return getCost(itemId, new Set(), rawItemsMap, itemsMap, laborRoles);
}
