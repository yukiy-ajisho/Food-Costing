-- Vendor items: case_price column; edit save no longer mutates case_unit on existing rows;
-- manual price recording stores case_price and always uses unit price in price_events.price.

ALTER TABLE public.virtual_vendor_products
  ADD COLUMN IF NOT EXISTS case_price numeric;

ALTER TABLE public.virtual_vendor_products
  DROP CONSTRAINT IF EXISTS vvp_case_price_positive;

ALTER TABLE public.virtual_vendor_products
  ADD CONSTRAINT vvp_case_price_positive CHECK (case_price IS NULL OR case_price > 0);

COMMENT ON COLUMN public.virtual_vendor_products.case_price IS
  'Total price per case when case_unit is set. NULL for loose (per-unit) products. current_price remains per-unit.';

CREATE OR REPLACE FUNCTION public.save_vendor_items_edit_atomic(
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
  v_target_base uuid;
  v_mapped_base uuid;
  v_product_name text;
  v_brand_name text;
  v_purchase_unit text;
  v_purchase_quantity numeric;
  v_price numeric;
  v_case_price numeric;
  v_case_unit integer;
  v_changed_ids uuid[] := ARRAY[]::uuid[];
  v_rowcount integer;
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

    IF v_kind = 'update' THEN
      v_vp_id := (op->>'vp_id')::uuid;
      v_vendor_id := (op->>'vendor_id')::uuid;
      v_product_name := NULLIF(op->>'product_name', '');
      v_brand_name := NULLIF(op->>'brand_name', '');
      v_purchase_unit := op->>'purchase_unit';
      v_purchase_quantity := (op->>'purchase_quantity')::numeric;

      IF v_vp_id IS NULL THEN
        RAISE EXCEPTION 'update operation requires vp_id';
      END IF;
      IF v_vendor_id IS NULL THEN
        RAISE EXCEPTION 'update operation requires vendor_id';
      END IF;
      IF v_purchase_unit IS NULL OR btrim(v_purchase_unit) = '' THEN
        RAISE EXCEPTION 'update operation requires purchase_unit';
      END IF;
      IF v_purchase_quantity IS NULL OR v_purchase_quantity <= 0 THEN
        RAISE EXCEPTION 'update operation requires purchase_quantity > 0';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.virtual_vendor_products vvp
        WHERE vvp.id = v_vp_id
          AND vvp.tenant_id = p_tenant_id
      ) THEN
        RAISE EXCEPTION 'vp_id % is not found in tenant %', v_vp_id, p_tenant_id;
      END IF;

      IF op ? 'base_item_id' AND op->>'base_item_id' IS NOT NULL AND btrim(op->>'base_item_id') <> '' THEN
        v_target_base := (op->>'base_item_id')::uuid;

        SELECT pm.base_item_id
        INTO v_mapped_base
        FROM public.product_mappings pm
        WHERE pm.virtual_product_id = v_vp_id
          AND pm.tenant_id = p_tenant_id
        LIMIT 1;

        IF v_mapped_base IS DISTINCT FROM v_target_base THEN
          RAISE EXCEPTION
            'base_item_id cannot be changed for existing vendor product %',
            v_vp_id;
        END IF;
      END IF;

      -- Existing rows: case_unit / case_price / current_price are immutable in edit mode.
      UPDATE public.virtual_vendor_products vvp
      SET
        vendor_id = v_vendor_id,
        product_name = v_product_name,
        brand_name = v_brand_name,
        purchase_unit = v_purchase_unit,
        purchase_quantity = v_purchase_quantity,
        updated_at = now()
      WHERE vvp.id = v_vp_id
        AND vvp.tenant_id = p_tenant_id;

      GET DIAGNOSTICS v_rowcount = ROW_COUNT;
      IF v_rowcount = 0 THEN
        RAISE EXCEPTION 'update affected 0 rows for vp_id %', v_vp_id;
      END IF;

      v_changed_ids := array_append(v_changed_ids, v_vp_id);

    ELSIF v_kind = 'create' THEN
      v_vendor_id := (op->>'vendor_id')::uuid;
      v_target_base := (op->>'base_item_id')::uuid;
      v_product_name := NULLIF(op->>'product_name', '');
      v_brand_name := NULLIF(op->>'brand_name', '');
      v_purchase_unit := op->>'purchase_unit';
      v_purchase_quantity := (op->>'purchase_quantity')::numeric;
      v_price := (op->>'current_price')::numeric;
      v_case_unit :=
        CASE
          WHEN op ? 'case_unit' AND op->>'case_unit' IS NOT NULL AND op->>'case_unit' <> ''
            THEN (op->>'case_unit')::integer
          ELSE NULL
        END;
      v_case_price :=
        CASE
          WHEN op ? 'case_price' AND op->>'case_price' IS NOT NULL AND op->>'case_price' <> ''
            THEN (op->>'case_price')::numeric
          ELSE NULL
        END;

      IF v_vendor_id IS NULL OR v_target_base IS NULL OR v_purchase_unit IS NULL OR btrim(v_purchase_unit) = '' THEN
        RAISE EXCEPTION 'create operation requires vendor_id, base_item_id, and purchase_unit';
      END IF;
      IF v_purchase_quantity IS NULL OR v_purchase_quantity <= 0 THEN
        RAISE EXCEPTION 'create operation requires purchase_quantity > 0';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'create operation requires current_price > 0';
      END IF;
      IF v_case_unit IS NOT NULL AND v_case_unit <= 0 THEN
        RAISE EXCEPTION 'case_unit must be a positive integer';
      END IF;
      IF v_case_unit IS NOT NULL AND v_case_price IS NULL THEN
        RAISE EXCEPTION 'create operation with case_unit requires case_price';
      END IF;
      IF v_case_unit IS NULL AND v_case_price IS NOT NULL THEN
        RAISE EXCEPTION 'case_price requires case_unit';
      END IF;
      IF v_case_price IS NOT NULL AND v_case_price <= 0 THEN
        RAISE EXCEPTION 'case_price must be > 0';
      END IF;

      INSERT INTO public.virtual_vendor_products (
        vendor_id,
        product_name,
        brand_name,
        purchase_unit,
        purchase_quantity,
        current_price,
        case_unit,
        case_price,
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
        v_case_price,
        p_tenant_id
      )
      RETURNING id INTO v_new_vp_id;

      INSERT INTO public.product_mappings (
        base_item_id,
        virtual_product_id,
        tenant_id
      )
      VALUES (
        v_target_base,
        v_new_vp_id,
        p_tenant_id
      );

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id,
        case_unit,
        case_purchased,
        unit_purchased
      )
      VALUES (
        p_tenant_id,
        v_new_vp_id,
        v_price,
        'manual',
        p_user_id,
        v_case_unit,
        NULL,
        CASE WHEN v_case_unit IS NULL THEN 1 ELSE NULL END
      );

      v_changed_ids := array_append(v_changed_ids, v_new_vp_id);
    ELSE
      RAISE EXCEPTION 'operation kind must be "update" or "create", got %', v_kind;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_changed_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manual_prices_atomic(
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
  v_case_price numeric;
  v_case_unit integer;
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

    IF v_kind = 'existing' THEN
      v_vp_id := (op->>'vendor_product_id')::uuid;
      v_price := (op->>'price')::numeric;
      v_case_price :=
        CASE
          WHEN op ? 'case_price' AND op->>'case_price' IS NOT NULL AND op->>'case_price' <> ''
            THEN (op->>'case_price')::numeric
          ELSE NULL
        END;

      IF v_vp_id IS NULL THEN
        RAISE EXCEPTION 'existing operation requires vendor_product_id';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'existing operation requires price > 0';
      END IF;

      SELECT vvp.case_unit
      INTO v_case_unit
      FROM public.virtual_vendor_products vvp
      WHERE vvp.id = v_vp_id
        AND vvp.tenant_id = p_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'vendor_product_id % is not found in tenant %', v_vp_id, p_tenant_id;
      END IF;

      IF v_case_unit IS NOT NULL AND v_case_price IS NULL THEN
        RAISE EXCEPTION 'existing case product requires case_price';
      END IF;
      IF v_case_unit IS NULL AND v_case_price IS NOT NULL THEN
        RAISE EXCEPTION 'case_price is only valid for case products';
      END IF;

      INSERT INTO public.price_events (
        tenant_id,
        virtual_vendor_product_id,
        price,
        source_type,
        user_id,
        case_unit,
        case_purchased,
        unit_purchased
      )
      VALUES (
        p_tenant_id,
        v_vp_id,
        v_price,
        'manual',
        p_user_id,
        v_case_unit,
        NULL,
        CASE WHEN v_case_unit IS NULL THEN 1 ELSE NULL END
      );

      IF v_case_price IS NOT NULL THEN
        UPDATE public.virtual_vendor_products vvp
        SET case_price = v_case_price,
            updated_at = now()
        WHERE vvp.id = v_vp_id
          AND vvp.tenant_id = p_tenant_id;
      END IF;

      v_changed_ids := array_append(v_changed_ids, v_vp_id);

    ELSIF v_kind = 'new' THEN
      v_vendor_id := (op->>'vendor_id')::uuid;
      v_base_item_id := (op->>'base_item_id')::uuid;
      v_product_name := NULLIF(op->>'product_name', '');
      v_brand_name := NULLIF(op->>'brand_name', '');
      v_purchase_unit := op->>'purchase_unit';
      v_purchase_quantity := (op->>'purchase_quantity')::numeric;
      v_price := (op->>'price')::numeric;
      v_case_unit :=
        CASE
          WHEN op ? 'case_unit' AND op->>'case_unit' IS NOT NULL AND op->>'case_unit' <> ''
            THEN (op->>'case_unit')::integer
          ELSE NULL
        END;
      v_case_price :=
        CASE
          WHEN op ? 'case_price' AND op->>'case_price' IS NOT NULL AND op->>'case_price' <> ''
            THEN (op->>'case_price')::numeric
          ELSE NULL
        END;

      IF v_vendor_id IS NULL OR v_base_item_id IS NULL OR v_purchase_unit IS NULL OR btrim(v_purchase_unit) = '' THEN
        RAISE EXCEPTION 'new operation requires vendor_id, base_item_id, and purchase_unit';
      END IF;
      IF v_purchase_quantity IS NULL OR v_purchase_quantity <= 0 THEN
        RAISE EXCEPTION 'new operation requires purchase_quantity > 0';
      END IF;
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'new operation requires price > 0';
      END IF;
      IF v_case_unit IS NOT NULL AND v_case_unit <= 0 THEN
        RAISE EXCEPTION 'case_unit must be a positive integer';
      END IF;
      IF v_case_unit IS NOT NULL AND v_case_price IS NULL THEN
        RAISE EXCEPTION 'new operation with case_unit requires case_price';
      END IF;
      IF v_case_unit IS NULL AND v_case_price IS NOT NULL THEN
        RAISE EXCEPTION 'case_price requires case_unit';
      END IF;
      IF v_case_price IS NOT NULL AND v_case_price <= 0 THEN
        RAISE EXCEPTION 'case_price must be > 0';
      END IF;

      INSERT INTO public.virtual_vendor_products (
        vendor_id,
        product_name,
        brand_name,
        purchase_unit,
        purchase_quantity,
        current_price,
        case_unit,
        case_price,
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
        v_case_price,
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
        case_unit,
        case_purchased,
        unit_purchased
      )
      VALUES (
        p_tenant_id,
        v_new_vp_id,
        v_price,
        'manual',
        p_user_id,
        v_case_unit,
        NULL,
        CASE WHEN v_case_unit IS NULL THEN 1 ELSE NULL END
      );

      v_changed_ids := array_append(v_changed_ids, v_new_vp_id);
    ELSE
      RAISE EXCEPTION 'operation kind must be "existing" or "new"';
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_changed_ids;
END;
$$;
