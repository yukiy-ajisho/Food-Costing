-- =========================================================
-- Migration: Create users table for authentication
-- =========================================================
-- This table references auth.users and serves as the application-level
-- user table that other tables will reference.

-- =========================================================
-- 1) usersテーブルを作成
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =========================================================
-- 2) インデックスを作成
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- =========================================================
-- 3) RLS（Row Level Security）を有効化（オプション）
-- =========================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 完了
-- =========================================================

