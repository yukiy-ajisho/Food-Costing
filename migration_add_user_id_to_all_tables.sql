-- =========================================================
-- Migration: Add user_id column to all tables for multi-tenancy
-- =========================================================
-- This migration adds user_id to all application tables to enable
-- data isolation per user. All tables will reference the users table,
-- which in turn references auth.users.

-- =========================================================
-- 1) base_itemsテーブルにuser_idを追加
-- =========================================================
ALTER TABLE base_items 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_base_items_user_id ON base_items(user_id);

-- =========================================================
-- 2) vendorsテーブルにuser_idを追加
-- =========================================================
ALTER TABLE vendors 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id);

-- =========================================================
-- 3) vendor_productsテーブルにuser_idを追加
-- =========================================================
ALTER TABLE vendor_products 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vendor_products_user_id ON vendor_products(user_id);

-- =========================================================
-- 4) itemsテーブルにuser_idを追加
-- =========================================================
ALTER TABLE items 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);

-- =========================================================
-- 5) recipe_linesテーブルにuser_idを追加
-- =========================================================
ALTER TABLE recipe_lines 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_recipe_lines_user_id ON recipe_lines(user_id);

-- =========================================================
-- 6) labor_rolesテーブルにuser_idを追加
-- =========================================================
ALTER TABLE labor_roles 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_labor_roles_user_id ON labor_roles(user_id);

-- =========================================================
-- 7) non_mass_unitsテーブルにuser_idを追加
-- =========================================================
ALTER TABLE non_mass_units 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_non_mass_units_user_id ON non_mass_units(user_id);

-- =========================================================
-- 8) item_unit_profilesテーブルにuser_idを追加
-- =========================================================
ALTER TABLE item_unit_profiles 
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_item_unit_profiles_user_id ON item_unit_profiles(user_id);

-- =========================================================
-- 完了
-- =========================================================

