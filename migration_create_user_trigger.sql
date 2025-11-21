-- =========================================================
-- Migration: Create trigger to automatically create users record
-- =========================================================
-- This trigger automatically creates a users record when a new user
-- is created in auth.users. This ensures that every authenticated user
-- has a corresponding record in the users table.

-- =========================================================
-- 1) 関数を作成（新規ユーザー登録時にusersレコードを自動作成）
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (new.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- 2) トリガーを作成
-- =========================================================
-- 既存のトリガーを削除（存在する場合）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 新しいトリガーを作成
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- 完了
-- =========================================================

