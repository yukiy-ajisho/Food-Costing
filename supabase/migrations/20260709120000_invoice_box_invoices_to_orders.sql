-- Rename invoice_box_invoices → orders (Order model / Phase 1).
-- RPC: save_invoicing_box_invoice_atomic → save_order_atomic

ALTER TABLE public.invoice_box_invoices RENAME TO orders;

ALTER TABLE public.orders RENAME COLUMN invoice_date TO order_created_date;
ALTER TABLE public.orders RENAME COLUMN sent_at TO first_invoice_sent_at;

ALTER INDEX IF EXISTS idx_invoice_box_invoices_tenant_id
  RENAME TO idx_orders_tenant_id;
ALTER INDEX IF EXISTS idx_invoice_box_invoices_list_id
  RENAME TO idx_orders_list_id;
ALTER INDEX IF EXISTS idx_invoice_box_invoices_invoice_date
  RENAME TO idx_orders_order_created_date;

ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_pkey TO orders_pkey;
ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_tenant_number_unique TO orders_tenant_number_unique;
ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_created_by_fkey TO orders_created_by_fkey;
ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_delivery_site_id_fkey TO orders_delivery_site_id_fkey;
ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_list_id_fkey TO orders_list_id_fkey;
ALTER TABLE public.orders
  RENAME CONSTRAINT invoice_box_invoices_tenant_id_fkey TO orders_tenant_id_fkey;

COMMENT ON TABLE public.orders IS 'Invoicing: saved order snapshot. Invoice PDF is derived; not stored.';
COMMENT ON COLUMN public.orders.order_created_date IS 'Order creation date (calendar date).';
COMMENT ON COLUMN public.orders.first_invoice_sent_at IS 'First invoice email send timestamp (UTC).';
COMMENT ON COLUMN public.orders.list_name IS
  'Snapshot of invoice_lists.name at save time (Delivery List Template name).';

DROP POLICY IF EXISTS invoice_box_invoices_tenant_access ON public.orders;
CREATE POLICY orders_tenant_access ON public.orders
  FOR ALL
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

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

CREATE OR REPLACE FUNCTION public.save_order_atomic(
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
  p_order_created_date date,
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
  v_order public.orders;
  v_list_name text;
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

  SELECT il.name
  INTO v_list_name
  FROM public.invoice_lists il
  WHERE il.id = p_list_id
    AND il.tenant_id = p_tenant_id
    AND il.delivery_site_id = p_delivery_site_id;

  IF v_list_name IS NULL THEN
    RAISE EXCEPTION 'Invoice list not found or delivery site mismatch';
  END IF;

  INSERT INTO public.orders (
    tenant_id,
    invoice_number,
    list_id,
    list_name,
    delivery_site_id,
    delivery_site_name,
    delivery_email,
    company_name,
    order_received_date,
    delivery_date,
    order_created_date,
    total_amount,
    first_invoice_sent_at,
    lines,
    created_by
  )
  VALUES (
    p_tenant_id,
    p_invoice_number,
    p_list_id,
    v_list_name,
    p_delivery_site_id,
    p_delivery_site_name,
    p_delivery_email,
    COALESCE(NULLIF(trim(p_company_name), ''), ''),
    p_order_received_date,
    p_delivery_date,
    p_order_created_date,
    p_total_amount,
    NULL,
    p_lines,
    p_user_id
  )
  RETURNING * INTO v_order;

  UPDATE public.invoice_lists
  SET lines = p_updated_list_lines,
      updated_at = now()
  WHERE id = p_list_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update invoice list lines';
  END IF;

  RETURN to_jsonb(v_order);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_order_atomic(
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
) TO authenticated, service_role;
