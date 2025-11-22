-- =========================================================
-- Migration: Fix proceed_validation_settings to reference public.users
-- =========================================================
-- This migration:
-- 1. Changes the foreign key from auth.users to public.users (for consistency)
-- 2. Modifies handle_new_user() to create proceed_validation_settings record
-- 3. Removes old triggers on auth.users

-- =========================================================
-- 1) 既存のトリガーを削除
-- =========================================================
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_auth_user_insert ON auth.users;
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_user_insert ON users;

-- =========================================================
-- 2) 外部キー制約を変更（auth.users → public.users）
-- =========================================================
ALTER TABLE proceed_validation_settings
  DROP CONSTRAINT IF EXISTS proceed_validation_settings_user_id_fkey;

ALTER TABLE proceed_validation_settings
  ADD CONSTRAINT proceed_validation_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- =========================================================
-- 3) handle_new_user()関数を修正して、proceed_validation_settingsも作成
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- public.usersにレコードを作成
  INSERT INTO public.users (id)
  VALUES (new.id);
  
  -- proceed_validation_settingsにもレコードを作成（デフォルト設定を割り当てる）
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
-- 4) RLSポリシーを確認・更新（postgresロールを許可）
-- =========================================================
-- 既存のINSERTポリシーを削除
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Users can insert their own proceed_validation_settings" ON proceed_validation_settings;

-- postgresロールも許可するINSERTポリシーを作成（SECURITY DEFINER関数用）
CREATE POLICY "Service role and postgres can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public, postgres
  WITH CHECK (true);

-- ユーザーが自分のレコードをINSERTできるポリシー
CREATE POLICY "Users can insert their own proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 完了
-- =========================================================
-- これで、新規ユーザーがGoogle Authでログインすると：
-- 1. auth.usersにレコードが作成される
-- 2. handle_new_user()が発火してpublic.usersにレコードが作成される
-- 3. 同時にproceed_validation_settingsにもレコードが作成される（validation_mode = 'block'）

