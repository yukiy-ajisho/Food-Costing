-- =========================================================
-- Verify RLS policy fix and check current state
-- =========================================================

-- =========================================================
-- 1) RLSポリシーを確認（postgresロールが含まれているか）
-- =========================================================
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  with_check
FROM pg_policies
WHERE tablename = 'proceed_validation_settings'
  AND cmd = 'INSERT'
ORDER BY policyname;

-- =========================================================
-- 2) 最新のユーザーを確認
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
-- 3) handle_new_user()関数の定義を確認
-- =========================================================
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' 
    THEN 'Contains proceed_validation_settings'
    ELSE 'Does NOT contain proceed_validation_settings'
  END as check_result
FROM pg_proc
WHERE proname = 'handle_new_user';

-- =========================================================
-- 4) 最新のユーザーIDで手動INSERTを試みる（postgresロールとして）
-- =========================================================
-- 注意: これはSECURITY DEFINER関数内で実行されるのと同じ条件をシミュレート
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
  
  RAISE NOTICE 'Testing INSERT for user_id: %', latest_user_id;
  
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
-- 5) RLSが有効かどうか確認
-- =========================================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'proceed_validation_settings';

