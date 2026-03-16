-- =========================================================
-- Tenant Requirements: 仕様拡張（implementation spec）
-- - Validity duration を単位ごとに 3 種類に分ける
-- - Estimated 系 4 種類を追加
-- =========================================================

-- 1. Validity duration (years), (months), (days) を追加
INSERT INTO public.tenant_requirement_value_types (id, name, data_type) VALUES
  (gen_random_uuid(), 'Validity duration (years)', 'int'),
  (gen_random_uuid(), 'Validity duration (months)', 'int'),
  (gen_random_uuid(), 'Validity duration (days)', 'int');

-- 2. 既存の "Validity duration" を参照している real_data を "Validity duration (years)" に振り替え
DO $$
DECLARE
  v_old_type_id uuid;
  v_years_type_id uuid;
BEGIN
  SELECT id INTO v_old_type_id
  FROM public.tenant_requirement_value_types
  WHERE name = 'Validity duration'
  LIMIT 1;

  SELECT id INTO v_years_type_id
  FROM public.tenant_requirement_value_types
  WHERE name = 'Validity duration (years)'
  LIMIT 1;

  IF v_old_type_id IS NOT NULL AND v_years_type_id IS NOT NULL THEN
    UPDATE public.tenant_requirement_real_data
    SET type_id = v_years_type_id
    WHERE type_id = v_old_type_id;
  END IF;
END $$;

-- 3. 旧 "Validity duration" を削除
DELETE FROM public.tenant_requirement_value_types
WHERE name = 'Validity duration';

-- 4. Estimated 系 4 種類を追加（いずれも date）
INSERT INTO public.tenant_requirement_value_types (id, name, data_type) VALUES
  (gen_random_uuid(), 'Estimated specific due date', 'date'),
  (gen_random_uuid(), 'Estimated specific bill date', 'date'),
  (gen_random_uuid(), 'Estimated due date based on validity duration', 'date'),
  (gen_random_uuid(), 'Estimated bill date based on validity duration', 'date');
