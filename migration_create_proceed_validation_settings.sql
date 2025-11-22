-- =========================================================
-- Migration: Create proceed_validation_settings table
-- =========================================================
-- This table stores user preferences for proceed_yield_amount validation
-- when it exceeds total ingredients weight.

-- =========================================================
-- 1) ENUM型を作成
-- =========================================================
CREATE TYPE validation_mode AS ENUM ('permit', 'block', 'notify');

-- =========================================================
-- 2) proceed_validation_settingsテーブルを作成
-- =========================================================
CREATE TABLE IF NOT EXISTS proceed_validation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  validation_mode validation_mode NOT NULL DEFAULT 'block',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- =========================================================
-- 3) インデックスを作成
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_proceed_validation_settings_user_id 
  ON proceed_validation_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_proceed_validation_settings_created_at 
  ON proceed_validation_settings(created_at);

-- =========================================================
-- 4) updated_atを自動更新するトリガーを作成
-- =========================================================
CREATE OR REPLACE FUNCTION update_proceed_validation_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_proceed_validation_settings_updated_at
  BEFORE UPDATE ON proceed_validation_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_proceed_validation_settings_updated_at();

-- =========================================================
-- 5) usersテーブルにINSERTされたときにproceed_validation_settingsも自動作成
-- =========================================================
CREATE OR REPLACE FUNCTION create_proceed_validation_settings_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO proceed_validation_settings (user_id, validation_mode)
  VALUES (NEW.id, 'block')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 既存のトリガーを削除（存在する場合）
DROP TRIGGER IF EXISTS trigger_create_proceed_validation_settings_on_user_insert ON users;

-- 新しいトリガーを作成
CREATE TRIGGER trigger_create_proceed_validation_settings_on_user_insert
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION create_proceed_validation_settings_for_new_user();

-- =========================================================
-- 6) RLS（Row Level Security）を有効化（オプション）
-- =========================================================
ALTER TABLE proceed_validation_settings ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 完了
-- =========================================================

