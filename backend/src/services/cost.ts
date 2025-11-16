import { supabase } from "../config/supabase";
import {
  Item,
  RecipeLine,
  BaseItem,
  LaborRole,
  VendorProduct,
} from "../types/database";
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
function computeRawCost(
  item: Item,
  vendorProduct: VendorProduct,
  baseItemsMap: Map<string, BaseItem>
): number {
  if (
    !vendorProduct.purchase_unit ||
    !vendorProduct.purchase_quantity ||
    !vendorProduct.purchase_cost
  ) {
    throw new Error(
      `Raw item ${item.id} is missing purchase information in vendor_product`
    );
  }

  // 質量単位の場合
  const multiplier = MASS_UNIT_CONVERSIONS[vendorProduct.purchase_unit];
  if (multiplier) {
    const grams = vendorProduct.purchase_quantity * multiplier;
    return vendorProduct.purchase_cost / grams;
  }

  // 非質量単位の場合、base_itemsから取得
  if (!item.base_item_id) {
    throw new Error(`Raw item ${item.id} has no base_item_id`);
  }

  const baseItem = baseItemsMap.get(item.base_item_id);
  if (!baseItem) {
    throw new Error(
      `Raw item ${item.id} references non-existent base_item_id: ${item.base_item_id}`
    );
  }

  let grams: number;

  if (vendorProduct.purchase_unit === "each") {
    // eachの場合、items.each_gramsを使用
    if (!item.each_grams) {
      throw new Error(
        `Raw item ${item.id} uses 'each' unit but has no each_grams`
      );
    }
    grams = vendorProduct.purchase_quantity * item.each_grams;
  } else if (isNonMassUnit(vendorProduct.purchase_unit)) {
    // その他の非質量単位（gallon, liter, floz）
    if (!baseItem.specific_weight) {
      throw new Error(
        `Raw item ${item.id} uses non-mass unit ${vendorProduct.purchase_unit} but base_item ${item.base_item_id} has no specific_weight`
      );
    }
    // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
    const litersPerUnit = VOLUME_UNIT_TO_LITERS[vendorProduct.purchase_unit];
    if (!litersPerUnit) {
      throw new Error(`Invalid non-mass unit: ${vendorProduct.purchase_unit}`);
    }
    const gramsPerSourceUnit = baseItem.specific_weight * 1000 * litersPerUnit;
    grams = vendorProduct.purchase_quantity * gramsPerSourceUnit;
  } else {
    throw new Error(`Invalid unit: ${vendorProduct.purchase_unit}`);
  }

  return vendorProduct.purchase_cost / grams;
}

/**
 * 再帰的なコスト計算
 * @param itemId - アイテムID
 * @param visited - 訪問済みアイテムのセット（循環検出用）
 * @param baseItemsMap - Base Itemsのマップ（base_item_idをキーとして）
 * @param itemsMap - Itemsのマップ（item_idをキーとして）
 * @param vendorProductsMap - Vendor Productsのマップ（vendor_product_idをキーとして）
 * @param laborRoles - 役職のマップ
 * @returns 1グラムあたりのコスト
 */
