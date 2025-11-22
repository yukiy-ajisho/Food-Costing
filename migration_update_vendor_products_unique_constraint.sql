-- =========================================================
-- Migration: Update vendor_products unique constraint to include user_id
-- =========================================================
-- This migration changes the unique constraint on vendor_products
-- to include user_id and fix the column name from raw_item_id to base_item_id,
-- allowing different users to have vendor products with the same combination
-- of (base_item_id, vendor_id, product_name)

-- =========================================================
-- 1) 既存の一意制約とインデックスを削除
-- =========================================================
-- 古い制約名（CONSTRAINT形式）
ALTER TABLE vendor_products DROP CONSTRAINT IF EXISTS uq_vendor_products_unique;

-- 古いインデックス名（INDEX形式）
DROP INDEX IF EXISTS uq_vendor_products_unique;

-- その他の可能性のある制約名を確認して削除
-- 注意: 実際のデータベースで確認が必要な場合は、以下を実行してください：
-- SELECT conname FROM pg_constraint WHERE conrelid = 'vendor_products'::regclass AND contype = 'u';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'vendor_products' AND indexname LIKE '%unique%';

-- =========================================================
-- 2) (base_item_id, vendor_id, product_name, user_id)の複合一意制約を追加
-- =========================================================
-- product_nameがNULLの場合は重複を許可するため、部分インデックスを使用
-- 注意: PostgreSQLでは、NULL値はUNIQUE制約では常に異なるものとして扱われるため、
-- この制約は product_name が NULL でない場合のみ適用される
CREATE UNIQUE INDEX uq_vendor_products_unique 
  ON vendor_products (base_item_id, vendor_id, product_name, user_id)
  WHERE product_name IS NOT NULL;

-- =========================================================
-- 完了
-- =========================================================
-- これにより、同じユーザー内では同じ(base_item_id, vendor_id, product_name)の組み合わせは1つだけ許可され、
-- 異なるユーザー間では同じ組み合わせのvendor productを登録できるようになります。
-- product_nameがNULLの場合は、この制約の対象外となり、重複が許可されます。

