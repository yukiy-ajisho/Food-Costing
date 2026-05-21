-- Idempotent v0 creation with per-recipe advisory lock (prevents duplicate v0/v1 races).

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
    created_by
  )
  VALUES (
    p_tenant_id,
    p_source_item_id,
    0,
    true,
    p_snapshot,
    p_created_by
  )
  RETURNING standard_technical_sheets.id INTO v_id;

  RETURN QUERY SELECT v_id, 0, true, true;
END;
$$;

COMMENT ON FUNCTION public.ensure_standard_technical_sheet_v0_if_absent IS
  'Create version 0 only when no rows exist for (tenant, source_item). Serialized with advisory lock.';

GRANT EXECUTE ON FUNCTION public.ensure_standard_technical_sheet_v0_if_absent(uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_standard_technical_sheet_v0_if_absent(uuid, uuid, jsonb, uuid) TO service_role;
