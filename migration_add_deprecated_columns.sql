-- =========================================================
-- Migration: Add deprecated columns for soft delete functionality
-- =========================================================

-- 1. base_items テーブルに deprecated カラムを追加
ALTER TABLE base_items
  ADD COLUMN IF NOT EXISTS deprecated timestamptz;

-- 2. vendor_products テーブルに deprecated カラムを追加
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS deprecated timestamptz;

-- 3. items テーブルに deprecated カラムを追加
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS deprecated timestamptz;

-- 3.5. items テーブルに deprecation_reason カラムを追加
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS deprecation_reason text;

-- 4. recipe_lines テーブルに last_change カラムを追加
ALTER TABLE recipe_lines
  ADD COLUMN IF NOT EXISTS last_change text;

-- 5. インデックスを追加（パフォーマンス向上のため）
CREATE INDEX IF NOT EXISTS idx_base_items_deprecated ON base_items (deprecated);
CREATE INDEX IF NOT EXISTS idx_vendor_products_deprecated ON vendor_products (deprecated);
CREATE INDEX IF NOT EXISTS idx_items_deprecated ON items (deprecated);
CREATE INDEX IF NOT EXISTS idx_items_deprecation_reason ON items (deprecation_reason);

-- 6. 名前の一意性制約を追加（アクティブなレコードのみ）
-- base_items: アクティブな同じnameは1つのみ
CREATE UNIQUE INDEX IF NOT EXISTS idx_base_items_name_unique_active 
  ON base_items (name) 
  WHERE deprecated IS NULL;

-- vendor_products: アクティブな同じproduct_name, base_item_id, vendor_idの組み合わせは1つのみ
-- product_nameがNULLの場合も考慮
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_products_unique_active 
  ON vendor_products (base_item_id, vendor_id, COALESCE(product_name, '')) 
  WHERE deprecated IS NULL;

-- items: アクティブな同じnameは1つのみ
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_unique_active 
  ON items (name) 
  WHERE deprecated IS NULL;

-- =========================================================
-- 完了
-- =========================================================

