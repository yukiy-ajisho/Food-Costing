-- =========================================================
-- Check handle_new_user() function and test it manually
-- =========================================================

-- =========================================================
-- 1) handle_new_user()関数の定義を確認
-- =========================================================
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- =========================================================
-- 2) 手動でproceed_validation_settingsにINSERTを試みる（失敗したユーザーIDで）
-- =========================================================
-- 注意: b6a4ad63-07d8-4d4c-9ed2-e21d9464c517 を使用
DO $$
DECLARE
  test_user_id uuid := 'b6a4ad63-07d8-4d4c-9ed2-e21d9464c517';
  result_count int;
BEGIN
  RAISE NOTICE 'Testing INSERT for user_id: %', test_user_id;
  
  -- public.usersに存在するか確認
  SELECT COUNT(*) INTO result_count
  FROM public.users
  WHERE id = test_user_id;
  
  RAISE NOTICE 'User exists in public.users: %', (result_count > 0);
  
  -- proceed_validation_settingsにINSERTを試みる
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (test_user_id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
    
    GET DIAGNOSTICS result_count = ROW_COUNT;
    RAISE NOTICE 'INSERT result: % rows affected', result_count;
    
    -- レコードが作成されたか確認
    SELECT COUNT(*) INTO result_count
    FROM proceed_validation_settings
    WHERE user_id = test_user_id;
    
    RAISE NOTICE 'Record exists in proceed_validation_settings: %', (result_count > 0);
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error occurred: %', SQLERRM;
    RAISE NOTICE 'Error code: %', SQLSTATE;
  END;
END $$;

-- =========================================================
-- 3) RLSの状態を確認
-- =========================================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'proceed_validation_settings';

-- =========================================================
-- 4) 外部キー制約を確認
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

