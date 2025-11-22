-- =========================================================
-- Migration: Fix RLS policy to include postgres role (FINAL)
-- =========================================================
-- This migration ensures the RLS policy includes postgres role

-- =========================================================
-- 1) 既存のINSERTポリシーをすべて削除（すべてのバリエーションに対応）
-- =========================================================
-- ポリシー名のすべてのバリエーションを削除
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_setting" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role can insert proceed_validation_setting" ON proceed_validation_settings;

-- =========================================================
-- 2) postgresロールも含む正しいポリシーを作成
-- =========================================================
CREATE POLICY "Service role and postgres can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public, postgres
  WITH CHECK (true);

-- =========================================================
-- 3) 確認: 作成したポリシーのrolesを確認
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
-- 上記のSELECTクエリで、rolesに'{public, postgres}'が含まれていることを確認してください

