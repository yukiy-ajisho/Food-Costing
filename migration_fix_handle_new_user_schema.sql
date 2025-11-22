-- =========================================================
-- Migration: Fix handle_new_user() to use explicit schema
-- =========================================================
-- The function might need explicit schema qualification for proceed_validation_settings

-- =========================================================
-- handle_new_user()関数を修正して、publicスキーマを明示
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- public.usersにレコードを作成
  INSERT INTO public.users (id)
  VALUES (new.id);
  
  -- proceed_validation_settingsにもレコードを作成（デフォルト設定を割り当てる）
  -- public.usersへのINSERTが成功した後なので、外部キー制約を満たす
  -- スキーマを明示的に指定
  BEGIN
    INSERT INTO public.proceed_validation_settings (user_id, validation_mode)
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
-- これで、public.proceed_validation_settingsと明示的にスキーマを指定しました

