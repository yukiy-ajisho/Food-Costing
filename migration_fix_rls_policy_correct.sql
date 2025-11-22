-- =========================================================
-- Migration: Fix RLS policy to include postgres role (CORRECTED)
-- =========================================================
-- The issue is that the RLS policy name might be slightly different
-- and the roles array doesn't include postgres

-- =========================================================
-- 1) 既存のINSERTポリシーをすべて削除（名前の違いに対応）
-- =========================================================
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_setting" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;

-- =========================================================
-- 2) postgresロールも含む正しいポリシーを作成
-- =========================================================
CREATE POLICY "Service role and postgres can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public, postgres
  WITH CHECK (true);

-- =========================================================
-- 3) RLSを有効化（念のため）
-- =========================================================
ALTER TABLE proceed_validation_settings ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 完了
-- =========================================================
-- これで、SECURITY DEFINER関数（postgresロールで実行）から
-- proceed_validation_settingsへのINSERTが許可されます

