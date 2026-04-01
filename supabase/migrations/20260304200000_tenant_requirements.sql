-- =========================================================
-- Tenant Requirements（テナント向け要件）
-- 設計: docs/tenant_requirements_design.txt
-- =========================================================

-- -----------------------------------------------------------
-- 1. tenant_requirements（要件定義）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  validity_period integer NULL,
  expiry_rule text NULL,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  warning_schedule_type text NULL,
  warning_schedule_value text NULL
);

COMMENT ON TABLE public.tenant_requirements IS 'テナント向け要件の定義（ライセンス、届出期限など）';
COMMENT ON COLUMN public.tenant_requirements.validity_period IS '有効期間（年数）';
COMMENT ON COLUMN public.tenant_requirements.expiry_rule IS '期限ルール。現状 rolling のみ';
COMMENT ON COLUMN public.tenant_requirements.warning_schedule_type IS 'notice_date | date_on | days_before_due。データ入力用、警告ロジックは後で実装';
COMMENT ON COLUMN public.tenant_requirements.warning_schedule_value IS 'date_on のとき MM/DD、days_before_due のとき日数。Notice Date のときは未使用';

CREATE INDEX IF NOT EXISTS idx_tenant_requirements_created_by ON public.tenant_requirements(created_by);

-- -----------------------------------------------------------
-- 2. mapping_tenant_requirements（実データ・履歴）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mapping_tenant_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_requirement_id uuid NOT NULL REFERENCES public.tenant_requirements(id) ON DELETE CASCADE,
  due_date date NULL,
  pay_date date NULL,
  notice_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mapping_tenant_requirements IS 'テナントごと・要件ごとの日付。1 (tenant, requirement) あたり複数行（履歴）';
COMMENT ON COLUMN public.mapping_tenant_requirements.due_date IS '期限日';
COMMENT ON COLUMN public.mapping_tenant_requirements.pay_date IS '支払日等';
COMMENT ON COLUMN public.mapping_tenant_requirements.notice_date IS '通知日等';

CREATE INDEX IF NOT EXISTS idx_mapping_tenant_requirements_tenant_id ON public.mapping_tenant_requirements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mapping_tenant_requirements_tenant_requirement_id ON public.mapping_tenant_requirements(tenant_requirement_id);
CREATE INDEX IF NOT EXISTS idx_mapping_tenant_requirements_created_at ON public.mapping_tenant_requirements(tenant_id, tenant_requirement_id, created_at DESC);

-- -----------------------------------------------------------
-- 3. tenant_requirement_assignments（適用有無）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_requirement_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_requirement_id uuid NULL REFERENCES public.tenant_requirements(id) ON DELETE SET NULL,
  is_currently_assigned boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.tenant_requirement_assignments IS 'どのテナントにどの要件を適用しているか';
COMMENT ON COLUMN public.tenant_requirement_assignments.deleted_at IS '参照している要件が一覧から削除された日時';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_requirement_assignments_tenant_req
  ON public.tenant_requirement_assignments(tenant_id, tenant_requirement_id);

CREATE INDEX IF NOT EXISTS idx_tenant_requirement_assignments_tenant_id ON public.tenant_requirement_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_requirement_assignments_tenant_requirement_id ON public.tenant_requirement_assignments(tenant_requirement_id);

-- -----------------------------------------------------------
-- 4. トリガー: profiles に admin が追加されたとき（＝テナント作成時）
--    その user（1テナント1 admin ＝ 作成者）が created_by の tenant_requirements だけを assignment に挿入
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.after_profiles_insert_assign_tenant_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    INSERT INTO public.tenant_requirement_assignments (tenant_id, tenant_requirement_id, is_currently_assigned, created_at, deleted_at)
    SELECT
      NEW.tenant_id,
      tr.id,
      true,
      now(),
      NULL
    FROM public.tenant_requirements tr
    WHERE tr.created_by = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_profiles_insert_assign_tenant_requirements ON public.profiles;
CREATE TRIGGER after_profiles_insert_assign_tenant_requirements
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.after_profiles_insert_assign_tenant_requirements();

-- -----------------------------------------------------------
-- 5. Grants
-- -----------------------------------------------------------
GRANT ALL ON TABLE public.tenant_requirements TO anon;
GRANT ALL ON TABLE public.tenant_requirements TO authenticated;
GRANT ALL ON TABLE public.tenant_requirements TO service_role;
GRANT ALL ON TABLE public.mapping_tenant_requirements TO anon;
GRANT ALL ON TABLE public.mapping_tenant_requirements TO authenticated;
GRANT ALL ON TABLE public.mapping_tenant_requirements TO service_role;
GRANT ALL ON TABLE public.tenant_requirement_assignments TO anon;
GRANT ALL ON TABLE public.tenant_requirement_assignments TO authenticated;
GRANT ALL ON TABLE public.tenant_requirement_assignments TO service_role;
