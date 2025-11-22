-- =========================================================
-- Migration: Fix proceed_validation_settings complete setup
-- =========================================================
-- This migration fixes:
-- 1. Adds missing foreign key constraint to auth.users
-- 2. Moves trigger from public.users to auth.users
-- 3. Updates RLS policies to allow postgres role

-- =========================================================
-- 1) 外部キー制約を追加（auth.usersを参照）
-- =========================================================
-- 既存の外部キー制約を削除（存在する場合）
ALTER TABLE proceed_validation_settings
  DROP CONSTRAINT IF EXISTS proceed_validation_settings_user_id_fkey;

-- auth.usersを参照する外部キー制約を追加
ALTER TABLE proceed_validation_settings
  ADD CONSTRAINT proceed_validation_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- =========================================================
-- 2) トリガーをpublic.usersからauth.usersに移動
-- =========================================================
-- 既存のトリガーを削除
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_user_insert ON users;
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_auth_user_insert ON auth.users;

-- auth.usersにINSERTされたときに発火するトリガーを作成
CREATE TRIGGER trigger_create_proceed_validation_settings_on_auth_user_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_proceed_validation_settings_for_new_auth_user();

-- =========================================================
-- 3) RLSポリシーを更新（postgresロールを許可）
-- =========================================================
-- 既存のINSERTポリシーを削除
DROP POLICY IF EXISTS "Service role can insert proceed_validation_settings" ON proceed_validation_settings;
DROP POLICY IF EXISTS "Users can insert their own proceed_validation_settings" ON proceed_validation_settings;

-- postgresロールも許可するINSERTポリシーを作成
CREATE POLICY "Service role and postgres can insert proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public, postgres
  WITH CHECK (true);

-- ユーザーが自分のレコードをINSERTできるポリシー（既存のものは残す）
CREATE POLICY "Users can insert their own proceed_validation_settings"
  ON proceed_validation_settings
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 完了
-- =========================================================

