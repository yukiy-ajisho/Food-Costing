-- =========================================================
-- Check proceed_validation_settings setup
-- =========================================================
-- This script checks the current state of triggers, functions, and RLS policies
-- related to proceed_validation_settings

-- =========================================================
-- 1) トリガーの確認
-- =========================================================
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE trigger_name LIKE '%proceed_validation_settings%'
   OR trigger_name LIKE '%auth_user%'
   OR event_object_table = 'users'
ORDER BY event_object_table, trigger_name;

-- =========================================================
-- 2) 関数の確認
-- =========================================================
SELECT 
  routine_name,
  routine_type,
  security_type,
  routine_definition
FROM information_schema.routines
WHERE routine_name LIKE '%proceed_validation_settings%'
   OR routine_name = 'handle_new_user'
ORDER BY routine_name;

-- =========================================================
-- 3) 外部キー制約の確認
-- =========================================================
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'proceed_validation_settings'
  AND tc.constraint_type = 'FOREIGN KEY';

-- =========================================================
-- 4) RLSポリシーの確認
-- =========================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'proceed_validation_settings'
ORDER BY policyname;

-- =========================================================
-- 5) テーブルの存在確認
-- =========================================================
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_name = 'proceed_validation_settings'
   OR table_name = 'users';

-- =========================================================
-- 6) 最近のWARNINGログの確認（PostgreSQLログを確認する必要があります）
-- =========================================================
-- 注意: これはPostgreSQLのログファイルを直接確認する必要があります
-- Supabase DashboardのLogsセクションで確認してください

