-- =========================================================
-- Check the FULL function definition
-- =========================================================

-- 完全な関数定義を取得（改行を含む）
SELECT 
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'handle_new_user';

-- 関数定義に'proceed_validation_settings'が含まれているか確認
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' 
    THEN 'Contains proceed_validation_settings'
    ELSE 'Does NOT contain proceed_validation_settings'
  END as check_result
FROM pg_proc
WHERE proname = 'handle_new_user';

