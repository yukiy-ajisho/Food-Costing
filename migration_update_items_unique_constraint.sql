-- =========================================================
-- Migration: Update items unique constraint to include user_id
-- =========================================================
-- This migration changes the unique constraint on items.name
-- to include user_id, allowing different users to have items with the same name

-- =========================================================
-- 1) 既存の一意制約インデックスを削除
-- =========================================================
-- 古いインデックス名
DROP INDEX IF EXISTS idx_items_name_unique_active;

-- 新しいインデックス名（既に作成されている場合に備えて）
DROP INDEX IF EXISTS idx_items_name_user_id_unique_active;

-- =========================================================
-- 2) (name, user_id)の複合一意制約を追加（deprecated IS NULLの条件付き）
-- =========================================================
CREATE UNIQUE INDEX idx_items_name_user_id_unique_active 
  ON items (name, user_id) 
  WHERE deprecated IS NULL;

-- =========================================================
-- 完了
-- =========================================================
-- これにより、同じユーザー内では同じ名前のアイテムは1つだけ許可され、
-- 異なるユーザー間では同じ名前のアイテムを登録できるようになります

