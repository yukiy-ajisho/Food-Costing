import { supabase } from "../config/supabase";
import {
  Item,
  BaseItem,
  VendorProduct,
  RecipeLine,
  Vendor,
} from "../types/database";

/**
 * Deprecation Service
 * 削除の代わりに論理削除（deprecated）を実装
 */

/**
 * Base Itemをdeprecatedにする
 * 条件: アクティブなvendor_productsが0個の場合のみ
 */
export async function deprecateBaseItem(
  baseItemId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // アクティブなvendor_productsがあるかチェック
    const { data: activeVendorProducts, error: vpError } = await supabase
      .from("vendor_products")
      .select("id")
      .eq("base_item_id", baseItemId)
      .eq("user_id", userId)
      .is("deprecated", null);

    if (vpError) {
      return { success: false, error: vpError.message };
    }

    if (activeVendorProducts && activeVendorProducts.length > 0) {
      return {
        success: false,
        error: `Cannot deprecate base item. ${activeVendorProducts.length} active vendor product(s) still exist.`,
      };
    }

    // Base Itemをdeprecatedにする
    const now = new Date().toISOString();
    const { error: baseItemError } = await supabase
      .from("base_items")
      .update({ deprecated: now })
      .eq("id", baseItemId)
      .eq("user_id", userId);

    if (baseItemError) {
      return { success: false, error: baseItemError.message };
    }

    // 同じbase_item_idを持つraw itemsを自動的にdeprecatedにする（direct）
    const { error: itemsError } = await supabase
      .from("items")
      .update({ deprecated: now, deprecation_reason: "direct" })
      .eq("base_item_id", baseItemId)
      .eq("item_kind", "raw")
      .eq("user_id", userId)
      .is("deprecated", null);

    if (itemsError) {
      return { success: false, error: itemsError.message };
    }

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Vendor Productをdeprecatedにする
 */
export async function deprecateVendorProduct(
  vendorProductId: string,
  userId: string
): Promise<{ success: boolean; error?: string; affectedItems?: string[] }> {
  try {
    const now = new Date().toISOString();

    // Vendor Productを取得
    const { data: vendorProduct, error: vpError } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("id", vendorProductId)
      .eq("user_id", userId)
      .single();

    if (vpError || !vendorProduct) {
      return { success: false, error: "Vendor product not found" };
    }

    // Vendor Productをdeprecatedにする
    const { error: updateError } = await supabase
      .from("vendor_products")
      .update({ deprecated: now })
      .eq("id", vendorProductId)
      .eq("user_id", userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // このvendor_productを使っているrecipe_linesを探す
    const { data: recipeLines, error: rlError } = await supabase
      .from("recipe_lines")
      .select("*, items!recipe_lines_parent_item_id_fkey(*)")
      .eq("line_type", "ingredient")
      .eq("specific_child", vendorProductId)
      .eq("user_id", userId);

    console.log(
      `[DEPRECATE VP] Vendor Product ${vendorProductId} deprecated. Found ${
        recipeLines?.length || 0
      } recipe lines using it as specific_child.`
    );

    if (rlError) {
      return { success: false, error: rlError.message };
    }

    const affectedItemIds = new Set<string>();

    if (recipeLines && recipeLines.length > 0) {
      // それぞれの親itemをdeprecatedにする
      for (const line of recipeLines) {
        const parentItemId = line.parent_item_id;
        affectedItemIds.add(parentItemId);

        console.log(
          `[DEPRECATE VP] Deprecating parent item ${parentItemId} due to specific vendor product deprecation`
        );

        // まず親item自体をindirectでdeprecate
        const { error: parentUpdateError } = await supabase
          .from("items")
          .update({ deprecated: now, deprecation_reason: "indirect" })
          .eq("id", parentItemId)
          .eq("user_id", userId);

        if (parentUpdateError) {
          console.error(
            `[DEPRECATE VP] Failed to deprecate parent item ${parentItemId}:`,
            parentUpdateError
          );
          continue;
        }

        // その親のさらに親も連鎖的にdeprecate
        await deprecateItemCascade(parentItemId, now, userId);
      }
    }

    // specific_child = "lowest"のケースもチェック
    // このvendor_productのbase_item_idを使っているraw itemsを探す
    const { data: rawItems, error: rawError } = await supabase
      .from("items")
      .select("*")
      .eq("item_kind", "raw")
      .eq("base_item_id", vendorProduct.base_item_id)
      .eq("user_id", userId)
      .is("deprecated", null);

    if (rawError) {
      return { success: false, error: rawError.message };
    }

    if (rawItems && rawItems.length > 0) {
      for (const rawItem of rawItems) {
        // このraw itemを"lowest"で使っているrecipe_linesを探す
        const { data: lowestLines, error: lowestError } = await supabase
          .from("recipe_lines")
          .select("*")
          .eq("line_type", "ingredient")
          .eq("child_item_id", rawItem.id)
          .eq("specific_child", "lowest")
          .eq("user_id", userId);

        if (lowestError) continue;

        if (lowestLines && lowestLines.length > 0) {
          // 他のアクティブなvendor_productsがあるかチェック
          const { data: otherVPs, error: otherError } = await supabase
            .from("vendor_products")
            .select("*")
            .eq("base_item_id", vendorProduct.base_item_id)
            .eq("user_id", userId)
            .is("deprecated", null);

          if (otherError) continue;

          if (!otherVPs || otherVPs.length === 0) {
            // 代替がない場合、親itemsをdeprecatedにする
            console.log(
              `[DEPRECATE VP] No alternative vendor products. Deprecating parent items using raw item ${rawItem.id} with lowest.`
            );

            for (const line of lowestLines) {
              affectedItemIds.add(line.parent_item_id);

              // まず親item自体をindirectでdeprecate
              const { error: parentUpdateError } = await supabase
                .from("items")
                .update({ deprecated: now, deprecation_reason: "indirect" })
                .eq("id", line.parent_item_id)
                .eq("user_id", userId);

              if (parentUpdateError) {
                console.error(
                  `[DEPRECATE VP] Failed to deprecate parent item ${line.parent_item_id}:`,
                  parentUpdateError
                );
                continue;
              }

              // その親のさらに親も連鎖的にdeprecate
              await deprecateItemCascade(line.parent_item_id, now, userId);
            }
          } else {
            // 代替がある場合、最安値を探して切り替え、last_changeを記録
            await switchToLowestVendorProduct(
              lowestLines,
              vendorProduct,
              otherVPs,
              vendorProductId,
              userId
            );
          }
        }
      }
    }

    return {
      success: true,
      affectedItems: Array.from(affectedItemIds),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Prepped Itemをdeprecatedにする
 */
export async function deprecatePreppedItem(
  itemId: string,
  userId: string
): Promise<{ success: boolean; error?: string; affectedItems?: string[] }> {
  try {
    // Itemを取得
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", userId)
      .single();

    if (itemError || !item) {
      return { success: false, error: "Item not found" };
    }

    if (item.item_kind !== "prepped") {
      return { success: false, error: "Only prepped items can be deprecated" };
    }

    const now = new Date().toISOString();

    // 先に親itemsを再帰的にdeprecatedにする（この時点ではまだItem自体はactive）
    const affectedItemIds = await deprecateItemCascade(itemId, now, userId);

    // その後、Itemをdeprecatedにする（direct - ユーザーが明示的にdeprecate）
    // 既にindirectでdeprecatedされている場合でも、directに上書き
    const { error: updateError } = await supabase
      .from("items")
      .update({ deprecated: now, deprecation_reason: "direct" })
      .eq("id", itemId)
      .eq("user_id", userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return {
      success: true,
      affectedItems: Array.from(affectedItemIds),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Itemを再帰的にdeprecatedにする（親を辿る）
 * 効率化: すでにdeprecatedされている親は辿らない
 */
async function deprecateItemCascade(
  itemId: string,
  deprecatedTime: string,
  userId: string,
  visited: Set<string> = new Set()
): Promise<Set<string>> {
  const affectedItems = new Set<string>();

  // 循環参照防止と効率化
  if (visited.has(itemId)) {
    return affectedItems;
  }
  visited.add(itemId);

  // このitemを材料として使っている親itemsを探す
  const { data: parentLines, error: plError } = await supabase
    .from("recipe_lines")
    .select("parent_item_id")
    .eq("line_type", "ingredient")
    .eq("child_item_id", itemId)
    .eq("user_id", userId);

  if (plError || !parentLines) {
    return affectedItems;
  }

  // 親itemsをdeprecatedにする
  for (const line of parentLines) {
    const parentId = line.parent_item_id;

    // 親itemを取得
    const { data: parentItem, error: parentError } = await supabase
      .from("items")
      .select("*")
      .eq("id", parentId)
      .eq("user_id", userId)
      .single();

    if (parentError || !parentItem) continue;

    // すでにdeprecatedされている場合はスキップ
    if (parentItem.deprecated) continue;

    // 親itemをdeprecatedにする（indirect）
    const { error: updateError } = await supabase
      .from("items")
      .update({ deprecated: deprecatedTime, deprecation_reason: "indirect" })
      .eq("id", parentId)
      .eq("user_id", userId);

    if (!updateError) {
      affectedItems.add(parentId);

      // 再帰的に親の親も処理
      const nestedAffected = await deprecateItemCascade(
        parentId,
        deprecatedTime,
        userId,
        visited
      );
      nestedAffected.forEach((id) => affectedItems.add(id));
    }
  }

  return affectedItems;
}

/**
 * "lowest"を使っているrecipe_linesを最安のvendor_productに切り替え
 */
async function switchToLowestVendorProduct(
  recipeLines: RecipeLine[],
  deprecatedVendorProduct: VendorProduct,
  activeVendorProducts: VendorProduct[],
  deprecatedVpId: string,
  userId: string
): Promise<void> {
  try {
    // 最安のvendor_productを探す（コスト計算ロジックと同じ）
    // 簡易的にpurchase_cost / purchase_quantityで比較
    let lowestVP = activeVendorProducts[0];
    let lowestCostPerUnit = lowestVP.purchase_cost / lowestVP.purchase_quantity;

    for (const vp of activeVendorProducts) {
      const costPerUnit = vp.purchase_cost / vp.purchase_quantity;
      if (costPerUnit < lowestCostPerUnit) {
        lowestVP = vp;
        lowestCostPerUnit = costPerUnit;
      }
    }

    // Vendorの名前を取得
    const { data: deprecatedVendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", deprecatedVendorProduct.vendor_id)
      .eq("user_id", userId)
      .single();

    const { data: newVendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", lowestVP.vendor_id)
      .eq("user_id", userId)
      .single();

    // Format: "Vendor A's Product Name" or just "Vendor A" if no product name
    const deprecatedProductName = deprecatedVendorProduct.product_name
      ? `${deprecatedVendor?.name || "Unknown"}'s ${
          deprecatedVendorProduct.product_name
        }`
      : deprecatedVendor?.name || "Unknown";

    const newProductName = lowestVP.product_name
      ? `${newVendor?.name || "Unknown"}'s ${lowestVP.product_name}`
      : newVendor?.name || "Unknown";

    // 各recipe_lineのlast_changeを更新
    for (const line of recipeLines) {
      const existingChange = line.last_change || "";
      const newChange = existingChange
        ? `${existingChange} → ${newProductName}`
        : `${deprecatedProductName} → ${newProductName}`;

      await supabase
        .from("recipe_lines")
        .update({ last_change: newChange })
        .eq("id", line.id)
        .eq("user_id", userId);
    }
  } catch (error) {
    console.error("Failed to switch to lowest vendor product:", error);
  }
}

/**
 * Itemをdeprecatedから復活させる（undeprecate）
 */
export async function undeprecateItem(
  itemId: string,
  userId: string
): Promise<{ success: boolean; error?: string; undeprecatedItems?: string[] }> {
  try {
    // Itemを取得
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", userId)
      .single();

    if (itemError || !item) {
      return { success: false, error: "Item not found" };
    }

    // Raw itemの場合、base_itemがアクティブでvendor_productsが存在するかチェック
    if (item.item_kind === "raw") {
      if (!item.base_item_id) {
        return { success: false, error: "Raw item has no base_item_id" };
      }

      // Base Itemをチェック
      const { data: baseItem, error: baseError } = await supabase
        .from("base_items")
        .select("*")
        .eq("id", item.base_item_id)
        .eq("user_id", userId)
        .single();

      if (baseError || !baseItem || baseItem.deprecated) {
        return {
          success: false,
          error: "Cannot undeprecate raw item: base item is deprecated",
        };
      }

      // アクティブなvendor_productsをチェック
      const { data: activeVPs, error: vpError } = await supabase
        .from("vendor_products")
        .select("*")
        .eq("base_item_id", item.base_item_id)
        .eq("user_id", userId)
        .is("deprecated", null);

      if (vpError || !activeVPs || activeVPs.length === 0) {
        return {
          success: false,
          error: "Cannot undeprecate raw item: no active vendor products",
        };
      }
    }

    // Prepped itemの場合、すべての材料がアクティブかチェック
    if (item.item_kind === "prepped") {
      const allIngredientsActive = await checkAllIngredientsActive(
        itemId,
        userId
      );
      if (!allIngredientsActive) {
        return {
          success: false,
          error:
            "Cannot undeprecate prepped item: not all ingredients are active",
        };
      }
    }

    // Itemをundeprecate
    const { error } = await supabase
      .from("items")
      .update({ deprecated: null, deprecation_reason: null })
      .eq("id", itemId)
      .eq("user_id", userId);

    if (error) {
      return { success: false, error: error.message };
    }

    const undeprecatedItems = new Set<string>();
    undeprecatedItems.add(itemId);

    // このitemを材料として使っている親itemsを再帰的にundeprecate
    const { data: recipeLines, error: rlError } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("line_type", "ingredient")
      .eq("child_item_id", itemId)
      .eq("user_id", userId);

    if (!rlError && recipeLines) {
      for (const line of recipeLines) {
        const result = await recursivelyUndeprecateParents(
          line.parent_item_id,
          userId,
          new Set()
        );
        result.forEach((id) => undeprecatedItems.add(id));
      }
    }

    return {
      success: true,
      undeprecatedItems: Array.from(undeprecatedItems),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Base Itemをdeprecatedから復活させる
 */
export async function undeprecateBaseItem(
  baseItemId: string,
  userId: string
): Promise<{ success: boolean; error?: string; undeprecatedItems?: string[] }> {
  try {
    // アクティブなvendor_productsが存在するかチェック
    const { data: activeVPs, error: vpError } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("base_item_id", baseItemId)
      .eq("user_id", userId)
      .is("deprecated", null);

    if (vpError) {
      return { success: false, error: vpError.message };
    }

    // アクティブなvendor_productsがない場合はundeprecateできない
    if (!activeVPs || activeVPs.length === 0) {
      return {
        success: false,
        error: "Cannot undeprecate base item without active vendor products",
      };
    }

    // Base Itemをundeprecate
    const { error } = await supabase
      .from("base_items")
      .update({ deprecated: null })
      .eq("id", baseItemId)
      .eq("user_id", userId);

    if (error) {
      return { success: false, error: error.message };
    }

    const undeprecatedItems = new Set<string>();

    // 対応するraw itemsをundeprecate
    const { data: rawItems, error: rawError } = await supabase
      .from("items")
      .select("*")
      .eq("item_kind", "raw")
      .eq("base_item_id", baseItemId)
      .eq("user_id", userId)
      .not("deprecated", "is", null);

    if (!rawError && rawItems) {
      for (const rawItem of rawItems) {
        const { error: itemUpdateError } = await supabase
          .from("items")
          .update({ deprecated: null, deprecation_reason: null })
          .eq("id", rawItem.id)
          .eq("user_id", userId);

        if (!itemUpdateError) {
          undeprecatedItems.add(rawItem.id);
          console.log(
            `[AUTO UNDEPRECATE] Raw item ${rawItem.name} (${rawItem.id}) undeprecated`
          );

          // このraw itemを材料として使っているprepped itemsをundeprecate
          const { data: recipeLines, error: rlError } = await supabase
            .from("recipe_lines")
            .select("*")
            .eq("line_type", "ingredient")
            .eq("child_item_id", rawItem.id)
            .eq("user_id", userId);

          if (!rlError && recipeLines) {
            for (const line of recipeLines) {
              const result = await recursivelyUndeprecateParents(
                line.parent_item_id,
                userId,
                new Set()
              );
              result.forEach((id) => undeprecatedItems.add(id));
            }
          }
        }
      }
    }

    return {
      success: true,
      undeprecatedItems: Array.from(undeprecatedItems),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Vendor Productをdeprecatedから復活させる
 */
export async function undeprecateVendorProduct(
  vendorProductId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from("vendor_products")
      .update({ deprecated: null })
      .eq("id", vendorProductId)
      .eq("user_id", userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Prepped Itemのすべての材料がアクティブかチェック
 */
async function checkAllIngredientsActive(
  itemId: string,
  userId: string
): Promise<boolean> {
  try {
    // レシピラインを取得（ingredientのみ）
    const { data: recipeLines, error: rlError } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", itemId)
      .eq("line_type", "ingredient")
      .eq("user_id", userId);

    if (rlError || !recipeLines) {
      return false;
    }

    // 材料がない場合はtrue（材料がないitemはdeprecateされない）
    if (recipeLines.length === 0) {
      return true;
    }

    // 各材料をチェック
    for (const line of recipeLines) {
      if (!line.child_item_id) continue;

      // 子アイテムを取得
      const { data: childItem, error: itemError } = await supabase
        .from("items")
        .select("*")
        .eq("id", line.child_item_id)
        .eq("user_id", userId)
        .single();

      if (itemError || !childItem) {
        return false;
      }

      // 子アイテムがdeprecatedされている場合はfalse
      if (childItem.deprecated) {
        return false;
      }

      // Raw Itemの場合、vendor_productをチェック
      if (childItem.item_kind === "raw") {
        if (!childItem.base_item_id) {
          return false;
        }

        // アクティブなvendor_productsを取得
        const { data: activeVPs, error: vpError } = await supabase
          .from("vendor_products")
          .select("*")
          .eq("base_item_id", childItem.base_item_id)
          .eq("user_id", userId)
          .is("deprecated", null);

        if (vpError || !activeVPs || activeVPs.length === 0) {
          return false;
        }

        // specific_childの場合、そのvendor_productがアクティブかチェック
        if (
          line.specific_child &&
          line.specific_child !== "lowest" &&
          line.specific_child !== null
        ) {
          const isActive = activeVPs.some(
            (vp) => vp.id === line.specific_child
          );
          if (!isActive) {
            return false;
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Error checking ingredients:", error);
    return false;
  }
}

/**
 * Prepped Itemを再帰的にundeprecate（親を辿る）
 */
async function recursivelyUndeprecateParents(
  itemId: string,
  userId: string,
  visited: Set<string> = new Set()
): Promise<Set<string>> {
  const undeprecatedItems = new Set<string>();

  // 循環参照防止
  if (visited.has(itemId)) {
    return undeprecatedItems;
  }
  visited.add(itemId);

  // Itemを取得
  const { data: item, error: itemError } = await supabase
    .from("items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();

  if (itemError || !item) {
    return undeprecatedItems;
  }

  // すでにアクティブな場合はスキップ
  if (!item.deprecated) {
    return undeprecatedItems;
  }

  // すべての材料がアクティブかチェック
  const allIngredientsActive = await checkAllIngredientsActive(itemId, userId);

  if (allIngredientsActive) {
    // Itemをundeprecate
    const { error: updateError } = await supabase
      .from("items")
      .update({ deprecated: null, deprecation_reason: null })
      .eq("id", itemId)
      .eq("user_id", userId);

    if (!updateError) {
      undeprecatedItems.add(itemId);
      console.log(
        `[AUTO UNDEPRECATE] Item ${item.name} (${itemId}) undeprecated`
      );

      // このitemを材料として使っている親itemsを探す
      const { data: parentLines, error: plError } = await supabase
        .from("recipe_lines")
        .select("parent_item_id")
        .eq("line_type", "ingredient")
        .eq("child_item_id", itemId)
        .eq("user_id", userId);

      if (!plError && parentLines) {
        for (const line of parentLines) {
          const nestedUndeprecated = await recursivelyUndeprecateParents(
            line.parent_item_id,
            userId,
            visited
          );
          nestedUndeprecated.forEach((id) => undeprecatedItems.add(id));
        }
      }
    }
  }

  return undeprecatedItems;
}

/**
 * Vendor Product作成後、影響を受けるアイテムを自動undeprecate
 */
export async function autoUndeprecateAfterVendorProductCreation(
  vendorProductId: string,
  userId: string
): Promise<{ success: boolean; undeprecatedItems?: string[] }> {
  try {
    // Vendor Productを取得
    const { data: vendorProduct, error: vpError } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("id", vendorProductId)
      .eq("user_id", userId)
      .single();

    if (vpError || !vendorProduct) {
      return { success: false };
    }

    const undeprecatedItems = new Set<string>();

    // このbase_item_idを持つraw itemsを探す
    const { data: rawItems, error: rawError } = await supabase
      .from("items")
      .select("*")
      .eq("item_kind", "raw")
      .eq("base_item_id", vendorProduct.base_item_id)
      .eq("user_id", userId);

    if (rawError || !rawItems) {
      return { success: false };
    }

    // 各raw itemを材料として使っているprepped itemsを探す
    for (const rawItem of rawItems) {
      const { data: recipeLines, error: rlError } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("line_type", "ingredient")
        .eq("child_item_id", rawItem.id)
        .eq("user_id", userId);

      if (rlError || !recipeLines) continue;

      // 各recipe lineの親itemをチェック
      for (const line of recipeLines) {
        // lowestまたはこのvendor_productを指定している場合
        if (
          line.specific_child === "lowest" ||
          line.specific_child === null ||
          line.specific_child === vendorProductId
        ) {
          const result = await recursivelyUndeprecateParents(
            line.parent_item_id,
            userId,
            new Set()
          );
          result.forEach((id) => undeprecatedItems.add(id));
        }
      }
    }

    return {
      success: true,
      undeprecatedItems: Array.from(undeprecatedItems),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "Error in autoUndeprecateAfterVendorProductCreation:",
      message
    );
    return { success: false };
  }
}

/**
 * Recipe Line更新後、影響を受けるアイテムを自動undeprecate
 */
export async function autoUndeprecateAfterRecipeLineUpdate(
  parentItemId: string,
  userId: string
): Promise<{ success: boolean; undeprecatedItems?: string[] }> {
  try {
    const undeprecatedItems = await recursivelyUndeprecateParents(
      parentItemId,
      userId,
      new Set()
    );

    return {
      success: true,
      undeprecatedItems: Array.from(undeprecatedItems),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in autoUndeprecateAfterRecipeLineUpdate:", message);
    return { success: false };
  }
}
