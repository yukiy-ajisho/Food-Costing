-- =========================================================
-- Migration: Update base_items unique constraint to include user_id
-- =========================================================
-- This migration changes the unique constraint on base_items.name
-- to include user_id, allowing different users to have items with the same name

-- =========================================================
-- 1) 既存の一意制約とインデックスを削除
-- =========================================================
-- 古い制約名（raw_items時代のもの）
ALTER TABLE base_items DROP CONSTRAINT IF EXISTS raw_items_name_key;
ALTER TABLE base_items DROP CONSTRAINT IF EXISTS base_items_name_key;

-- 古いインデックス名
DROP INDEX IF EXISTS idx_base_items_name_unique_active;

-- 新しいインデックス名（既に作成されている場合に備えて）
DROP INDEX IF EXISTS idx_base_items_name_user_id_unique_active;

-- その他の可能性のある制約名を確認して削除
-- 注意: 実際のデータベースで確認が必要な場合は、以下を実行してください：
-- SELECT conname FROM pg_constraint WHERE conrelid = 'base_items'::regclass AND contype = 'u';

-- =========================================================
-- 2) (name, user_id)の複合一意制約を追加（deprecated IS NULLの条件付き）
-- =========================================================
CREATE UNIQUE INDEX idx_base_items_name_user_id_unique_active 
  ON base_items (name, user_id) 
  WHERE deprecated IS NULL;

-- =========================================================
-- 完了
-- =========================================================
-- これにより、同じユーザー内では同じ名前のアイテムは1つだけ許可され、
-- 異なるユーザー間では同じ名前のアイテムを登録できるようになります

