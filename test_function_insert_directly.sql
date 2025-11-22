-- =========================================================
-- Test the INSERT statement directly as SECURITY DEFINER
-- =========================================================
-- This simulates what happens inside handle_new_user()

DO $$
DECLARE
  test_user_id uuid := 'eb053a98-4c88-4ce2-ba4b-06636e89d553';
  result_count int;
BEGIN
  -- まず、proceed_validation_settingsから削除（テスト用）
  DELETE FROM proceed_validation_settings WHERE user_id = test_user_id;
  
  RAISE NOTICE 'Testing INSERT for user_id: %', test_user_id;
  
  -- handle_new_user()関数内と同じINSERT文を実行
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
    
    RAISE NOTICE 'Record count after INSERT: %', result_count;
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error occurred: %', SQLERRM;
    RAISE NOTICE 'Error code: %', SQLSTATE;
    RAISE NOTICE 'Error detail: %', SQLERRM;
  END;
END $$;

-- 結果を確認
SELECT 
  user_id,
  validation_mode,
  created_at
FROM proceed_validation_settings
WHERE user_id = 'eb053a98-4c88-4ce2-ba4b-06636e89d553';

