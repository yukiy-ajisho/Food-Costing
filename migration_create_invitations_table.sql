-- =========================================================
-- Migration: Create invitations table
-- =========================================================
-- This migration creates the invitations table to support
-- the invitation feature for adding users to tenants.
--
-- Invitations allow admins to invite users (by email) to join
-- their tenant with a specific role (manager or staff).
-- =========================================================

BEGIN;

-- =========================================================
-- 1) invitations テーブルを作成
-- =========================================================
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'staff')),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'canceled')),
  email_status text CHECK (email_status IN ('delivered', 'failed')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- 同じemailとtenant_idの組み合わせでpendingの招待が複数存在しないように
-- 部分インデックスを使用（PostgreSQL 9.5以降でサポート）
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_unique_pending 
  ON invitations (email, tenant_id) 
  WHERE status = 'pending';

-- =========================================================
-- 2) インデックスの作成
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_invitations_id ON invitations(id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant_id ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_created_by ON invitations(created_by);
CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email_tenant_status ON invitations(email, tenant_id, status);

COMMIT;

