-- =========================================================
-- Migration: Add vendor_products table and refactor items table
-- =========================================================

-- =========================================================
-- 1) vendor_products テーブルを作成
-- =========================================================
CREATE TABLE vendor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_item_id uuid NOT NULL REFERENCES raw_items(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  brand_name text,
  price numeric,
  purchase_unit text NOT NULL,
  purchase_quantity numeric NOT NULL CHECK (purchase_quantity > 0),
  purchase_cost numeric NOT NULL CHECK (purchase_cost > 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- 同じraw_item + vendor + product_nameの重複を禁止（オプション）
  CONSTRAINT uq_vendor_products_unique UNIQUE (raw_item_id, vendor_id, product_name)
);

-- インデックス
CREATE INDEX idx_vendor_products_raw_item ON vendor_products (raw_item_id);
CREATE INDEX idx_vendor_products_vendor ON vendor_products (vendor_id);

-- =========================================================
-- 2) 既存データの移行（既存データがある場合）
-- =========================================================
-- 注意: 既存データがない場合は、このセクションをスキップしてください

-- 既存のitemsテーブルからvendor_productsを作成
-- INSERT INTO vendor_products (
--   raw_item_id,
--   vendor_id,
--   product_name,
--   brand_name,
--   price,
--   purchase_unit,
--   purchase_quantity,
--   purchase_cost
-- )
-- SELECT DISTINCT
--   i.raw_item_id,
--   i.vendor_id,
--   i.name AS product_name,
--   NULL AS brand_name,
--   NULL AS price,
--   i.purchase_unit,
--   i.purchase_quantity,
--   i.purchase_cost
-- FROM items i
-- WHERE i.item_kind = 'raw'
--   AND i.raw_item_id IS NOT NULL
--   AND i.vendor_id IS NOT NULL
--   AND i.purchase_unit IS NOT NULL
--   AND i.purchase_quantity IS NOT NULL
--   AND i.purchase_cost IS NOT NULL;

-- =========================================================
-- 3) items テーブルを変更
-- =========================================================

-- 3.1) vendor_product_id カラムを追加（一時的にNULLを許可）
ALTER TABLE items
  ADD COLUMN vendor_product_id uuid REFERENCES vendor_products(id) ON DELETE SET NULL;

-- 3.2) each_grams カラムを追加
ALTER TABLE items
  ADD COLUMN each_grams numeric CHECK (each_grams > 0);

-- 3.3) 既存データがある場合、vendor_product_idを更新
-- UPDATE items i
-- SET vendor_product_id = vp.id
-- FROM vendor_products vp
-- WHERE i.item_kind = 'raw'
--   AND i.raw_item_id = vp.raw_item_id
--   AND i.vendor_id = vp.vendor_id
--   AND i.name = vp.product_name;

-- 3.4) 既存データがある場合、each_gramsをraw_itemsから移行
-- UPDATE items i
-- SET each_grams = ri.each_grams
-- FROM raw_items ri
-- WHERE i.item_kind = 'raw'
--   AND i.raw_item_id = ri.id
--   AND ri.each_grams IS NOT NULL;

-- 3.5) 制約を追加（raw itemの場合、vendor_product_idは必須）
ALTER TABLE items
  ADD CONSTRAINT chk_items_raw_has_vendor_product
  CHECK (
    item_kind <> 'raw' OR vendor_product_id IS NOT NULL
  );

-- 3.6) 古いカラムを削除
ALTER TABLE items
  DROP COLUMN IF EXISTS raw_item_id,
  DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS purchase_unit,
  DROP COLUMN IF EXISTS purchase_quantity,
  DROP COLUMN IF EXISTS purchase_cost;

-- 3.7) 古い制約を削除（存在する場合）
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_raw_has_references,
  DROP CONSTRAINT IF EXISTS chk_items_prepped_no_references;

-- 3.8) 新しい制約を追加
-- raw itemの場合：vendor_product_idは必須、yield_*はNULL
-- prepped itemの場合：yield_*は必須、vendor_product_idはNULL
ALTER TABLE items
  ADD CONSTRAINT chk_items_raw_fields_new CHECK (
    item_kind <> 'raw' OR (
      vendor_product_id IS NOT NULL AND
      yield_amount IS NULL AND
      yield_unit IS NULL
    )
  ),
  ADD CONSTRAINT chk_items_prepped_fields_new CHECK (
    item_kind <> 'prepped' OR (
      yield_amount IS NOT NULL AND
      yield_amount > 0 AND
      yield_unit IS NOT NULL AND
      vendor_product_id IS NULL
    )
  );

-- 3.9) インデックスを追加
CREATE INDEX IF NOT EXISTS idx_items_vendor_product ON items (vendor_product_id);

-- =========================================================
-- 4) raw_items テーブルを変更
-- =========================================================

-- 4.1) each_grams カラムを削除
ALTER TABLE raw_items
  DROP COLUMN IF EXISTS each_grams;

-- =========================================================
-- 5) インデックスのクリーンアップ（存在する場合）
-- =========================================================
DROP INDEX IF EXISTS idx_items_raw_item;
DROP INDEX IF EXISTS idx_items_vendor;

-- =========================================================
-- 完了
-- =========================================================

