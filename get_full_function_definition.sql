-- =========================================================
-- Get the FULL function definition
-- =========================================================

-- 完全な関数定義を取得（改行を含む）
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- 関数定義を文字列として検索して、重要な部分を確認
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%INSERT INTO public.users%' THEN 'Has INSERT INTO public.users'
    ELSE 'Missing INSERT INTO public.users'
  END as check_public_users_insert,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%INSERT INTO proceed_validation_settings%' THEN 'Has INSERT INTO proceed_validation_settings'
    ELSE 'Missing INSERT INTO proceed_validation_settings'
  END as check_proceed_insert,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%validation_mode%' THEN 'Has validation_mode'
    ELSE 'Missing validation_mode'
  END as check_validation_mode,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%EXCEPTION WHEN OTHERS%' THEN 'Has exception handling'
    ELSE 'Missing exception handling'
  END as check_exception_handling
FROM pg_proc
WHERE proname = 'handle_new_user';

