-- Atomic invoice import: existing VVP price events + new VVP + mapping + invoice price event.
-- All-or-nothing per call (rollback on any row failure).

CREATE OR REPLACE FUNCTION public.record_invoice_import_atomic(
  p_tenant_id uuid,
  p_user_id uuid,
  p_operations jsonb
)
RETURNS TABLE(changed_vendor_product_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op jsonb;
  v_kind text;
  v_vp_id uuid;
  v_new_vp_id uuid;
  v_vendor_id uuid;
  v_base_item_id uuid;
  v_product_name text;
  v_brand_name text;
  v_purchase_unit text;
  v_purchase_quantity numeric;
  v_price numeric;
  v_case_unit integer;
  v_case_purchased integer;
  v_unit_purchased integer;
  v_apply_to_current boolean;
  v_invoice_id uuid;
  v_invoice_date text;
  v_effective_at timestamptz;
  v_changed_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and user_id are required';
  END IF;

  IF p_operations IS NULL OR jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'operations must be a JSON array';
  END IF;

  FOR op IN SELECT value FROM jsonb_array_elements(p_operations)
  LOOP
    v_kind := COALESCE(op->>'kind', '');
    v_case_unit := NULL;
    v_case_purchased := NULL;
    v_unit_purchased := NULL;
    v_effective_at := NULL;

    -- Optional purchase-qty fields (same semantics as API parsePurchaseFields).
    IF op ? 'case_unit' AND op->>'case_unit' IS NOT NULL AND btrim(op->>'case_unit') <> '' THEN
      v_case_unit := (op->>'case_unit')::integer;
      IF v_case_unit IS NULL OR v_case_unit <= 0 THEN
        RAISE EXCEPTION 'case_unit must be a positive integer';
      END IF;
    END IF;
    IF op ? 'case_purchased' AND op->>'case_purchased' IS NOT NULL AND btrim(op->>'case_purchased') <> '' THEN
      v_case_purchased := (op->>'case_purchased')::integer;
      IF v_case_purchased IS NULL OR v_case_purchased <= 0 THEN
        RAISE EXCEPTION 'case_purchased must be a positive integer';
      END IF;
    END IF;
    IF op ? 'unit_purchased' AND op->>'unit_purchased' IS NOT NULL AND btrim(op->>'unit_purchased') <> '' THEN
      v_unit_purchased := (op->>'unit_purchased')::integer;
      IF v_unit_purchased IS NULL OR v_unit_purchased <= 0 THEN
        RAISE EXCEPTION 'unit_purchased must be a positive integer';
      END IF;
    END IF;
    IF v_case_unit IS NULL AND v_case_purchased IS NULL AND v_unit_purchased IS NULL THEN
      v_unit_purchased := 1;
    END IF;

    v_apply_to_current := true;
    IF op ? 'apply_to_current_price' THEN
      IF lower(COALESCE(op->>'apply_to_current_price', '')) IN ('false', 'f', '0') THEN
        v_apply_to_current := false;
      END IF;
    END IF;

    v_invoice_id := NULL;
    IF op ? 'invoice_id' AND op->>'invoice_id' IS NOT NULL AND btrim(op->>'invoice_id') <> '' THEN
      v_invoice_id := (op->>'invoice_id')::uuid;
    END IF;

    v_invoice_date := NULLIF(btrim(op->>'invoice_date'), '');
    IF v_invoice_date IS NOT NULL THEN
      IF v_invoice_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'invoice_date must be YYYY-MM-DD';
      END IF;
      v_effective_at := (v_invoice_date || 'T00:00:00Z')::timestamptz;
    END IF;

    IF v_kind = 'existing' THEN
      v_vp_id := (op->>'vendor_product_id')::uuid;
      v_price := (op->>'price')::numeric;

      IF v_vp_id IS NULL THEN
        RAISE EXCEPTION 'existing operation requires vendor_product_id';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'existing operation requires price > 0';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.virtual_vendor_products vvp
        WHERE vvp.id = v_vp_id
          AND vvp.tenant_id = p_tenant_id
      ) THEN
        RAISE EXCEPTION 'vendor_product_id % is not found in tenant %', v_vp_id, p_tenant_id;
      END IF;

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id,
        invoice_id,
        apply_to_current_price,
        case_unit,
        case_purchased,
        unit_purchased,
        created_at
      )
      VALUES (
        p_tenant_id,
        v_vp_id,
        v_price,
        'invoice',
        p_user_id,
        v_invoice_id,
        v_apply_to_current,
        v_case_unit,
        v_case_purchased,
        v_unit_purchased,
        COALESCE(v_effective_at, now())
      );

      v_changed_ids := array_append(v_changed_ids, v_vp_id);

    ELSIF v_kind = 'new' THEN
      v_vendor_id := (op->>'vendor_id')::uuid;
      v_base_item_id := (op->>'base_item_id')::uuid;
      v_product_name := NULLIF(op->>'product_name', '');
      v_brand_name := NULLIF(op->>'brand_name', '');
      v_purchase_unit := op->>'purchase_unit';
      v_purchase_quantity := (op->>'purchase_quantity')::numeric;
      v_price := (op->>'price')::numeric;

      IF v_vendor_id IS NULL OR v_base_item_id IS NULL OR v_purchase_unit IS NULL OR btrim(v_purchase_unit) = '' THEN
        RAISE EXCEPTION 'new operation requires vendor_id, base_item_id, and purchase_unit';
      END IF;
      IF v_purchase_quantity IS NULL OR v_purchase_quantity <= 0 THEN
        RAISE EXCEPTION 'new operation requires purchase_quantity > 0';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'new operation requires price > 0';
      END IF;

      INSERT INTO public.virtual_vendor_products (
        vendor_id,
        product_name,
        brand_name,
        purchase_unit,
        purchase_quantity,
        current_price,
        case_unit,
        tenant_id
      )
      VALUES (
        v_vendor_id,
        v_product_name,
        v_brand_name,
        v_purchase_unit,
        v_purchase_quantity,
        v_price,
        v_case_unit,
        p_tenant_id
      )
      RETURNING id INTO v_new_vp_id;

      INSERT INTO public.product_mappings (
        base_item_id,
        virtual_product_id,
        tenant_id
      )
      VALUES (
        v_base_item_id,
        v_new_vp_id,
        p_tenant_id
      );

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id,
        invoice_id,
        apply_to_current_price,
        case_unit,
        case_purchased,
        unit_purchased,
        created_at
      )
      VALUES (
        p_tenant_id,
        v_new_vp_id,
        v_price,
        'invoice',
        p_user_id,
        v_invoice_id,
        true,
        v_case_unit,
        v_case_purchased,
        COALESCE(
          v_unit_purchased,
          CASE WHEN v_case_unit IS NULL THEN 1 ELSE NULL END
        ),
        COALESCE(v_effective_at, now())
      );

      v_changed_ids := array_append(v_changed_ids, v_new_vp_id);
    ELSE
      RAISE EXCEPTION 'operation kind must be "existing" or "new"';
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_changed_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_invoice_import_atomic(uuid, uuid, jsonb)
TO authenticated, service_role;