export async function getCost(
  itemId: string,
  visited: Set<string> = new Set(),
  baseItemsMap: Map<string, BaseItem> = new Map(),
  itemsMap: Map<string, Item> = new Map(),
  vendorProductsMap: Map<string, VendorProduct> = new Map(),
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
      if (!item.base_item_id) {
        throw new Error(`Raw item ${itemId} has no base_item_id`);
      }

      // base_item_idでvendor_productを検索
      let vendorProduct: VendorProduct | undefined;
      for (const vp of vendorProductsMap.values()) {
        if (vp.base_item_id === item.base_item_id) {
          vendorProduct = vp;
          break;
        }
      }

      if (!vendorProduct) {
        throw new Error(
          `Vendor product not found for base_item ${item.base_item_id}`
        );
      }

      const costPerGram = computeRawCost(item, vendorProduct, baseItemsMap);
      costCache.set(itemId, costPerGram);
      return costPerGram;
    }

    // Prepped Itemの場合
    if (!item.proceed_yield_amount || !item.proceed_yield_unit) {
      throw new Error(`Prepped item ${itemId} has no yield defined`);
    }

    // Yieldをグラムに変換
    // Yieldの単位は"g"または"each"のみ許可
    if (item.proceed_yield_unit !== "g" && item.proceed_yield_unit !== "each") {
      throw new Error(
        `Prepped item ${itemId} has invalid yield unit: ${item.proceed_yield_unit}. Only "g" and "each" are allowed.`
      );
    }

    let yieldGrams: number;
    if (item.proceed_yield_unit === "each") {
      // Yieldが"each"の場合、材料の総合計（グラム）を使用
      // まず材料の総合計を計算
      const { data: recipeLines } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("parent_item_id", itemId)
        .eq("line_type", "ingredient");

      if (!recipeLines || recipeLines.length === 0) {
        throw new Error(
          `Prepped item ${itemId} with 'each' yield must have at least one ingredient line`
        );
      }

      let totalIngredientsGrams = 0;
      for (const line of recipeLines) {
        if (!line.child_item_id || !line.quantity || !line.unit) {
          continue;
        }

        const grams = convertToGrams(
          line.unit,
          line.quantity,
          line.child_item_id,
          itemsMap,
          rawItemsMap,
          vendorProductsMap
        );
        totalIngredientsGrams += grams;
      }

      if (totalIngredientsGrams === 0) {
        throw new Error(
          `Prepped item ${itemId} with 'each' yield has zero total ingredients`
        );
      }

      // 材料の総合計をeach_gramsに保存（まだ保存されていない場合）
      if (!item.each_grams) {
        await supabase
          .from("items")
          .update({ each_grams: totalIngredientsGrams })
          .eq("id", itemId);
        // itemsMapも更新
        itemsMap.set(itemId, { ...item, each_grams: totalIngredientsGrams });
      }

      yieldGrams = totalIngredientsGrams;
    } else {
      // Yieldが"g"の場合
      const yieldMultiplier = MASS_UNIT_CONVERSIONS[item.proceed_yield_unit];
      if (!yieldMultiplier) {
        throw new Error(
          `Prepped item ${itemId} has invalid yield unit: ${item.proceed_yield_unit}`
        );
      }
      yieldGrams = item.proceed_yield_amount * yieldMultiplier;
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
          baseItemsMap,
          vendorProductsMap
        );

        // 子アイテムのコストを再帰的に取得
        const childCostPerGram = await getCost(
          line.child_item_id,
          visited,
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
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
 * Base Itemsを取得してマップに変換（base_item_idをキーとして）
 */
export async function getBaseItemsMap(): Promise<Map<string, BaseItem>> {
  const { data, error } = await supabase.from("base_items").select("*");

  if (error) {
    throw new Error(`Failed to fetch base items: ${error.message}`);
  }

  const map = new Map<string, BaseItem>();
  if (data) {
    for (const baseItem of data) {
      map.set(baseItem.id, baseItem);
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
 * Vendor Productsを取得してマップに変換（vendor_product_idをキーとして）
 */
export async function getVendorProductsMap(): Promise<
  Map<string, VendorProduct>
> {
  const { data, error } = await supabase.from("vendor_products").select("*");

  if (error) {
    throw new Error(`Failed to fetch vendor products: ${error.message}`);
  }

  const map = new Map<string, VendorProduct>();
  if (data) {
    for (const vendorProduct of data) {
      map.set(vendorProduct.id, vendorProduct);
    }
  }
  return map;
}

/**
 * コスト計算のエントリーポイント（ヘルパーデータを自動取得）
 */
export async function calculateCost(itemId: string): Promise<number> {
  const baseItemsMap = await getBaseItemsMap();
  const itemsMap = await getItemsMap();
  const vendorProductsMap = await getVendorProductsMap();
  const laborRoles = await getLaborRolesMap();
  return getCost(
    itemId,
    new Set(),
    baseItemsMap,
    itemsMap,
    vendorProductsMap,
    laborRoles
  );
}
