-- =========================================================
-- Migration: Fix RLS policy with separate policies for each role
-- =========================================================
-- Supabase might not support multiple roles in a single policy
-- So we create separate policies for public and postgres

-- =========================================================
-- 1) 既存のINSERTポリシーをすべて削除（単数形・複数形の両方に対応）
-- =========================================================
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_setting" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role can insert proceed_validation_setting" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Postgres role can insert proceed_validation_settings" ON proceed_validation_settings;

-- =========================================================
-- 2) publicロール用のポリシーを作成
-- =========================================================
CREATE POLICY "Service role can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public
  WITH CHECK (true);

-- =========================================================
-- 3) postgresロール用のポリシーを作成
-- =========================================================
CREATE POLICY "Postgres role can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO postgres
  WITH CHECK (true);

-- =========================================================
-- 4) 確認: 作成したポリシーのrolesを確認
-- =========================================================
SELECT
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'proceed_validation_settings'
  AND cmd = 'INSERT'
ORDER BY policyname;

-- =========================================================
-- 完了
-- =========================================================
-- 上記のSELECTクエリで、2つのポリシーが作成され、
-- それぞれ'public'と'postgres'のrolesを持っていることを確認してください

