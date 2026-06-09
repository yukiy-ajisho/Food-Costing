-- invoice_box_invoices.invoice_date: date → timestamptz (creation date + time, stored UTC).

ALTER TABLE public.invoice_box_invoices
  ALTER COLUMN invoice_date TYPE timestamptz
  USING (
    CASE
      WHEN invoice_date IS NULL THEN NULL
      ELSE (invoice_date::timestamp AT TIME ZONE 'UTC')
    END
  );

COMMENT ON COLUMN public.invoice_box_invoices.invoice_date IS
  'Invoice creation date/time (UTC). Display in user local timezone on clients.';

DROP FUNCTION IF EXISTS public.save_invoicing_box_invoice_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  date,
  numeric,
  jsonb,
  jsonb
);

CREATE OR REPLACE FUNCTION public.save_invoicing_box_invoice_atomic(
  p_tenant_id uuid,
  p_user_id uuid,
  p_list_id uuid,
  p_delivery_site_id uuid,
  p_invoice_number text,
  p_delivery_site_name text,
  p_delivery_email text,
  p_company_name text,
  p_order_received_date date,
  p_delivery_date date,
  p_invoice_date timestamptz,
  p_total_amount numeric,
  p_lines jsonb,
  p_updated_list_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoice_box_invoices;
BEGIN
  IF p_tenant_id IS NULL OR p_list_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and list_id are required';
  END IF;

  IF p_invoice_number IS NULL OR trim(p_invoice_number) = '' THEN
    RAISE EXCEPTION 'invoice_number is required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be a JSON array';
  END IF;

  IF p_updated_list_lines IS NULL OR jsonb_typeof(p_updated_list_lines) <> 'array' THEN
    RAISE EXCEPTION 'updated_list_lines must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invoice_lists il
    WHERE il.id = p_list_id
      AND il.tenant_id = p_tenant_id
      AND il.delivery_site_id = p_delivery_site_id
  ) THEN
    RAISE EXCEPTION 'Invoice list not found or delivery site mismatch';
  END IF;

  INSERT INTO public.invoice_box_invoices (
    tenant_id,
    invoice_number,
    list_id,
    delivery_site_id,
    delivery_site_name,
    delivery_email,
    company_name,
    order_received_date,
    delivery_date,
    invoice_date,
    total_amount,
    sent_at,
    lines,
    created_by
  )
  VALUES (
    p_tenant_id,
    p_invoice_number,
    p_list_id,
    p_delivery_site_id,
    p_delivery_site_name,
    p_delivery_email,
    COALESCE(NULLIF(trim(p_company_name), ''), ''),
    p_order_received_date,
    p_delivery_date,
    p_invoice_date,
    p_total_amount,
    NULL,
    p_lines,
    p_user_id
  )
  RETURNING * INTO v_invoice;

  UPDATE public.invoice_lists
  SET lines = p_updated_list_lines,
      updated_at = now()
  WHERE id = p_list_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update invoice list lines';
  END IF;

  RETURN to_jsonb(v_invoice);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_invoicing_box_invoice_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  timestamptz,
  numeric,
  jsonb,
  jsonb
) TO authenticated, service_role;
