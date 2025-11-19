import { supabase } from "../config/supabase";
import { Item, BaseItem, LaborRole, VendorProduct } from "../types/database";
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
 * Raw Itemのコストを計算（1グラムあたりのコスト）
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
 * @param specificVendorProductId - 特定のvendor_productを指定（"lowest" | vendor_product.id | null）
 * @returns 1グラムあたりのコスト
 */
/**
 * キャッシュキーを生成
 * Raw Itemの場合: itemId + specificVendorProductId
 * Prepped Itemの場合: itemIdのみ（子アイテムのコストは再帰的に計算されるため）
 */
function getCacheKey(
  itemId: string,
  itemKind: "raw" | "prepped",
  specificVendorProductId: string | "lowest" | null
): string {
  if (itemKind === "raw" && specificVendorProductId) {
    // Raw Itemの場合、specificVendorProductIdを含める
    const vpId =
      specificVendorProductId === "lowest" ? "lowest" : specificVendorProductId;
    return `${itemId}:${vpId}`;
  }
  // Prepped Itemの場合、itemIdのみ
  return itemId;
}

export async function getCost(
  itemId: string,
  visited: Set<string> = new Set(),
  baseItemsMap: Map<string, BaseItem> = new Map(),
  itemsMap: Map<string, Item> = new Map(),
  vendorProductsMap: Map<string, VendorProduct> = new Map(),
  laborRoles: Map<string, LaborRole> = new Map(),
  specificVendorProductId: string | "lowest" | null = null
): Promise<number> {
  // アイテムを取得してitemKindを確認（キャッシュキー生成のため）
  let item = itemsMap.get(itemId);
  if (!item) {
    const { data: fetchedItem, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !fetchedItem) {
      throw new Error(`Item ${itemId} not found: ${itemError?.message}`);
    }
    item = fetchedItem;
    itemsMap.set(itemId, item);
  }

  // 1. キャッシュチェック
  const cacheKey = getCacheKey(itemId, item.item_kind, specificVendorProductId);
  if (costCache.has(cacheKey)) {
    return costCache.get(cacheKey)!;
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
    // アイテムは既に取得済み（キャッシュキー生成のため）

    /**
     * 子アイテムがitemsMapに存在することを保証するヘルパー関数
     * convertToGrams呼び出し前に使用
     */
    const ensureItemInMap = async (childItemId: string): Promise<void> => {
      if (!itemsMap.has(childItemId)) {
        const { data: fetchedItem, error: itemError } = await supabase
          .from("items")
          .select("*")
          .eq("id", childItemId)
          .single();

        if (itemError || !fetchedItem) {
          throw new Error(
            `Item ${childItemId} not found: ${itemError?.message}`
          );
        }
        itemsMap.set(childItemId, fetchedItem);
      }
    };

    // Raw Itemの場合
    if (item.item_kind === "raw") {
      if (!item.base_item_id) {
        throw new Error(`Raw item ${itemId} has no base_item_id`);
      }

      // base_item_idで全てのvendor_productsを取得（統一した経路）
      const matchingVendorProducts: VendorProduct[] = [];
      for (const vp of vendorProductsMap.values()) {
        if (vp.base_item_id === item.base_item_id) {
          matchingVendorProducts.push(vp);
        }
      }

      if (matchingVendorProducts.length === 0) {
        throw new Error(
          `Vendor product not found for base_item ${item.base_item_id}`
        );
      }

      let selectedVendorProduct: VendorProduct | undefined;
      let costPerGram: number;

      // specificVendorProductIdに応じて処理を分岐
      if (
        specificVendorProductId === "lowest" ||
        specificVendorProductId === null
      ) {
        // 最安のものを選択
        let cheapestCostPerGram = Infinity;

        for (const vp of matchingVendorProducts) {
          try {
            const vpCostPerGram = computeRawCost(item, vp, baseItemsMap);
            if (vpCostPerGram < cheapestCostPerGram) {
              cheapestCostPerGram = vpCostPerGram;
              selectedVendorProduct = vp;
            }
          } catch (error) {
            // 計算できないvendor_productはスキップ
            console.warn(
              `Failed to calculate cost for vendor product ${vp.id}:`,
              error
            );
          }
        }

        if (!selectedVendorProduct) {
          throw new Error(
            `No valid vendor product found for base_item ${item.base_item_id}`
          );
        }

        costPerGram = cheapestCostPerGram;
      } else {
        // 特定のvendor_productを指定
        selectedVendorProduct = matchingVendorProducts.find(
          (vp) => vp.id === specificVendorProductId
        );

        if (!selectedVendorProduct) {
          throw new Error(
            `Vendor product ${specificVendorProductId} not found for base_item ${item.base_item_id}`
          );
        }

        costPerGram = computeRawCost(item, selectedVendorProduct, baseItemsMap);
      }

      // キャッシュに保存（Raw Itemの場合、specificVendorProductIdを含むキーを使用）
      const cacheKey = getCacheKey(itemId, "raw", specificVendorProductId);
      costCache.set(cacheKey, costPerGram);
      return costPerGram;
    }

    // Prepped Itemの場合
    if (!item.proceed_yield_amount || !item.proceed_yield_unit) {
      throw new Error(`Prepped item ${itemId} has no yield defined`);
    }

    // Yieldをグラムに変換
    // Yieldの単位は"g", "kg", "each"を許可
    if (
      item.proceed_yield_unit !== "g" &&
      item.proceed_yield_unit !== "kg" &&
      item.proceed_yield_unit !== "each"
    ) {
      throw new Error(
        `Prepped item ${itemId} has invalid yield unit: ${item.proceed_yield_unit}. Only "g", "kg", and "each" are allowed.`
      );
    }

    // レシピラインを1回だけ取得（問題6-1の修正）
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

    // 材料のグラム数を保存するMap（問題6-2の修正）
    const ingredientGramsMap = new Map<string, number>();

    // Yield計算
    let yieldGrams: number;
    if (item.proceed_yield_unit === "each") {
      // Yieldが"each"の場合、材料の総合計（グラム）を使用
      const ingredientLines = recipeLines.filter(
        (line) => line.line_type === "ingredient"
      );

      if (ingredientLines.length === 0) {
        throw new Error(
          `Prepped item ${itemId} with 'each' yield must have at least one ingredient line`
        );
      }

      let totalIngredientsGrams = 0;
      for (const line of ingredientLines) {
        if (!line.child_item_id || !line.quantity || !line.unit) {
          continue;
        }

        // 子アイテムがitemsMapに存在することを保証（問題5の修正）
        await ensureItemInMap(line.child_item_id);

        const grams = convertToGrams(
          line.unit,
          line.quantity,
          line.child_item_id,
          itemsMap,
          baseItemsMap,
          vendorProductsMap
        );

        ingredientGramsMap.set(line.id, grams); // 保存（問題6-2の修正）
        totalIngredientsGrams += grams;
      }

      if (totalIngredientsGrams === 0) {
        throw new Error(
          `Prepped item ${itemId} with 'each' yield has zero total ingredients`
        );
      }

      // Yield Amountを考慮してeach_gramsを計算（1個あたりの重量）
      const yieldAmount = item.proceed_yield_amount || 1;
      let eachGrams: number;

      if (item.each_grams && item.each_grams > 0) {
        // フロントエンドから手動入力された値を使用
        eachGrams = item.each_grams;
      } else {
        // 自動計算: 材料の総合計 / Yield Amount
        eachGrams = totalIngredientsGrams / yieldAmount;
      }

      // each_gramsに保存（値が変わった場合のみ更新）
      if (item.each_grams !== eachGrams) {
        const { error: updateError } = await supabase
          .from("items")
          .update({ each_grams: eachGrams })
          .eq("id", itemId);

        if (updateError) {
          console.warn(
            `Failed to update each_grams for item ${itemId}:`,
            updateError.message
          );
          // エラーが発生しても計算は続行（itemsMapの更新は行う）
        }

        // itemsMapも更新（次の再帰呼び出しで使用される）
        itemsMap.set(itemId, { ...item, each_grams: eachGrams });
        // item変数も更新（この関数内で使用される）
        item = { ...item, each_grams: eachGrams };
      }

      // コスト計算用: 出来上がりの総重量（each_grams × Yield Amount）
      yieldGrams = eachGrams * yieldAmount;
    } else {
      // Yieldが"g"または"kg"の場合（質量単位）
      const multiplier = MASS_UNIT_CONVERSIONS[item.proceed_yield_unit];
      if (!multiplier) {
        throw new Error(
          `Invalid yield unit: ${item.proceed_yield_unit} for item ${itemId}`
        );
      }
      yieldGrams = item.proceed_yield_amount * multiplier;
    }

    if (yieldGrams === 0) {
      throw new Error(`Prepped item ${itemId} has zero yield`);
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

        // 数量をグラムに変換（保存された値があれば再利用）（問題6-2の修正）
        let grams = ingredientGramsMap.get(line.id);
        if (grams === undefined) {
          // 子アイテムがitemsMapに存在することを保証（問題5の修正）
          await ensureItemInMap(line.child_item_id);

          grams = convertToGrams(
            line.unit,
            line.quantity,
            line.child_item_id,
            itemsMap,
            baseItemsMap,
            vendorProductsMap
          );
        }

        // 子アイテムのitem_kindを確認
        await ensureItemInMap(line.child_item_id);
        const childItem = itemsMap.get(line.child_item_id);
        if (!childItem) {
          throw new Error(`Child item ${line.child_item_id} not found`);
        }

        // 子アイテムがrawの場合、specific_childを渡す
        // preppedの場合はnullを渡す（vendor_productは関係ない）
        const specificVendorProductId =
          childItem.item_kind === "raw" ? line.specific_child || null : null;

        // 子アイテムのコストを再帰的に取得
        const childCostPerGram = await getCost(
          line.child_item_id,
          visited,
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRoles,
          specificVendorProductId
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

    // キャッシュに保存（Prepped Itemの場合、itemIdのみ）
    const cacheKey = getCacheKey(itemId, "prepped", null);
    costCache.set(cacheKey, costPerGram);
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
  // 計算開始時に全てのキャッシュをクリア（問題1、2、3、4の解決）
  // これにより、常に最新のデータで計算され、古いキャッシュによる問題を回避
  costCache.clear();

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
  // 計算終了時のクリアは削除
  // 理由: 計算開始時にクリアするため、不要
  // 次の計算開始時に自動的にクリアされる
}

/**
 * 複数アイテムのコストを一度に計算（最適化版）
 * データを一度だけ取得し、キャッシュを一度だけクリアして複数アイテムを計算
 * @param itemIds - コストを計算するアイテムIDの配列
 * @returns アイテムIDをキー、コスト（1グラムあたり）を値とするMap
 */
export async function calculateCosts(
  itemIds: string[]
): Promise<Map<string, number>> {
  // 計算開始時に全てのキャッシュを一度だけクリア
  costCache.clear();

  // データを一度だけ取得
  const baseItemsMap = await getBaseItemsMap();
  const itemsMap = await getItemsMap();
  const vendorProductsMap = await getVendorProductsMap();
  const laborRoles = await getLaborRolesMap();

  // 結果を保存するMap
  const results = new Map<string, number>();

  // 各アイテムのコストを順次計算（同じデータとキャッシュを使用）
  for (const itemId of itemIds) {
    try {
      const costPerGram = await getCost(
        itemId,
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRoles
      );
      results.set(itemId, costPerGram);
    } catch (error) {
      // エラーが発生したアイテムはスキップ（エラーログを出力）
      console.error(`Failed to calculate cost for item ${itemId}:`, error);
      // エラーが発生したアイテムは結果に含めない
    }
  }

  return results;
}
