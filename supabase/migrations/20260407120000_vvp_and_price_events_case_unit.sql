-- ============================================================
-- case_unit 対応: virtual_vendor_products + price_events
-- ============================================================

-- 1-a: virtual_vendor_products に case_unit 列を追加
ALTER TABLE public.virtual_vendor_products
  ADD COLUMN IF NOT EXISTS case_unit integer;

-- case_unit > 0 制約（NULL は許容 = ばら前提の既存行）
ALTER TABLE public.virtual_vendor_products
  ADD CONSTRAINT vvp_case_unit_positive CHECK (case_unit > 0);

-- 既存の unique 制約を削除して case_unit 込みの式 unique に置き換える
DROP INDEX IF EXISTS public.uq_virtual_vendor_products_unique;

CREATE UNIQUE INDEX uq_virtual_vendor_products_unique
  ON public.virtual_vendor_products (vendor_id, product_name, tenant_id, COALESCE(case_unit, 0))
  WHERE product_name IS NOT NULL;

-- 1-b: price_events に 3 列を追加
ALTER TABLE public.price_events
  ADD COLUMN IF NOT EXISTS case_unit      integer,
  ADD COLUMN IF NOT EXISTS case_purchased integer,
  ADD COLUMN IF NOT EXISTS unit_purchased integer;

-- case_unit / case_purchased / unit_purchased はすべて > 0 制約
ALTER TABLE public.price_events
  ADD CONSTRAINT pe_case_unit_positive      CHECK (case_unit > 0),
  ADD CONSTRAINT pe_case_purchased_positive CHECK (case_purchased > 0),
  ADD CONSTRAINT pe_unit_purchased_positive CHECK (unit_purchased > 0);

-- 既存行（旧データ）を unit_purchased = 1 に UPDATE する
-- trg_prevent_price_events_update があるため、一時的にトリガーを無効化する
ALTER TABLE public.price_events DISABLE TRIGGER USER;
UPDATE public.price_events SET unit_purchased = 1 WHERE unit_purchased IS NULL;
ALTER TABLE public.price_events ENABLE TRIGGER USER;

-- 1-c: 3 列すべて NULL を禁止（UPDATE 後は全行が NULL でないため全行対象）
ALTER TABLE public.price_events
  ADD CONSTRAINT pe_purchase_qty_not_all_null
    CHECK (
      case_unit IS NOT NULL
      OR case_purchased IS NOT NULL
      OR unit_purchased IS NOT NULL
    );
