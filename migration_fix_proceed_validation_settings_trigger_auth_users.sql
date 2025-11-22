-- =========================================================
-- Migration: Fix proceed_validation_settings trigger
-- =========================================================
-- This migration modifies handle_new_user() to also create proceed_validation_settings
-- This ensures proceed_validation_settings is created after public.users is created

-- =========================================================
-- 1) 既存のトリガーを削除
-- =========================================================
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_user_insert ON users;
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_auth_user_insert ON auth.users;

-- =========================================================
-- 2) handle_new_user()関数を修正して、proceed_validation_settingsも作成する
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- public.usersにレコードを作成
  INSERT INTO public.users (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  
  -- proceed_validation_settingsにもレコードを作成
  -- public.usersへのINSERTが成功した後なので、外部キー制約を満たす
  BEGIN
    INSERT INTO proceed_validation_settings (user_id, validation_mode)
    VALUES (new.id, 'block')
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- エラーが発生しても認証プロセスを継続させる
    RAISE WARNING 'Failed to create proceed_validation_settings for user %: %', new.id, SQLERRM;
  END;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- 完了
-- =========================================================

