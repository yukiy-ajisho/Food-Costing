-- =========================================================
-- Migration: Rename raw_items to base_items and update references
-- 既存のマイグレーション実行後の追加変更
-- =========================================================

-- =========================================================
-- 1) raw_items テーブルを base_items に名前変更
-- =========================================================

-- 1.1) テーブル名を変更
ALTER TABLE raw_items RENAME TO base_items;

-- 1.2) シーケンスやその他の関連オブジェクトも更新（必要に応じて）
-- 注意: インデックスや制約は自動的に更新されます

-- =========================================================
-- 2) vendor_products テーブルの変更
-- =========================================================

-- 2.1) 既存の外部キー制約を削除
ALTER TABLE vendor_products
  DROP CONSTRAINT IF EXISTS vendor_products_raw_item_id_fkey;

-- 2.2) カラム名を変更
ALTER TABLE vendor_products
  RENAME COLUMN raw_item_id TO base_item_id;

-- 2.3) 新しい外部キー制約を追加（base_itemsを参照）
ALTER TABLE vendor_products
  ADD CONSTRAINT vendor_products_base_item_id_fkey
  FOREIGN KEY (base_item_id) REFERENCES base_items(id) ON DELETE CASCADE;

-- 2.4) インデックス名を更新
DROP INDEX IF EXISTS idx_vendor_products_raw_item;
CREATE INDEX IF NOT EXISTS idx_vendor_products_base_item ON vendor_products (base_item_id);

-- =========================================================
-- 3) items テーブルの変更
-- =========================================================

-- 3.1) 既存の制約を削除
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_raw_has_row_item,
  DROP CONSTRAINT IF EXISTS chk_items_raw_fields_new,
  DROP CONSTRAINT IF EXISTS chk_items_prepped_fields_new;

-- 3.2) 既存の外部キー制約を削除（row_item_idがvendor_productsを参照している場合）
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_row_item_id_fkey;

-- 3.3) base_item_id カラムを追加（一時的にNULLを許可）
ALTER TABLE items
  ADD COLUMN base_item_id uuid REFERENCES base_items(id) ON DELETE SET NULL;

-- 3.4) 既存データがある場合、base_item_idを更新
-- 注意: 既存データがない場合は、このセクションをスキップしてください
-- vendor_products経由でbase_item_idを取得して更新
-- 以前の構造: items.row_item_id → vendor_products.id → vendor_products.raw_item_id → raw_items.id
-- 新しい構造: items.base_item_id → base_items.id (vendor_products.base_item_idと同じ)
-- 
-- row_item_idがまだ存在する場合（migration_vendor_products.sqlが実行済みの場合）
UPDATE items i
SET base_item_id = vp.base_item_id
FROM vendor_products vp
WHERE i.item_kind = 'raw'
  AND i.row_item_id IS NOT NULL
  AND vp.id = i.row_item_id
  AND i.base_item_id IS NULL;

-- row_item_idが存在しない場合（名前でマッチング）
UPDATE items i
SET base_item_id = vp.base_item_id
FROM vendor_products vp
WHERE i.item_kind = 'raw'
  AND i.base_item_id IS NULL
  AND (
    i.name = COALESCE(vp.product_name, '')
    OR i.name = (
      SELECT name FROM base_items WHERE id = vp.base_item_id
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM items i2 
    WHERE i2.id != i.id 
    AND i2.base_item_id = vp.base_item_id
  );

-- 3.5) 既存のインデックスを削除
DROP INDEX IF EXISTS idx_items_row_item;

-- 3.6) row_item_id カラムを削除
ALTER TABLE items
  DROP COLUMN IF EXISTS row_item_id;

-- 3.7) 新しい制約を追加
-- raw itemの場合：base_item_idは必須、proceed_yield_*はNULL
-- prepped itemの場合：proceed_yield_*は必須、base_item_idはNULL
ALTER TABLE items
  ADD CONSTRAINT chk_items_raw_has_base_item
  CHECK (
    item_kind <> 'raw' OR base_item_id IS NOT NULL
  ),
  ADD CONSTRAINT chk_items_raw_fields_new CHECK (
    item_kind <> 'raw' OR (
      base_item_id IS NOT NULL AND
      proceed_yield_amount IS NULL AND
      proceed_yield_unit IS NULL
    )
  ),
  ADD CONSTRAINT chk_items_prepped_fields_new CHECK (
    item_kind <> 'prepped' OR (
      proceed_yield_amount IS NOT NULL AND
      proceed_yield_amount > 0 AND
      proceed_yield_unit IS NOT NULL AND
      base_item_id IS NULL
    )
  );

-- 3.8) 新しいインデックスを追加
CREATE INDEX IF NOT EXISTS idx_items_base_item ON items (base_item_id);

-- =========================================================
-- 完了
-- =========================================================

