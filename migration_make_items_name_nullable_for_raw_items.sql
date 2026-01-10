-- =========================================================
-- Migration: Make items.name nullable for Raw Items
-- =========================================================
-- This migration makes the items.name column nullable and sets
-- existing Raw Items' name to NULL, since Raw Items should use
-- base_items.name as their display name.
--
-- Rationale:
-- - Raw Items are always associated with a base_item_id
-- - The name should come from base_items.name (Single Source of Truth)
-- - This prevents synchronization issues when base_item names change
-- =========================================================

BEGIN;

-- =========================================================
-- Step 1: Make name column nullable first
-- =========================================================
-- NOT NULL制約を削除する前に、nameカラムをNULL可能にする必要がある
ALTER TABLE items
  ALTER COLUMN name DROP NOT NULL;

-- =========================================================
-- Step 2: Set existing Raw Items' name to NULL
-- =========================================================
UPDATE items
SET name = NULL
WHERE item_kind = 'raw'
  AND base_item_id IS NOT NULL
  AND name IS NOT NULL;

-- =========================================================
-- Step 3: Add check constraint to ensure Prepped Items have a name
-- =========================================================
-- Prepped Items must have a name (they don't have base_item_id)
ALTER TABLE items
  ADD CONSTRAINT chk_items_prepped_has_name
  CHECK (
    item_kind <> 'prepped' OR name IS NOT NULL
  );

COMMIT;

-- =========================================================
-- 完了
-- =========================================================
-- これにより:
-- - Raw ItemsのnameはNULLになり、base_items.nameを使用する
-- - Prepped Itemsは引き続きnameが必須
-- - ユニーク制約は引き続き有効（NULL値は複数許可される）

