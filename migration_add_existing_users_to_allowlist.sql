-- =========================================================
-- Migration: Add existing users to allowlist
-- =========================================================
-- Purpose:
-- 既存のauth.usersに登録されているユーザーを
-- allowlistテーブルに追加し、status='approved'に設定する
-- 
-- ⚠️ 注意: このmigrationは以下の後に実行すること
--   1. migration_create_allowlist_and_auth_hook.sql
--   2. Auth Hookの有効化
-- 
-- 実行タイミング:
-- - Auth Hookを有効化する「直前」に実行するのが最適
-- - または、Auth Hook有効化後すぐに実行
-- =========================================================

BEGIN;

-- 既存のauth.usersの全ユーザーをallowlistに追加
INSERT INTO allowlist (email, status, approved_at, approved_by, note)
SELECT 
  email,
  'approved' AS status,
  now() AS approved_at,
  'migration' AS approved_by,
  'Existing user migrated from auth.users' AS note
FROM auth.users
WHERE email IS NOT NULL
ON CONFLICT (email) DO UPDATE
  SET 
    status = 'approved',
    approved_at = COALESCE(allowlist.approved_at, now()),
    approved_by = COALESCE(allowlist.approved_by, 'migration'),
    note = COALESCE(allowlist.note, 'Existing user migrated from auth.users');

-- 実行結果をログ出力
DO $$
DECLARE
  inserted_count integer;
BEGIN
  SELECT COUNT(*) INTO inserted_count
  FROM allowlist
  WHERE approved_by = 'migration';
  
  RAISE NOTICE '既存ユーザー % 件をallowlistに追加しました', inserted_count;
END $$;

COMMIT;

-- =========================================================
-- 実行後の確認クエリ
-- =========================================================
-- 
-- 全allowlistエントリを確認:
-- SELECT email, status, approved_by, created_at 
-- FROM allowlist 
-- ORDER BY created_at DESC;
-- 
-- 既存ユーザーのみ確認:
-- SELECT email, status, approved_by 
-- FROM allowlist 
-- WHERE approved_by = 'migration';
-- 
-- auth.usersとallowlistの比較:
-- SELECT 
--   u.email,
--   CASE 
--     WHEN a.email IS NOT NULL THEN 'allowlistにあり'
--     ELSE 'allowlistになし'
--   END AS status
-- FROM auth.users u
-- LEFT JOIN allowlist a ON u.email = a.email
-- WHERE u.email IS NOT NULL;
-- 
-- =========================================================


