-- =========================================================
-- Debug: Check why proceed_validation_settings is not created for new user
-- =========================================================

-- =========================================================
-- 1) 最新のユーザーを確認
-- =========================================================
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  pu.id IS NOT NULL as has_public_user,
  pu.created_at as public_users_created_at,
  pvs.id IS NOT NULL as has_proceed_settings,
  pvs.created_at as proceed_settings_created_at
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
LEFT JOIN proceed_validation_settings pvs ON au.id = pvs.user_id
ORDER BY au.created_at DESC
LIMIT 3;

-- =========================================================
-- 2) 最新のユーザーIDで手動INSERTを試みる（エラーメッセージを確認）
-- =========================================================
-- 注意: 最新のユーザーIDを取得してから実行してください
DO $$
DECLARE
  latest_user_id uuid;
  result_count int;
BEGIN
  -- 最新のauth.usersのIDを取得
  SELECT id INTO latest_user_id
  FROM auth.users
  ORDER BY created_at DESC
  LIMIT 1;
  
  RAISE NOTICE 'Testing with latest user_id: %', latest_user_id;
  
  -- public.usersに存在するか確認
  SELECT COUNT(*) INTO result_count
  FROM public.users
  WHERE id = latest_user_id;
  
  RAISE NOTICE 'User exists in public.users: %', (result_count > 0);
  
  -- proceed_validation_settingsにINSERTを試みる
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (latest_user_id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
    
    GET DIAGNOSTICS result_count = ROW_COUNT;
    RAISE NOTICE 'INSERT result: % rows affected', result_count;
    
    -- レコードが作成されたか確認
    SELECT COUNT(*) INTO result_count
    FROM proceed_validation_settings
    WHERE user_id = latest_user_id;
    
    RAISE NOTICE 'Record exists in proceed_validation_settings: %', (result_count > 0);
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error occurred: %', SQLERRM;
    RAISE NOTICE 'Error code: %', SQLSTATE;
    RAISE NOTICE 'Error detail: %', SQLERRM;
  END;
END $$;

-- =========================================================
-- 3) RLSの状態とポリシーを確認
-- =========================================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'proceed_validation_settings';

SELECT
  policyname,
  permissive,
  roles,
  cmd,
  with_check
FROM pg_policies
WHERE tablename = 'proceed_validation_settings'
ORDER BY policyname;

-- =========================================================
-- 4) handle_new_user()関数が正しく定義されているか再確認
-- =========================================================
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' 
    THEN 'Contains proceed_validation_settings'
    ELSE 'Does NOT contain proceed_validation_settings'
  END as check_result,
  LENGTH(pg_get_functiondef(oid)) as function_length
FROM pg_proc
WHERE proname = 'handle_new_user';

