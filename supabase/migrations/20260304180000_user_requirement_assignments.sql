-- =========================================================
-- user_requirement_assignments: 適用状態の管理
-- 設計: docs/requirement_assignment_design.txt
-- 要件はテナントに属さず created_by（作成者）に属する。
-- user_requirements に tenant_id は持たせない（本マイグレーションでは触れない）。
-- =========================================================

-- -----------------------------------------------------------
-- 1. user_requirement_assignments テーブル
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_requirement_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_requirement_id uuid NULL REFERENCES public.user_requirements(id) ON DELETE SET NULL,
  is_currently_assigned boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

COMMENT ON TABLE public.user_requirement_assignments IS '誰にどの要件を適用しているか。適用の有無は mapping の有無では判断しない';
COMMENT ON COLUMN public.user_requirement_assignments.is_currently_assigned IS 'true=適用中, false=Remove済み。Addでtrueに戻す';
COMMENT ON COLUMN public.user_requirement_assignments.deleted_at IS '参照している要件が Requirements List から削除された日時。NULL=要件はまだ存在';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_requirement_assignments_user_req
  ON public.user_requirement_assignments(user_id, user_requirement_id);

CREATE INDEX IF NOT EXISTS idx_user_requirement_assignments_user_id
  ON public.user_requirement_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_requirement_assignments_user_requirement_id
  ON public.user_requirement_assignments(user_requirement_id);

-- -----------------------------------------------------------
-- 2. トリガー: 新メンバーが profiles に登録されたとき
--    そのテナントの admin（role=admin）のいずれかが created_by である要件を取得し、
--    各要件について user_requirement_assignments に 1 行ずつ INSERT
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.after_profiles_insert_assign_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_requirement_assignments (user_id, user_requirement_id, is_currently_assigned, created_at, deleted_at)
  SELECT
    NEW.user_id,
    ur.id,
    true,
    now(),
    NULL
  FROM public.user_requirements ur
  WHERE ur.created_by IN (
    SELECT p.user_id FROM public.profiles p
    WHERE p.tenant_id = NEW.tenant_id AND p.role = 'admin'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS after_profiles_insert_assign_requirements ON public.profiles;
CREATE TRIGGER after_profiles_insert_assign_requirements
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.after_profiles_insert_assign_requirements();

-- -----------------------------------------------------------
-- 3. Grants（他テーブルと同様）
-- -----------------------------------------------------------
GRANT ALL ON TABLE public.user_requirement_assignments TO anon;
GRANT ALL ON TABLE public.user_requirement_assignments TO authenticated;
GRANT ALL ON TABLE public.user_requirement_assignments TO service_role;
