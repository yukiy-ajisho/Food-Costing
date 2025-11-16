-- =========================================================
-- Migration: Update vendor_products and items tables
-- 既存のマイグレーション実行後の追加変更
-- =========================================================

-- =========================================================
-- 1) vendor_products テーブルの変更
-- =========================================================

-- 1.1) price カラムを削除
ALTER TABLE vendor_products
  DROP COLUMN IF EXISTS price;

-- 1.2) product_name を NULL 可能に変更
ALTER TABLE vendor_products
  ALTER COLUMN product_name DROP NOT NULL;

-- 1.3) UNIQUE制約を更新（product_nameがNULL可能になったため、NULLの場合は重複を許可）
-- 既存の制約を削除
ALTER TABLE vendor_products
  DROP CONSTRAINT IF EXISTS uq_vendor_products_unique;

-- 新しい制約を追加（product_nameがNULLの場合は重複を許可するため、部分インデックスを使用）
-- 注意: PostgreSQLでは、NULL値はUNIQUE制約では常に異なるものとして扱われるため、
-- この制約は product_name が NULL でない場合のみ適用される
CREATE UNIQUE INDEX uq_vendor_products_unique 
  ON vendor_products (raw_item_id, vendor_id, product_name)
  WHERE product_name IS NOT NULL;

-- =========================================================
-- 2) items テーブルの変更
-- =========================================================

-- 2.1) 既存の制約を削除
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_raw_has_vendor_product,
  DROP CONSTRAINT IF EXISTS chk_items_raw_fields_new,
  DROP CONSTRAINT IF EXISTS chk_items_prepped_fields_new;

-- 2.2) 既存のインデックスを削除
DROP INDEX IF EXISTS idx_items_vendor_product;

-- 2.3) vendor_product_id → row_item_id に名前変更
ALTER TABLE items
  RENAME COLUMN vendor_product_id TO row_item_id;

-- 2.4) yield_amount → proceed_yield_amount に名前変更
ALTER TABLE items
  RENAME COLUMN yield_amount TO proceed_yield_amount;

-- 2.5) yield_unit → proceed_yield_unit に名前変更
ALTER TABLE items
  RENAME COLUMN yield_unit TO proceed_yield_unit;

-- 2.6) 新しい制約を追加
-- raw itemの場合：row_item_idは必須、proceed_yield_*はNULL
-- prepped itemの場合：proceed_yield_*は必須、row_item_idはNULL
ALTER TABLE items
  ADD CONSTRAINT chk_items_raw_has_row_item
  CHECK (
    item_kind <> 'raw' OR row_item_id IS NOT NULL
  ),
  ADD CONSTRAINT chk_items_raw_fields_new CHECK (
    item_kind <> 'raw' OR (
      row_item_id IS NOT NULL AND
      proceed_yield_amount IS NULL AND
      proceed_yield_unit IS NULL
    )
  ),
  ADD CONSTRAINT chk_items_prepped_fields_new CHECK (
    item_kind <> 'prepped' OR (
      proceed_yield_amount IS NOT NULL AND
      proceed_yield_amount > 0 AND
      proceed_yield_unit IS NOT NULL AND
      row_item_id IS NULL
    )
  );

-- 2.7) 新しいインデックスを追加
CREATE INDEX IF NOT EXISTS idx_items_row_item ON items (row_item_id);

-- =========================================================
-- 完了
-- =========================================================

