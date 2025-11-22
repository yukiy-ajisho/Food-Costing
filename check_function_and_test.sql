-- =========================================================
-- Check handle_new_user() function definition and test it
-- =========================================================

-- =========================================================
-- 1) handle_new_user()関数の完全な定義を確認
-- =========================================================
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- =========================================================
-- 2) 関数内で使用されているテーブル名とカラム名を確認
-- =========================================================
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' THEN 'Contains proceed_validation_settings'
    ELSE 'Does NOT contain proceed_validation_settings'
  END as has_proceed_validation_settings,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%validation_mode%' THEN 'Contains validation_mode'
    ELSE 'Does NOT contain validation_mode'
  END as has_validation_mode,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%INSERT INTO proceed_validation_settings%' THEN 'Has INSERT statement'
    ELSE 'Does NOT have INSERT statement'
  END as has_insert_statement
FROM pg_proc
WHERE proname = 'handle_new_user';

-- =========================================================
-- 3) 最新のユーザーIDで手動で関数をシミュレート
-- =========================================================
DO $$
DECLARE
  latest_user_id uuid;
  test_result text;
BEGIN
  -- 最新のauth.usersのIDを取得
  SELECT id INTO latest_user_id
  FROM auth.users
  ORDER BY created_at DESC
  LIMIT 1;
  
  RAISE NOTICE 'Testing with latest user_id: %', latest_user_id;
  
  -- handle_new_user()関数内と同じロジックを実行
  BEGIN
    -- public.usersに存在するか確認
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = latest_user_id) THEN
      RAISE NOTICE 'User does NOT exist in public.users';
    ELSE
      RAISE NOTICE 'User exists in public.users';
    END IF;
    
    -- proceed_validation_settingsにINSERTを試みる
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (latest_user_id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
    
    RAISE NOTICE 'INSERT completed successfully';
    
    -- レコードが作成されたか確認
    IF EXISTS (SELECT 1 FROM proceed_validation_settings WHERE user_id = latest_user_id) THEN
      RAISE NOTICE 'Record exists in proceed_validation_settings';
    ELSE
      RAISE NOTICE 'Record does NOT exist in proceed_validation_settings';
    END IF;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error occurred: %', SQLERRM;
    RAISE NOTICE 'Error code: %', SQLSTATE;
  END;
END $$;

-- =========================================================
-- 4) トリガーが正しく設定されているか確認
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

