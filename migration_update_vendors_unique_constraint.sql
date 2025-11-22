-- =========================================================
-- Migration: Update vendors unique constraint to include user_id
-- =========================================================
-- This migration changes the unique constraint on vendors.name
-- to include user_id, allowing different users to have vendors with the same name

-- =========================================================
-- 1) 既存の一意制約とインデックスを削除
-- =========================================================
-- 古い制約名
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_name_key;

-- 古いインデックス名（存在する場合）
DROP INDEX IF EXISTS idx_vendors_name_unique;

-- 新しいインデックス名（既に作成されている場合に備えて）
DROP INDEX IF EXISTS idx_vendors_name_user_id_unique;

-- その他の可能性のある制約名を確認して削除
-- 注意: 実際のデータベースで確認が必要な場合は、以下を実行してください：
-- SELECT conname FROM pg_constraint WHERE conrelid = 'vendors'::regclass AND contype = 'u';

-- =========================================================
-- 2) (name, user_id)の複合一意制約を追加
-- =========================================================
CREATE UNIQUE INDEX idx_vendors_name_user_id_unique 
  ON vendors (name, user_id);

-- =========================================================
-- 完了
-- =========================================================
-- これにより、同じユーザー内では同じ名前のベンダーは1つだけ許可され、
-- 異なるユーザー間では同じ名前のベンダーを登録できるようになります

