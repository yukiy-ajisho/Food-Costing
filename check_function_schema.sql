-- =========================================================
-- Check if the function is using the correct schema/table name
-- =========================================================

-- 関数定義内で使用されているテーブル名を確認
SELECT 
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' THEN 'Uses proceed_validation_settings'
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_setting%' THEN 'Uses proceed_validation_setting (SINGULAR - WRONG!)'
    ELSE 'Does not use proceed_validation_settings'
  END as table_name_check,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%public.proceed_validation_settings%' THEN 'Uses public.proceed_validation_settings'
    WHEN pg_get_functiondef(oid) LIKE '%proceed_validation_settings%' THEN 'Uses proceed_validation_settings (no schema)'
    ELSE 'Does not use proceed_validation_settings'
  END as schema_check
FROM pg_proc
WHERE proname = 'handle_new_user';

-- テーブルが存在するか確認
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE tablename LIKE '%proceed_validation%'
ORDER BY tablename;

