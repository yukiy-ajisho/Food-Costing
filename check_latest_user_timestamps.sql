-- =========================================================
-- Check timestamps for the latest user
-- =========================================================

-- 最新のユーザーで、各テーブルの作成時刻を比較
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  pu.created_at as public_users_created_at,
  (pu.created_at - au.created_at) as time_diff_public_users,
  pvs.created_at as proceed_settings_created_at,
  (pvs.created_at - au.created_at) as time_diff_proceed_settings,
  pvs.validation_mode
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
LEFT JOIN proceed_validation_settings pvs ON au.id = pvs.user_id
WHERE au.id = '569466d0-3f5a-4407-b038-5134b09904eb';

-- 最新の3ユーザーで比較
SELECT 
  au.id,
  au.email,
  au.created_at as auth_created_at,
  pu.created_at as public_users_created_at,
  (pu.created_at - au.created_at) as time_diff_public_users,
  pvs.created_at as proceed_settings_created_at,
  (pvs.created_at - au.created_at) as time_diff_proceed_settings,
  CASE 
    WHEN pvs.id IS NOT NULL THEN 'EXISTS'
    ELSE 'MISSING'
  END as proceed_settings_status
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
LEFT JOIN proceed_validation_settings pvs ON au.id = pvs.user_id
ORDER BY au.created_at DESC
LIMIT 3;

