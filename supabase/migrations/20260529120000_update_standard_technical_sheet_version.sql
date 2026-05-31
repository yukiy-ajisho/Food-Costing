-- Save this version: UPDATE an existing Standard TS row in place (append-only exception).

CREATE OR REPLACE FUNCTION public.update_standard_technical_sheet_version(
  p_id uuid,
  p_tenant_id uuid,
  p_snapshot jsonb,
  p_description text DEFAULT NULL,
  p_procedure text DEFAULT NULL
)
RETURNS TABLE(id uuid, version_number integer, is_latest boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_version integer;
  v_is_latest boolean;
BEGIN
  IF p_id IS NULL OR p_tenant_id IS NULL OR p_snapshot IS NULL THEN
    RAISE EXCEPTION 'id, tenant_id, and snapshot are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_tenant_id::text || ':' || p_id::text)
  );

  UPDATE public.standard_technical_sheets sts
  SET
    snapshot = p_snapshot,
    description = NULLIF(TRIM(p_description), ''),
    procedure = NULLIF(TRIM(p_procedure), '')
  WHERE sts.id = p_id
    AND sts.tenant_id = p_tenant_id
  RETURNING sts.version_number, sts.is_latest
  INTO v_version, v_is_latest;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'standard technical sheet not found for update';
  END IF;

  RETURN QUERY SELECT p_id, v_version, v_is_latest;
END;
$$;

COMMENT ON FUNCTION public.update_standard_technical_sheet_version(
  uuid, uuid, jsonb, text, text
) IS 'Overwrite snapshot (and description/procedure) on an existing Standard TS version row.';

GRANT ALL ON FUNCTION public.update_standard_technical_sheet_version(
  uuid, uuid, jsonb, text, text
) TO anon;
GRANT ALL ON FUNCTION public.update_standard_technical_sheet_version(
  uuid, uuid, jsonb, text, text
) TO authenticated;
GRANT ALL ON FUNCTION public.update_standard_technical_sheet_version(
  uuid, uuid, jsonb, text, text
) TO service_role;
