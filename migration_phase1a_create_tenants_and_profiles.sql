-- =========================================================
-- Migration: Phase 1a - Create Tenants and Profiles Tables
-- =========================================================
-- This migration creates the foundation for multi-tenant architecture:
-- 1. Creates tenants table (organizations: restaurants/vendors)
-- 2. Creates profiles table (links public.users to tenants with roles)
-- 3. Adds tenant_id column to all application tables (NULL allowed initially)
-- 4. Creates indexes for performance
--
-- NOTE: Data migration (setting tenant_id values) will be done in a separate migration
-- =========================================================

BEGIN;

-- =========================================================
-- 1) tenants テーブルを作成
-- =========================================================
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('restaurant', 'vendor')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_id ON tenants(id);
CREATE INDEX IF NOT EXISTS idx_tenants_type ON tenants(type);

-- =========================================================
-- 2) profiles テーブルを作成（複数テナント対応）
-- =========================================================
-- 1ユーザーが複数のテナントに属することができる構造
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, tenant_id)  -- 1ユーザーが同じテナントに複数回属さないように
);

-- 既に実行済みの場合、外部キー制約を修正
DO $$
BEGIN
  -- 既存のauth.users参照の外部キー制約を削除（存在する場合）
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'profiles_user_id_fkey' 
    AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_user_id_fkey;
  END IF;
  
  -- public.users参照の外部キー制約を追加（存在しない場合のみ）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'profiles_user_id_fkey' 
    AND table_name = 'profiles'
  ) THEN
    ALTER TABLE profiles 
    ADD CONSTRAINT profiles_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_id ON profiles(id);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user_tenant ON profiles(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- =========================================================
-- 3) 既存テーブルに tenant_id カラムを追加（NULL許可）
-- =========================================================
-- 注意: 最初はNULL許可で追加し、データマイグレーション後にNOT NULLに変更

-- base_items
ALTER TABLE base_items 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_base_items_tenant_id ON base_items(tenant_id);

-- items
ALTER TABLE items 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_items_tenant_id ON items(tenant_id);

-- recipe_lines
ALTER TABLE recipe_lines 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_recipe_lines_tenant_id ON recipe_lines(tenant_id);

-- labor_roles
ALTER TABLE labor_roles 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_labor_roles_tenant_id ON labor_roles(tenant_id);

-- vendors
ALTER TABLE vendors 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vendors_tenant_id ON vendors(tenant_id);

-- vendor_products
ALTER TABLE vendor_products 
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vendor_products_tenant_id ON vendor_products(tenant_id);

-- item_unit_profiles (存在する場合)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_unit_profiles') THEN
    ALTER TABLE item_unit_profiles 
      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_item_unit_profiles_tenant_id ON item_unit_profiles(tenant_id);
  END IF;
END $$;

-- non_mass_units (存在する場合)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'non_mass_units') THEN
    ALTER TABLE non_mass_units 
      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
    
    CREATE INDEX IF NOT EXISTS idx_non_mass_units_tenant_id ON non_mass_units(tenant_id);
  END IF;
END $$;

-- =========================================================
-- 完了
-- =========================================================
-- 次のステップ: migration_phase1a_migrate_data.sql でデータを移行

COMMIT;



