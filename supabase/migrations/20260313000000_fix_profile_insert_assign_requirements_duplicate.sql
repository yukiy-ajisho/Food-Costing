-- =========================================================
-- 修正: profiles 挿入時の user_requirement_assignments 重複エラー
-- 同一 (user_id, user_requirement_id) が既に存在する場合は INSERT をスキップする。
-- これにより、admin が新テナントを作成して自分がメンバーになる際に重複で失敗しなくなる。
-- =========================================================

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
  )
  ON CONFLICT (user_id, user_requirement_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.after_profiles_insert_assign_requirements() OWNER TO "postgres";
