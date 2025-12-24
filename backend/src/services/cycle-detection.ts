import { supabase } from "../config/supabase";
import { Item, RecipeLine } from "../types/database";

/**
 * 循環参照検出サービス
 * コスト計算を行わずに、依存関係の循環参照のみをチェック
 */

/**
 * 循環参照をチェック
 * @param itemId - チェックするアイテムID
 * @param visited - 訪問済みアイテムのセット（循環検出用）
 * @param itemsMap - Itemsのマップ（item_idをキーとして）
 * @param recipeLinesMap - Recipe Linesのマップ（parent_item_idをキーとして）
 * @param currentPath - 現在のパス（エラーメッセージ用）
 * @throws Error if cycle is detected
 */
export async function checkCycle(
  itemId: string,
  tenantId: string,
  visited: Set<string> = new Set(),
  itemsMap: Map<string, Item> = new Map(),
  recipeLinesMap: Map<string, RecipeLine[]> = new Map(),
  currentPath: string[] = []
): Promise<void> {
  // デバッグログ: チェック開始
  let item = itemsMap.get(itemId);
  const itemName = item?.name || itemId;
  const currentPathNames = currentPath.map((id) => {
    const pathItem = itemsMap.get(id);
    return pathItem?.name || id;
  });
  console.log(
    `[CYCLE DETECTION] Checking item: ${itemName} (${itemId}), Current path: [${currentPathNames.join(
      " → "
    )}]`
  );

  // 循環検出
  if (visited.has(itemId)) {
    const cyclePath = [...currentPath, itemId];
    // アイテム名を取得してパスを表示
    const pathNames = cyclePath.map((id) => {
      const pathItem = itemsMap.get(id);
      return pathItem?.name || id;
    });
    const pathString = pathNames.join(" → ");
    console.error(
      `[CYCLE DETECTION] ❌ CYCLE DETECTED! Item: ${itemName} (${itemId}), Cycle path: ${pathString}`
    );
    throw new Error(
      `Cycle detected in recipe dependency chain. Item "${itemName}" creates a circular dependency. Path: ${pathString}`
    );
  }

  // アイテムを取得（itemsMapから取得を試みる、存在しない場合のみデータベースから取得）
  if (!item) {
    const { data: fetchedItem, error: itemError } = await supabase
      .from("items")
      .select("*")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .single();

    if (itemError || !fetchedItem) {
      // アイテムが存在しない場合はスキップ（新規作成の場合など）
      console.log(`[CYCLE DETECTION] Item not found: ${itemId}, skipping...`);
      return;
    }
    item = fetchedItem;
    itemsMap.set(itemId, item);
  }

  // Raw Itemの場合は循環参照の可能性がない（材料を持たないため）
  if (item.item_kind === "raw") {
    console.log(
      `[CYCLE DETECTION] Item is raw: ${itemName} (${itemId}), no cycle possible, skipping...`
    );
    return;
  }

  // Prepped Itemの場合、レシピラインを取得
  let recipeLines = recipeLinesMap.get(itemId);
  if (!recipeLines) {
    const { data: fetchedLines, error: linesError } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("parent_item_id", itemId)
      .eq("line_type", "ingredient")
      .eq("tenant_id", tenantId);

    if (linesError) {
      // エラーが発生した場合はスキップ
      console.log(
        `[CYCLE DETECTION] Error fetching recipe lines for ${itemName} (${itemId}): ${linesError.message}, skipping...`
      );
      return;
    }
    recipeLines = fetchedLines || [];
    recipeLinesMap.set(itemId, recipeLines);
  }

  console.log(
    `[CYCLE DETECTION] Item ${itemName} (${itemId}) has ${recipeLines.length} ingredient lines`
  );

  // 訪問済みマーク
  visited.add(itemId);
  const newPath = [...currentPath, itemId];

  try {
    // 各レシピライン（材料）をチェック
    for (const line of recipeLines) {
      if (line.line_type !== "ingredient") continue;
      if (!line.child_item_id) continue;

      const childItem = itemsMap.get(line.child_item_id);
      const childItemName = childItem?.name || line.child_item_id;
      console.log(
        `[CYCLE DETECTION] Checking child item: ${childItemName} (${line.child_item_id}) of ${itemName} (${itemId})`
      );

      // 子アイテムの循環参照を再帰的にチェック
      await checkCycle(
        line.child_item_id,
        tenantId,
        visited,
        itemsMap,
        recipeLinesMap,
        newPath
      );
    }
    console.log(
      `[CYCLE DETECTION] ✅ No cycle detected for item: ${itemName} (${itemId})`
    );
  } finally {
    // 訪問済みマークを削除（他の経路での探索を許可）
    visited.delete(itemId);
  }
}

/**
 * 複数のアイテムの循環参照をチェック
 * @param itemIds - チェックするアイテムIDの配列
 * @param itemsMap - Itemsのマップ（オプション）
 * @param recipeLinesMap - Recipe Linesのマップ（オプション）
 * @throws Error if cycle is detected
 */
export async function checkCyclesForItems(
  itemIds: string[],
  tenantId: string,
  itemsMap: Map<string, Item> = new Map(),
  recipeLinesMap: Map<string, RecipeLine[]> = new Map()
): Promise<void> {
  // すべてのアイテムとレシピラインを事前に取得（パフォーマンス向上）
  if (itemsMap.size === 0) {
    const { data: allItems } = await supabase
      .from("items")
      .select("*")
      .eq("tenant_id", tenantId);
    allItems?.forEach((item) => itemsMap.set(item.id, item));
  }

  if (recipeLinesMap.size === 0) {
    const { data: allRecipeLines } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("line_type", "ingredient")
      .eq("tenant_id", tenantId);
    allRecipeLines?.forEach((line) => {
      const existing = recipeLinesMap.get(line.parent_item_id) || [];
      existing.push(line);
      recipeLinesMap.set(line.parent_item_id, existing);
    });
  }

  // 各アイテムの循環参照をチェック
  for (const itemId of itemIds) {
    await checkCycle(itemId, tenantId, new Set(), itemsMap, recipeLinesMap, []);
  }
}
