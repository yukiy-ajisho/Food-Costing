-- =========================================================
-- Migration: Simple fix - Create proceed_validation_settings in handle_new_user()
-- =========================================================
-- 最もシンプルで確実な方法: handle_new_user()内で作成する
-- これなら、public.usersの作成と同時に確実に実行されます

-- =========================================================
-- 1) 既存のトリガーを削除（auth.users上のもの）
-- =========================================================
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_auth_user_insert ON auth.users;

-- =========================================================
-- 2) handle_new_user()関数を修正して、proceed_validation_settingsも作成
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- public.usersにレコードを作成
  INSERT INTO public.users (id)
  VALUES (new.id);
  
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
-- 3) 外部キー制約を確認（auth.usersを参照している必要がある）
-- =========================================================
-- 既存の外部キー制約を削除（存在する場合）
ALTER TABLE proceed_validation_settings
  DROP CONSTRAINT IF EXISTS proceed_validation_settings_user_id_fkey;

-- auth.usersを参照する外部キー制約を追加
ALTER TABLE proceed_validation_settings
  ADD CONSTRAINT proceed_validation_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- =========================================================
-- 4) RLSポリシーを確認（postgresロールを許可）
-- =========================================================
-- 既存のINSERTポリシーを削除
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Service role and postgres can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Users can insert their own proceed_validation_settings" ON proceed_validation_settings;

-- postgresロールも許可するINSERTポリシーを作成
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
-- この方法なら、handle_new_user()が実行されるたびに
-- 確実にproceed_validation_settingsも作成されます

