-- =========================================================
-- Migration: Phase 2 - Create resource_shares and history_logs tables
-- =========================================================
-- This migration creates tables for Phase 2 authorization features:
-- 1. resource_shares: Manages sharing and exclusions between tenants
-- 2. history_logs: Tracks CRUD operations on all resources
--
-- =========================================================

BEGIN;

-- =========================================================
-- 1) resource_shares テーブルを作成
-- =========================================================
-- リソースの共有と除外を管理するテーブル
CREATE TABLE IF NOT EXISTS resource_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL, -- 'vendor_item', 'base_item', 'item', etc.
  resource_id uuid NOT NULL,
  owner_tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('tenant', 'role', 'user')),
  target_id text, -- tenant_id (uuid as text), role名 ('admin', 'manager', 'staff'), user_id (uuid as text)
  is_exclusion boolean DEFAULT false, -- TRUE = FORBID（permitを上書き）
  show_history_to_shared boolean DEFAULT false, -- 価格履歴の可視性
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for resource_shares
CREATE INDEX IF NOT EXISTS idx_resource_shares_resource ON resource_shares (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_owner_tenant ON resource_shares (owner_tenant_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_target ON resource_shares (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_resource_shares_exclusion ON resource_shares (is_exclusion) WHERE is_exclusion = true;

-- =========================================================
-- 2) history_logs テーブルを作成
-- =========================================================
-- すべてのリソースのCRUD操作を追跡するテーブル
CREATE TABLE IF NOT EXISTS history_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL, -- 'vendor_item', 'base_item', 'item', etc.
  resource_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changed_fields jsonb, -- 変更されたフィールドと値
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('internal', 'shared')),
  created_at timestamptz DEFAULT now()
);

-- Indexes for history_logs
CREATE INDEX IF NOT EXISTS idx_history_logs_resource ON history_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_history_logs_tenant ON history_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_history_logs_changed_by ON history_logs (changed_by);
CREATE INDEX IF NOT EXISTS idx_history_logs_created_at ON history_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_logs_visibility ON history_logs (visibility);

COMMIT;

