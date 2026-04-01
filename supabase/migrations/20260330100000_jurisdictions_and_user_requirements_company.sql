-- Jurisdictions, user_jurisdictions, user_requirements.company_id + jurisdiction_id
-- Replaces blind auto-assign on profiles with profile insert + matching user_jurisdictions only.

-- ---------------------------------------------------------------------------
-- 1. jurisdictions
-- ---------------------------------------------------------------------------
CREATE TABLE public.jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_jurisdictions_company_lower_name
  ON public.jurisdictions (company_id, lower(btrim(name)));

COMMENT ON TABLE public.jurisdictions IS 'Employee requirements: 管轄ラベル（会社スコープ）';
COMMENT ON COLUMN public.jurisdictions.company_id IS 'ヘッダー company プルダウンと一致';

-- ---------------------------------------------------------------------------
-- 2. user_jurisdictions (PK: company_id, user_id, jurisdiction_id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_jurisdictions (
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES public.jurisdictions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, jurisdiction_id)
);

CREATE INDEX idx_user_jurisdictions_user_id ON public.user_jurisdictions (user_id);
CREATE INDEX idx_user_jurisdictions_jurisdiction_id ON public.user_jurisdictions (jurisdiction_id);

COMMENT ON TABLE public.user_jurisdictions IS '従業員（profiles 利用者）に付与した管轄';

CREATE OR REPLACE FUNCTION public.user_jurisdictions_company_match () RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.jurisdictions j
    WHERE j.id = NEW.jurisdiction_id
      AND j.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'user_jurisdictions: jurisdiction_id does not belong to company_id';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_jurisdictions_company_match_biub
  BEFORE INSERT OR UPDATE ON public.user_jurisdictions
  FOR EACH ROW
  EXECUTE FUNCTION public.user_jurisdictions_company_match ();

-- ---------------------------------------------------------------------------
-- 3. user_requirements: add company + jurisdiction (nullable → backfill → NOT NULL)
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_requirements
  ADD COLUMN company_id uuid REFERENCES public.companies (id) ON DELETE CASCADE,
  ADD COLUMN jurisdiction_id uuid REFERENCES public.jurisdictions (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.user_requirements.company_id IS '要件が属する会社（選択ヘッダーと一致）';
COMMENT ON COLUMN public.user_requirements.jurisdiction_id IS 'この要件が適用される管轄';
COMMENT ON TABLE public.user_requirements IS '従業員向け要件（会社＋管轄でスコープ）';

-- Backfill: 作成者の company_admin/company_director 所属会社ごとに 1 件「Default (migrated)」管轄
INSERT INTO public.jurisdictions (id, company_id, name, created_by, created_at, updated_at)
SELECT gen_random_uuid (),
  d.company_id,
  'Default (migrated)',
  (SELECT cm.user_id
   FROM public.company_members cm
   WHERE cm.company_id = d.company_id
     AND cm.role = 'company_admin'
   ORDER BY cm.created_at
   LIMIT 1),
  now(),
  now()
FROM (
  SELECT DISTINCT cm.company_id
  FROM public.user_requirements ur
  INNER JOIN public.company_members cm ON cm.user_id = ur.created_by
    AND cm.role IN ('company_admin', 'company_director')
) d
WHERE NOT EXISTS (
    SELECT 1
    FROM public.jurisdictions j
    WHERE j.company_id = d.company_id
      AND lower(btrim(j.name)) = lower(btrim('Default (migrated)'))
  );

UPDATE public.user_requirements ur
SET company_id = sub.company_id,
    jurisdiction_id = j.id
FROM (
  SELECT ur2.id AS rid,
    (SELECT cm.company_id
     FROM public.company_members cm
     WHERE cm.user_id = ur2.created_by
       AND cm.role IN ('company_admin', 'company_director')
     ORDER BY cm.company_id
     LIMIT 1) AS company_id
  FROM public.user_requirements ur2
  WHERE ur2.created_by IS NOT NULL
) sub
INNER JOIN public.jurisdictions j ON j.company_id = sub.company_id
  AND lower(btrim(j.name)) = lower(btrim('Default (migrated)'))
WHERE ur.id = sub.rid
  AND sub.company_id IS NOT NULL;

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_requirements
  WHERE company_id IS NULL OR jurisdiction_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'user_requirements backfill incomplete: % row(s) still lack company_id/jurisdiction_id (check created_by / company_members)', n;
  END IF;
END $$;

ALTER TABLE public.user_requirements
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN jurisdiction_id SET NOT NULL;

CREATE INDEX idx_user_requirements_company_id ON public.user_requirements (company_id);
CREATE INDEX idx_user_requirements_jurisdiction_id ON public.user_requirements (jurisdiction_id);

-- ---------------------------------------------------------------------------
-- 4. profiles INSERT トリガ: 管轄が一致する要件への割当のみ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.after_profiles_insert_assign_requirements () RETURNS TRIGGER
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
  INNER JOIN public.company_tenants ct ON ct.tenant_id = NEW.tenant_id
    AND ct.company_id = ur.company_id
  INNER JOIN public.user_jurisdictions uj ON uj.company_id = ur.company_id
    AND uj.user_id = NEW.user_id
    AND uj.jurisdiction_id = ur.jurisdiction_id
  ON CONFLICT (user_id, user_requirement_id)
    DO UPDATE SET
      is_currently_assigned = true,
      deleted_at = NULL;

  RETURN NEW;
END;
$$;

GRANT ALL ON TABLE public.jurisdictions TO anon;
GRANT ALL ON TABLE public.jurisdictions TO authenticated;
GRANT ALL ON TABLE public.jurisdictions TO service_role;

GRANT ALL ON TABLE public.user_jurisdictions TO anon;
GRANT ALL ON TABLE public.user_jurisdictions TO authenticated;
GRANT ALL ON TABLE public.user_jurisdictions TO service_role;
