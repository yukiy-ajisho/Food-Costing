-- Update: employee-requirements auto-assign on new profiles
-- Current behavior depends on tenant-level profiles.role='admin'.
-- Desired behavior: tenant -> company -> company_members(company_admin/company_director) -> assign to NEW.user_id.

CREATE OR REPLACE FUNCTION public.after_profiles_insert_assign_requirements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  INSERT INTO public.user_requirement_assignments (
    user_id,
    user_requirement_id,
    is_currently_assigned,
    created_at,
    deleted_at
  )
  SELECT
    NEW.user_id,
    ur.id,
    true,
    now(),
    NULL
  FROM public.user_requirements ur
  WHERE ur.created_by IN (
    SELECT cm.user_id
    FROM public.company_tenants ct
    JOIN public.company_members cm
      ON cm.company_id = ct.company_id
    WHERE ct.tenant_id = NEW.tenant_id
      AND cm.role IN ('company_admin', 'company_director')
  )
  ON CONFLICT (user_id, user_requirement_id) DO NOTHING;

  RETURN NEW;
END;
$$;

