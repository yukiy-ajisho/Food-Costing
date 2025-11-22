-- =========================================================
-- Migration: Fix proceed_validation_settings trigger function
-- =========================================================
-- This migration fixes the trigger function to use SECURITY DEFINER
-- and adds proper error handling so authentication doesn't fail.

-- =========================================================
-- 1) 関数をSECURITY DEFINERに変更し、エラーハンドリングを追加
-- =========================================================
CREATE OR REPLACE FUNCTION create_proceed_validation_settings_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (NEW.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    -- ログに記録するだけ（必要に応じて）
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- 2) 既存ユーザー用にproceed_validation_settingsレコードを作成
-- =========================================================
INSERT INTO proceed_validation_settings (user_id, validation_mode)
SELECT id, 'block'
FROM public.users
WHERE id NOT IN (SELECT user_id FROM proceed_validation_settings WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;

-- =========================================================
-- 完了
-- =========================================================

