-- =========================================================
-- Migration: Add allowed_actions column to resource_shares table
-- =========================================================
-- This migration adds the allowed_actions column to support
-- View only (read) and Editable (read + update) permissions
-- for Manager role when Admin shares resources.
--
-- =========================================================

BEGIN;

-- =========================================================
-- resource_sharesテーブルにallowed_actionsカラムを追加
-- =========================================================
ALTER TABLE resource_shares 
  ADD COLUMN IF NOT EXISTS allowed_actions text[] DEFAULT ARRAY['read'];

-- 既存のレコードに対してデフォルト値を設定（既に存在する場合はスキップ）
UPDATE resource_shares 
SET allowed_actions = ARRAY['read'] 
WHERE allowed_actions IS NULL;

-- allowed_actionsカラムをNOT NULLに設定
ALTER TABLE resource_shares 
  ALTER COLUMN allowed_actions SET NOT NULL;

-- インデックスは不要（配列カラムのインデックスは複雑なため）

COMMIT;

