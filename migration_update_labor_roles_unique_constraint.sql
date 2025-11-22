-- =========================================================
-- Migration: Update labor_roles unique constraint to include user_id
-- =========================================================
-- This migration changes the unique constraint on labor_roles.name
-- to include user_id, allowing different users to have labor roles with the same name

-- =========================================================
-- 1) 既存の外部キー制約を削除（recipe_linesが依存しているため）
-- =========================================================
-- recipe_linesテーブルの外部キー制約を削除
-- 複数の可能性のある制約名を試す
ALTER TABLE recipe_lines DROP CONSTRAINT IF EXISTS fk_recipe_lines_labor_role;
ALTER TABLE recipe_lines DROP CONSTRAINT IF EXISTS recipe_lines_labor_role_fkey;
ALTER TABLE recipe_lines DROP CONSTRAINT IF EXISTS recipe_lines_labor_role_fk;

-- すべての外部キー制約を確認する場合（デバッグ用）
-- SELECT conname, conrelid::regclass, confrelid::regclass 
-- FROM pg_constraint 
-- WHERE contype = 'f' 
--   AND conrelid = 'recipe_lines'::regclass 
--   AND confrelid = 'labor_roles'::regclass;

-- =========================================================
-- 2) 既存の一意制約とインデックスを削除
-- =========================================================
-- 古い制約名
ALTER TABLE labor_roles DROP CONSTRAINT IF EXISTS labor_roles_name_key;

-- 古いインデックス名（存在する場合）
DROP INDEX IF EXISTS idx_labor_roles_name_unique;

-- 新しいインデックス名（既に作成されている場合に備えて）
DROP INDEX IF EXISTS idx_labor_roles_name_user_id_unique;

-- その他の可能性のある制約名を確認して削除
-- 注意: 実際のデータベースで確認が必要な場合は、以下を実行してください：
-- SELECT conname FROM pg_constraint WHERE conrelid = 'labor_roles'::regclass AND contype = 'u';

-- =========================================================
-- 3) (name, user_id)の複合一意制約を追加
-- =========================================================
CREATE UNIQUE INDEX idx_labor_roles_name_user_id_unique 
  ON labor_roles (name, user_id);

-- =========================================================
-- 4) 外部キー制約は再作成しない
-- =========================================================
-- 注意: recipe_lines.labor_roleはlabor_roles.nameを参照していますが、
-- 複合キー(name, user_id)を参照する外部キー制約は作成できません
-- （recipe_lines.labor_roleは単一カラムのため）。
-- アプリケーションレベルで整合性を保つ必要があります。
-- バックエンドのコードで、recipe_linesとlabor_rolesの両方でuser_idを
-- フィルタリングすることで、同じユーザーのデータのみを参照できます。

-- =========================================================
-- 完了
-- =========================================================
-- これにより、同じユーザー内では同じ名前の役職は1つだけ許可され、
-- 異なるユーザー間では同じ名前の役職を登録できるようになります

