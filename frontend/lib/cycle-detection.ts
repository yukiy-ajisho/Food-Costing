import type { Item, RecipeLine } from "./api";

/**
 * 循環参照検出サービス（フロントエンド用）
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
export function checkCycle(
  itemId: string,
  visited: Set<string> = new Set(),
  itemsMap: Map<string, Item>,
  recipeLinesMap: Map<string, RecipeLine[]>,
  currentPath: string[] = []
): void {
  // 循環検出
  if (visited.has(itemId)) {
    const cyclePath = [...currentPath, itemId];
    // アイテム名を取得してパスを表示
    const item = itemsMap.get(itemId);
    const itemName = item?.name || itemId;
    const pathNames = cyclePath.map((id) => {
      const pathItem = itemsMap.get(id);
      return pathItem?.name || id;
    });
    const pathString = pathNames.join(" → ");
    throw new Error(
      `Cycle detected in recipe dependency chain. Item "${itemName}" creates a circular dependency. Path: ${pathString}`
    );
  }

  // アイテムを取得
  const item = itemsMap.get(itemId);
  if (!item) {
    // アイテムが存在しない場合はスキップ（新規作成の場合など）
    return;
  }

  // Raw Itemの場合は循環参照の可能性がない（材料を持たないため）
  if (item.item_kind === "raw") {
    return;
  }

  // Prepped Itemの場合、レシピラインを取得
  const recipeLines = recipeLinesMap.get(itemId) || [];

  // 訪問済みマーク
  visited.add(itemId);
  const newPath = [...currentPath, itemId];

  try {
    // 各レシピライン（材料）をチェック
    for (const line of recipeLines) {
      if (line.line_type !== "ingredient") continue;
      if (!line.child_item_id) continue;

      // 子アイテムの循環参照を再帰的にチェック
      checkCycle(
        line.child_item_id,
        visited,
        itemsMap,
        recipeLinesMap,
        newPath
      );
    }
  } finally {
    // 訪問済みマークを削除（他の経路での探索を許可）
    visited.delete(itemId);
  }
}

/**
 * 複数のアイテムの循環参照をチェック
 * @param itemIds - チェックするアイテムIDの配列
 * @param itemsMap - Itemsのマップ
 * @param recipeLinesMap - Recipe Linesのマップ
 * @throws Error if cycle is detected
 */
export function checkCyclesForItems(
  itemIds: string[],
  itemsMap: Map<string, Item>,
  recipeLinesMap: Map<string, RecipeLine[]>
): void {
  // 各アイテムの循環参照をチェック
  for (const itemId of itemIds) {
    checkCycle(itemId, new Set(), itemsMap, recipeLinesMap, []);
  }
}
