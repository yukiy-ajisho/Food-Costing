-- =========================================================
-- Migration: Fix RLS policy to include postgres role
-- =========================================================
-- The issue is that the RLS policy "Service role and postgres can insert proceed_validation_setting"
-- has roles: {public} but NOT {postgres}. Since SECURITY DEFINER functions run as postgres,
-- the INSERT is being blocked by RLS.

-- =========================================================
-- 1) 既存のポリシーを削除
-- =========================================================
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_setting" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;

-- =========================================================
-- 2) postgresロールも含む正しいポリシーを作成
-- =========================================================
CREATE POLICY "Service role and postgres can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public, postgres
  WITH CHECK (true);

-- =========================================================
-- 完了
-- =========================================================
-- これで、SECURITY DEFINER関数（postgresロールで実行）から
-- proceed_validation_settingsへのINSERTが許可されます

