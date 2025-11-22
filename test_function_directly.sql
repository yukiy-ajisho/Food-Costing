-- =========================================================
-- Test the function directly by checking if it creates proceed_validation_settings
-- =========================================================

-- 最新のユーザーで、proceed_validation_settingsが作成されているか確認
-- そして、作成されていない場合は、関数を直接実行してみる

DO $$
DECLARE
  latest_user_id uuid;
  latest_auth_created_at timestamptz;
  proceed_settings_count int;
BEGIN
  -- 最新のauth.usersのIDと作成日時を取得
  SELECT id, created_at INTO latest_user_id, latest_auth_created_at
  FROM auth.users
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- proceed_validation_settingsにレコードが存在するか確認
  SELECT COUNT(*) INTO proceed_settings_count
  FROM proceed_validation_settings
  WHERE user_id = latest_user_id;
  
  -- 結果を表示（SupabaseではRAISE NOTICEが表示されないので、SELECTで返す）
  -- 代わりに、一時テーブルに結果を保存
  CREATE TEMP TABLE IF NOT EXISTS test_result (
    message text
  );
  
  DELETE FROM test_result;
  
  INSERT INTO test_result VALUES ('Latest user_id: ' || latest_user_id::text);
  INSERT INTO test_result VALUES ('Auth created at: ' || latest_auth_created_at::text);
  INSERT INTO test_result VALUES ('Proceed settings count: ' || proceed_settings_count::text);
  
  IF proceed_settings_count = 0 THEN
    INSERT INTO test_result VALUES ('STATUS: proceed_validation_settings NOT created');
    
    -- 手動でINSERTを試みる
    BEGIN
      INSERT INTO proceed_validation_settings (user_id, validation_mode)
      VALUES (latest_user_id, 'block')
      ON CONFLICT (user_id) DO NOTHING;
      
      SELECT COUNT(*) INTO proceed_settings_count
      FROM proceed_validation_settings
      WHERE user_id = latest_user_id;
      
      IF proceed_settings_count > 0 THEN
        INSERT INTO test_result VALUES ('STATUS: Manual INSERT succeeded');
      ELSE
        INSERT INTO test_result VALUES ('STATUS: Manual INSERT failed');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO test_result VALUES ('ERROR: ' || SQLERRM);
    END;
  ELSE
    INSERT INTO test_result VALUES ('STATUS: proceed_validation_settings already exists');
  END IF;
END $$;

-- 結果を表示
SELECT * FROM test_result;

