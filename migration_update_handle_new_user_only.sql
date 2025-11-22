-- =========================================================
-- Migration: Update handle_new_user() function only
-- =========================================================
-- This migration updates ONLY the handle_new_user() function
-- to include proceed_validation_settings creation

-- =========================================================
-- handle_new_user()関数を修正して、proceed_validation_settingsも作成
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
-- 完了
-- =========================================================
-- このマイグレーションを実行後、新規ユーザーでログインすると
-- proceed_validation_settingsにもレコードが自動作成されます

