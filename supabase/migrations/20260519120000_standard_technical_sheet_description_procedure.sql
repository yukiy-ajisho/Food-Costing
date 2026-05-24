-- Description and procedure live on the version row, not in snapshot JSONB.

ALTER TABLE public.standard_technical_sheets
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS procedure text;

COMMENT ON COLUMN public.standard_technical_sheets.description IS
  'Standard TS description for this version. v0 is NULL until set via Update.';
COMMENT ON COLUMN public.standard_technical_sheets.procedure IS
  'Standard TS procedure for this version. v0 is NULL until set via Update.';

-- Drop legacy display_meta from existing snapshots (do not copy to columns).
UPDATE public.standard_technical_sheets
SET snapshot = snapshot - 'display_meta'
WHERE snapshot ? 'display_meta';

DROP FUNCTION IF EXISTS public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.insert_standard_technical_sheet_version_atomic(
  p_tenant_id uuid,
  p_source_item_id uuid,
  p_snapshot jsonb,
  p_created_by uuid,
  p_description text DEFAULT NULL,
  p_procedure text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  version_number integer,
  is_latest boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version integer;
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_source_item_id IS NULL OR p_snapshot IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'tenant_id, source_item_id, snapshot, and created_by are required';
  END IF;

  SELECT COALESCE(MAX(s.version_number), -1) + 1
  INTO v_version
  FROM public.standard_technical_sheets s
  WHERE s.tenant_id = p_tenant_id
    AND s.source_item_id = p_source_item_id;

  UPDATE public.standard_technical_sheets sts
  SET is_latest = false
  WHERE sts.tenant_id = p_tenant_id
    AND sts.source_item_id = p_source_item_id
    AND sts.is_latest = true;

  INSERT INTO public.standard_technical_sheets (
    tenant_id,
    source_item_id,
    version_number,
    is_latest,
    snapshot,
    created_by,
    description,
    procedure
  )
  VALUES (
    p_tenant_id,
    p_source_item_id,
    v_version,
    true,
    p_snapshot,
    p_created_by,
    NULLIF(TRIM(p_description), ''),
    NULLIF(TRIM(p_procedure), '')
  )
  RETURNING standard_technical_sheets.id INTO v_id;

  RETURN QUERY
  SELECT v_id, v_version, true;
END;
$$;

COMMENT ON FUNCTION public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid, text, text) IS
  'Append a Standard TS version and clear prior is_latest in one transaction.';

GRANT EXECUTE ON FUNCTION public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_standard_technical_sheet_v0_if_absent(
  p_tenant_id uuid,
  p_source_item_id uuid,
  p_snapshot jsonb,
  p_created_by uuid
)
RETURNS TABLE(
  id uuid,
  version_number integer,
  is_latest boolean,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_version integer;
  v_is_latest boolean;
BEGIN
  IF p_tenant_id IS NULL OR p_source_item_id IS NULL OR p_snapshot IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'tenant_id, source_item_id, snapshot, and created_by are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tenant_id::text || ':' || p_source_item_id::text)
  );

  SELECT s.id, s.version_number, s.is_latest
  INTO v_id, v_version, v_is_latest
  FROM public.standard_technical_sheets s
  WHERE s.tenant_id = p_tenant_id
    AND s.source_item_id = p_source_item_id
    AND s.is_latest = true
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_version, v_is_latest, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.standard_technical_sheets s
    WHERE s.tenant_id = p_tenant_id
      AND s.source_item_id = p_source_item_id
  ) THEN
    SELECT s.id, s.version_number, s.is_latest
    INTO v_id, v_version, v_is_latest
    FROM public.standard_technical_sheets s
    WHERE s.tenant_id = p_tenant_id
      AND s.source_item_id = p_source_item_id
    ORDER BY s.version_number DESC
    LIMIT 1;

    RETURN QUERY SELECT v_id, v_version, v_is_latest, false;
    RETURN;
  END IF;

  INSERT INTO public.standard_technical_sheets (
    tenant_id,
    source_item_id,
    version_number,
    is_latest,
    snapshot,
    created_by,
    description,
    procedure
  )
  VALUES (
    p_tenant_id,
    p_source_item_id,
    0,
    true,
    p_snapshot,
    p_created_by,
    NULL,
    NULL
  )
  RETURNING standard_technical_sheets.id INTO v_id;

  RETURN QUERY SELECT v_id, 0, true, true;
END;
$$;
