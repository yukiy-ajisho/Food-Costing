-- =========================================================
-- tenant_requirement_value_types の欠損レコードを復元する。
-- 誤って削除した場合に実行。既に存在する name は挿入しない。
-- =========================================================

-- 基本 4 種類（既存マイグレーションで作成されるもの）
INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Due date', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Due date');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Bill date', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Bill date');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Pay date', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Pay date');

-- Validity duration（単位ごと 3 種類）
INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Validity duration (years)', 'int'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Validity duration (years)');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Validity duration (months)', 'int'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Validity duration (months)');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Validity duration (days)', 'int'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Validity duration (days)');

-- Estimated 系 4 種類
INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Estimated specific due date', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Estimated specific due date');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Estimated specific bill date', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Estimated specific bill date');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Estimated due date based on validity duration', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Estimated due date based on validity duration');

INSERT INTO public.tenant_requirement_value_types (id, name, data_type)
SELECT gen_random_uuid(), 'Estimated bill date based on validity duration', 'date'::public.tenant_requirement_data_type
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_requirement_value_types WHERE name = 'Estimated bill date based on validity duration');
