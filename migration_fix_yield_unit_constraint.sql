-- =========================================================
-- Migration: Fix chk_items_yield_unit_mass constraint
-- proceed_yield_unitが"g"と"each"の両方を許可するように修正
-- =========================================================

-- 既存のchk_items_yield_unit_mass制約を削除（存在する場合）
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS chk_items_yield_unit_mass;

-- 新しい制約を追加（"g"と"each"の両方を許可）
-- 注意: この制約は、proceed_yield_unitがNULLでない場合、
-- "g"または"each"のいずれかであることを要求します
ALTER TABLE items
  ADD CONSTRAINT chk_items_yield_unit_mass
  CHECK (
    proceed_yield_unit IS NULL OR
    proceed_yield_unit = ANY(ARRAY['g'::text, 'kg'::text, 'lb'::text, 'oz'::text, 'each'::text])
  );

-- =========================================================
-- 完了
-- =========================================================

