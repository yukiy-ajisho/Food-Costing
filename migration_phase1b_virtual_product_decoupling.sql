-- =========================================================
-- Migration: Phase 1b - Virtual Product Decoupling
-- =========================================================
-- This migration decouples base_items from vendor_products:
-- 1. Renames vendor_products to virtual_vendor_products
-- 2. Creates product_mappings bridge table
-- 3. Migrates existing base_item_id relationships to product_mappings
-- 4. Removes base_item_id column from virtual_vendor_products
-- 5. Updates unique constraints
-- =========================================================

BEGIN;

-- =========================================================
-- Step 1: Rename vendor_products to virtual_vendor_products
-- =========================================================
ALTER TABLE vendor_products RENAME TO virtual_vendor_products;

-- Rename indexes
DROP INDEX IF EXISTS idx_vendor_products_raw_item;
DROP INDEX IF EXISTS idx_vendor_products_vendor;
DROP INDEX IF EXISTS idx_vendor_products_base_item;
DROP INDEX IF EXISTS idx_vendor_products_tenant_id;

CREATE INDEX IF NOT EXISTS idx_virtual_vendor_products_vendor ON virtual_vendor_products (vendor_id);
CREATE INDEX IF NOT EXISTS idx_virtual_vendor_products_tenant_id ON virtual_vendor_products (tenant_id);
CREATE INDEX IF NOT EXISTS idx_virtual_vendor_products_deprecated ON virtual_vendor_products (deprecated) WHERE deprecated IS NOT NULL;

-- Rename foreign key constraints (if they exist)
DO $$
BEGIN
  -- Rename base_item_id foreign key constraint
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'vendor_products_base_item_id_fkey'
  ) THEN
    ALTER TABLE virtual_vendor_products 
    RENAME CONSTRAINT vendor_products_base_item_id_fkey 
    TO virtual_vendor_products_base_item_id_fkey;
  END IF;
END $$;

-- =========================================================
-- Step 2: Create product_mappings bridge table
-- =========================================================
CREATE TABLE IF NOT EXISTS product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_item_id uuid NOT NULL REFERENCES base_items(id) ON DELETE CASCADE,
  virtual_product_id uuid NOT NULL REFERENCES virtual_vendor_products(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (base_item_id, virtual_product_id, tenant_id)
);

-- Indexes for product_mappings
CREATE INDEX IF NOT EXISTS idx_product_mappings_base_item_id ON product_mappings (base_item_id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_virtual_product_id ON product_mappings (virtual_product_id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_tenant_id ON product_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_mappings_base_tenant ON product_mappings (base_item_id, tenant_id);

-- =========================================================
-- Step 3: Migrate existing base_item_id relationships to product_mappings
-- =========================================================
INSERT INTO product_mappings (base_item_id, virtual_product_id, tenant_id)
SELECT 
  vvp.base_item_id,
  vvp.id,
  vvp.tenant_id
FROM virtual_vendor_products vvp
WHERE vvp.base_item_id IS NOT NULL
ON CONFLICT (base_item_id, virtual_product_id, tenant_id) DO NOTHING;

-- =========================================================
-- Step 4: Remove base_item_id column from virtual_vendor_products
-- =========================================================
-- First, drop the foreign key constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'virtual_vendor_products_base_item_id_fkey'
  ) THEN
    ALTER TABLE virtual_vendor_products 
    DROP CONSTRAINT virtual_vendor_products_base_item_id_fkey;
  END IF;
END $$;

-- Drop the unique constraint/index that includes base_item_id
DROP INDEX IF EXISTS uq_vendor_products_unique;

-- Remove the base_item_id column
ALTER TABLE virtual_vendor_products DROP COLUMN IF EXISTS base_item_id;

-- =========================================================
-- Step 5: Update unique constraint on virtual_vendor_products
-- =========================================================
-- New unique constraint: (vendor_id, product_name, tenant_id)
-- This prevents duplicate products from the same vendor for the same tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_virtual_vendor_products_unique 
  ON virtual_vendor_products (vendor_id, product_name, tenant_id)
  WHERE product_name IS NOT NULL;

-- For NULL product_name, we don't enforce uniqueness (allows multiple NULLs per vendor/tenant)

COMMIT;

-- =========================================================
-- Verification queries (optional - run manually to verify)
-- =========================================================
-- SELECT COUNT(*) FROM virtual_vendor_products;
-- SELECT COUNT(*) FROM product_mappings;
-- SELECT COUNT(*) FROM product_mappings pm
-- JOIN virtual_vendor_products vvp ON pm.virtual_product_id = vvp.id
-- WHERE vvp.tenant_id = pm.tenant_id;


