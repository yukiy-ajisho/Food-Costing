-- =========================================================
-- Migration: Change proceed_validation_settings foreign key to auth.users
-- =========================================================
-- This migration changes the foreign key constraint from public.users to auth.users
-- so that proceed_validation_settings can be created directly when auth.users is created

-- =========================================================
-- 1) 既存の外部キー制約を削除
-- =========================================================
ALTER TABLE proceed_validation_settings
  DROP CONSTRAINT IF EXISTS proceed_validation_settings_user_id_fkey;

-- =========================================================
-- 2) auth.usersを参照する新しい外部キー制約を追加
-- =========================================================
ALTER TABLE proceed_validation_settings
  ADD CONSTRAINT proceed_validation_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- =========================================================
-- 3) 既存のトリガーを削除
-- =========================================================
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_user_insert ON users;
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_auth_user_insert ON auth.users;

-- =========================================================
-- 4) auth.usersにINSERTされたときにproceed_validation_settingsも自動作成する関数を作成
-- =========================================================
CREATE OR REPLACE FUNCTION create_proceed_validation_settings_for_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (NEW.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- 5) auth.usersにINSERTされたときに発火するトリガーを作成
-- =========================================================
CREATE TRIGGER trigger_create_proceed_validation_settings_on_auth_user_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_proceed_validation_settings_for_new_auth_user();

-- =========================================================
-- 完了
-- =========================================================

