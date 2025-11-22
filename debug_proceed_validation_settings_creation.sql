-- =========================================================
-- Debug: Check why proceed_validation_settings is not being created
-- =========================================================

-- =========================================================
-- 1) handle_new_user()関数の定義を確認
-- =========================================================
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- =========================================================
-- 2) トリガーの確認
-- =========================================================
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created'
   OR event_object_table = 'users'
ORDER BY event_object_table, trigger_name;

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
-- 5) RLSが有効かどうか確認
-- =========================================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'proceed_validation_settings';

-- =========================================================
-- 6) 最新のauth.usersとpublic.usersを比較
-- =========================================================
SELECT 
  'auth.users' as source,
  COUNT(*) as count,
  MAX(created_at) as latest_created
FROM auth.users
UNION ALL
SELECT 
  'public.users' as source,
  COUNT(*) as count,
  MAX(created_at) as latest_created
FROM public.users
UNION ALL
SELECT 
  'proceed_validation_settings' as source,
  COUNT(*) as count,
  MAX(created_at) as latest_created
FROM proceed_validation_settings;

-- =========================================================
-- 7) 最新のauth.usersで、public.usersに存在しないものを確認
-- =========================================================
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  pu.id IS NOT NULL as has_public_user,
  pvs.id IS NOT NULL as has_proceed_settings
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
LEFT JOIN proceed_validation_settings pvs ON au.id = pvs.user_id
ORDER BY au.created_at DESC
LIMIT 10;

