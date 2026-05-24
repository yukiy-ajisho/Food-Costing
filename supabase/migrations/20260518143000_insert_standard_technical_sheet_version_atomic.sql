-- Atomic version insert for Standard Technical Sheet (flip is_latest + insert one row).

CREATE OR REPLACE FUNCTION public.insert_standard_technical_sheet_version_atomic(
  p_tenant_id uuid,
  p_source_item_id uuid,
  p_snapshot jsonb,
  p_created_by uuid
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
    created_by
  )
  VALUES (
    p_tenant_id,
    p_source_item_id,
    v_version,
    true,
    p_snapshot,
    p_created_by
  )
  RETURNING standard_technical_sheets.id INTO v_id;

  RETURN QUERY
  SELECT v_id, v_version, true;
END;
$$;

COMMENT ON FUNCTION public.insert_standard_technical_sheet_version_atomic IS
  'Append a Standard TS version and clear prior is_latest in one transaction.';

GRANT EXECUTE ON FUNCTION public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_standard_technical_sheet_version_atomic(uuid, uuid, jsonb, uuid) TO service_role;
