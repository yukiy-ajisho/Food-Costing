-- =========================================================
-- Debug: Test proceed_validation_settings creation directly
-- =========================================================
-- このスクリプトで、実際に何が起きているか確認します

-- =========================================================
-- 1) 現在のauth.usersの最新ユーザーIDを取得
-- =========================================================
SELECT id, email, created_at 
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;

-- =========================================================
-- 2) 関数を直接実行してテスト（最新のユーザーIDを使用）
-- =========================================================
-- 注意: 上記のクエリで取得した最新のユーザーIDを以下に置き換えてください
-- 例: '00000000-0000-0000-0000-000000000000'

-- テスト用の一時テーブルを作成（実際のINSERTをシミュレート）
DO $$
DECLARE
  test_user_id uuid;
  result_count int;
BEGIN
  -- 最新のユーザーIDを取得
  SELECT id INTO test_user_id 
  FROM auth.users 
  ORDER BY created_at DESC 
  LIMIT 1;
  
  RAISE NOTICE 'Testing with user_id: %', test_user_id;
  
  -- 関数を直接呼び出し（NEW.idをシミュレート）
  -- 注意: これは実際のトリガー関数を直接呼び出すことはできません
  -- 代わりに、INSERTを試みます
  
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
    
    RAISE NOTICE 'Record exists: %', (result_count > 0);
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error occurred: %', SQLERRM;
  END;
END $$;

-- =========================================================
-- 3) トリガー関数の定義を確認（エラーがないか）
-- =========================================================
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'create_proceed_validation_settings_for_new_auth_user';

-- =========================================================
-- 4) 実際にトリガーが発火するかテスト（新しいテストユーザーを作成）
-- =========================================================
-- 注意: これは実際のユーザー作成をシミュレートできません
-- Supabaseの認証システムを通じてのみauth.usersにINSERTされます

-- =========================================================
-- 5) RLSポリシーを一時的に無効化してテスト
-- =========================================================
-- 注意: これは本番環境では実行しないでください
-- ALTER TABLE proceed_validation_settings DISABLE ROW LEVEL SECURITY;

-- =========================================================
-- 6) 現在のproceed_validation_settingsのレコード数を確認
-- =========================================================
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT user_id) as unique_users
FROM proceed_validation_settings;

-- auth.usersのユーザー数と比較
SELECT 
  (SELECT COUNT(*) FROM auth.users) as auth_users_count,
  (SELECT COUNT(*) FROM proceed_validation_settings) as proceed_settings_count,
  (SELECT COUNT(*) FROM auth.users) - (SELECT COUNT(*) FROM proceed_validation_settings) as missing_count;

