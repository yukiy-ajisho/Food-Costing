-- =========================================================
-- Check handle_new_user() function and trigger
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
   OR (event_object_table = 'users' AND trigger_name LIKE '%user%')
ORDER BY event_object_table, trigger_name;

-- =========================================================
-- 3) 関数の所有者と権限を確認
-- =========================================================
SELECT 
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner
FROM pg_proc p
WHERE p.proname = 'handle_new_user';

-- =========================================================
-- 4) 最新のauth.usersの作成日時と、対応するpublic.usersの作成日時を比較
-- =========================================================
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  pu.created_at as public_users_created_at,
  (pu.created_at - au.created_at) as time_diff,
  pvs.created_at as proceed_settings_created_at
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
LEFT JOIN proceed_validation_settings pvs ON au.id = pvs.user_id
ORDER BY au.created_at DESC
LIMIT 5;

