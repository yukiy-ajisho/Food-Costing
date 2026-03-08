-- =========================================================
-- User Requirements & Mapping (Reminders / 従業員向け要件)
-- =========================================================
-- - user_requirements: 要件の定義（タイトル・有効期間・期限ルール等）
-- - users: birth_day, hire_date を追加
-- - mapping_user_requirements: ユーザーと要件の紐付け（発行日・期限）
-- =========================================================

-- -----------------------------------------------------------
-- 1. user_requirements テーブル
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  validity_period integer NULL,
  first_due_date date NULL,
  renewal_advance_days integer NULL,
  expiry_rule text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_requirements IS '従業員向け要件の定義（例: Food Handler, 健康診断）。テナントごとに管理';
COMMENT ON COLUMN public.user_requirements.validity_period IS '有効期間（日数）。例: 365 = 1年';
COMMENT ON COLUMN public.user_requirements.first_due_date IS '初回期限の基準日（テンプレートとして使用する場合など）';
COMMENT ON COLUMN public.user_requirements.renewal_advance_days IS '更新リマインダーを何日前に出すか';
COMMENT ON COLUMN public.user_requirements.expiry_rule IS '期限の算出ルール（例: anniversary, calendar_year, fiscal_year）';

CREATE INDEX idx_user_requirements_tenant_id ON public.user_requirements(tenant_id);

-- -----------------------------------------------------------
-- 2. users に birth_day, hire_date を追加
-- -----------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS birth_day date NULL,
  ADD COLUMN IF NOT EXISTS hire_date date NULL;

COMMENT ON COLUMN public.users.birth_day IS '生年月日';
COMMENT ON COLUMN public.users.hire_date IS '入社日';

-- -----------------------------------------------------------
-- 3. mapping_user_requirements テーブル
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mapping_user_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_requirement_id uuid NOT NULL REFERENCES public.user_requirements(id) ON DELETE CASCADE,
  issued_date date NULL,
  deadline date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mapping_user_requirements IS 'ユーザーと要件の紐付け。同一ユーザー・同一要件で複数行可（更新履歴）';
COMMENT ON COLUMN public.mapping_user_requirements.issued_date IS '発行日・取得日・完了日';
COMMENT ON COLUMN public.mapping_user_requirements.deadline IS '期限日';

CREATE INDEX idx_mapping_user_requirements_user_id ON public.mapping_user_requirements(user_id);
CREATE INDEX idx_mapping_user_requirements_user_requirement_id ON public.mapping_user_requirements(user_requirement_id);
