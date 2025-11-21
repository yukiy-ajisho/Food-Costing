-- =========================================================
-- Migration: Add specific_child column to recipe_lines table
-- =========================================================

-- recipe_linesテーブルにspecific_childカラムを追加
-- NULL許可（prepped itemの場合はNULL、raw itemの場合は"lowest"またはvendor_product.id）
ALTER TABLE recipe_lines
  ADD COLUMN IF NOT EXISTS specific_child text;

-- 既存のレコードを更新
-- child_item_idが指すitemのitem_kindが"raw"の場合: "lowest"
-- child_item_idが指すitemのitem_kindが"prepped"の場合: null
UPDATE recipe_lines
SET specific_child = CASE
  WHEN child_item_id IS NOT NULL THEN
    CASE
      WHEN EXISTS (
        SELECT 1 FROM items
        WHERE items.id = recipe_lines.child_item_id
        AND items.item_kind = 'raw'
      ) THEN 'lowest'
      ELSE NULL
    END
  ELSE NULL
END
WHERE specific_child IS NULL;

-- =========================================================
-- 完了
-- =========================================================

