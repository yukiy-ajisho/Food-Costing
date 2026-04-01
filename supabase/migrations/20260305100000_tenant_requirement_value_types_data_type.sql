-- =========================================================
-- tenant_requirement_value_types に data_type を追加し、
-- tenant_requirement_real_data から data_type を削除する。
-- 設計: 値の型（date / int）は種類定義側で持つ。
-- =========================================================

-- 1. data_type 用 enum（date, int。将来 string 等は ALTER TYPE ... ADD VALUE で追加）
CREATE TYPE public.tenant_requirement_data_type AS ENUM ('date', 'int');

-- 2. value_types に data_type カラム追加（既存行は一旦 'date'、Validity duration のみ 'int' に更新）
ALTER TABLE public.tenant_requirement_value_types
  ADD COLUMN data_type public.tenant_requirement_data_type NOT NULL DEFAULT 'date';

UPDATE public.tenant_requirement_value_types
  SET data_type = 'int'
  WHERE name = 'Validity duration';

ALTER TABLE public.tenant_requirement_value_types
  ALTER COLUMN data_type DROP DEFAULT;

COMMENT ON COLUMN public.tenant_requirement_value_types.data_type IS '値の型。date=日付, int=整数。UI の入力種別や value の解釈に使用';

-- 3. real_data から data_type 削除（型は value_types を JOIN して参照する）
ALTER TABLE public.tenant_requirement_real_data
  DROP COLUMN IF EXISTS data_type;
