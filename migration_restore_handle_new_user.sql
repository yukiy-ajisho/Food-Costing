-- =========================================================
-- Migration: Restore handle_new_user() to original state
-- =========================================================
-- This migration restores the handle_new_user() function to its original state

-- =========================================================
-- 1) handle_new_user()関数を元の状態に戻す
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================
-- 2) トリガーを確認（既に存在する場合はそのまま）
-- =========================================================
-- トリガーは既に存在するはずなので、再作成は不要
-- もし存在しない場合は、以下を実行：
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- 完了
-- =========================================================

