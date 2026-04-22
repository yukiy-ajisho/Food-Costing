import { Router } from "express";
import { supabase } from "../config/supabase";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import {
  getUnifiedTenantResource,
  getUnifiedVendorProductResource,
} from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";
import { utcMidnightIsoFromYyyyMmDd } from "../utils/invoiceEffectiveTimestamp";

const router = Router();

/**
 * case_unit / case_purchased / unit_purchased を body から取り出してバリデーションする。
 * 3列すべて省略された場合は unit_purchased = 1（ばら1個）とみなす。
 */
function parsePurchaseFields(body: Record<string, unknown>): {
  error?: string;
  fields: {
    case_unit: number | null;
    case_purchased: number | null;
    unit_purchased: number | null;
  };
} {
  const toPositiveIntOrNull = (
    v: unknown
  ): { ok: true; value: number | null } | { ok: false; raw: string } => {
    if (v === undefined || v === null || v === "") return { ok: true, value: null };
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, raw: String(v) };
    return { ok: true, value: n };
  };

  const cuR = toPositiveIntOrNull(body?.case_unit);
  if (!cuR.ok)
    return {
      error: "case_unit must be a positive integer",
      fields: { case_unit: null, case_purchased: null, unit_purchased: null },
    };

  const cpR = toPositiveIntOrNull(body?.case_purchased);
  if (!cpR.ok)
    return {
      error: "case_purchased must be a positive integer",
      fields: { case_unit: null, case_purchased: null, unit_purchased: null },
    };

  const upR = toPositiveIntOrNull(body?.unit_purchased);
  if (!upR.ok)
    return {
      error: "unit_purchased must be a positive integer",
      fields: { case_unit: null, case_purchased: null, unit_purchased: null },
    };

  const cu = cuR.value;
  const cp = cpR.value;
  const up = upR.value;

  // 3列すべて省略 → ばら1個扱い
  if (cu === null && cp === null && up === null) {
    return { fields: { case_unit: null, case_purchased: null, unit_purchased: 1 } };
  }

  return { fields: { case_unit: cu, case_purchased: cp, unit_purchased: up } };
}

export type PriceHistoryRow = {
  price_event_id: string;
  price: number;
  source_type: string;
  invoice_id: string | null;
  created_at: string;
  virtual_vendor_product_id: string;
  base_item_names: string;
  product_name: string | null;
  brand_name: string | null;
  purchase_quantity: number | null;
  purchase_unit: string | null;
  case_unit: number | null;
  case_purchased: number | null;
  unit_purchased: number | null;
};

/**
 * GET /price-events/history
 * 選択テナントの価格イベントを VVP・base item 名と合わせて返す（新しい順）
 */
router.get(
  "/history",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      let eventsQuery = supabase
        .from("price_events")
        .select(
          `
          id,
          price,
          source_type,
          invoice_id,
          created_at,
          virtual_vendor_product_id,
          case_unit,
          case_purchased,
          unit_purchased,
          virtual_vendor_products (
            product_name,
            brand_name,
            purchase_quantity,
            purchase_unit
          )
        `
        )
        .order("created_at", { ascending: false });

      eventsQuery = withTenantFilter(eventsQuery, req);

      const { data: events, error: eventsError } = await eventsQuery;

      if (eventsError) {
        return res.status(500).json({ error: eventsError.message });
      }

      const vvpIds = [
        ...new Set(
          (events ?? []).map((e) => e.virtual_vendor_product_id as string)
        ),
      ];

      const nameByVvp = new Map<string, Set<string>>();
      if (vvpIds.length > 0) {
        let mappingsQuery = supabase
          .from("product_mappings")
          .select(
            `
            virtual_product_id,
            base_items ( name )
          `
          )
          .in("virtual_product_id", vvpIds);

        mappingsQuery = withTenantFilter(mappingsQuery, req);

        const { data: mappings, error: mapError } = await mappingsQuery;

        if (mapError) {
          return res.status(500).json({ error: mapError.message });
        }

        for (const row of mappings ?? []) {
          const vpid = row.virtual_product_id as string;
          const bi = row.base_items as { name?: string } | null;
          const n = bi?.name;
          if (!n) continue;
          if (!nameByVvp.has(vpid)) nameByVvp.set(vpid, new Set());
          nameByVvp.get(vpid)!.add(n);
        }
      }

      const rows: PriceHistoryRow[] = (events ?? []).map((ev) => {
        const vvpRaw = ev.virtual_vendor_products;
        const vp = Array.isArray(vvpRaw) ? vvpRaw[0] : vvpRaw;
        const vpid = ev.virtual_vendor_product_id as string;
        const namesSet = nameByVvp.get(vpid);
        const base_item_names = namesSet
          ? [...namesSet].sort().join(", ")
          : "";

        return {
          price_event_id: ev.id as string,
          price: Number(ev.price),
          source_type: ev.source_type as string,
          invoice_id: (ev.invoice_id as string | null) ?? null,
          created_at: ev.created_at as string,
          virtual_vendor_product_id: vpid,
          base_item_names,
          product_name: (vp?.product_name as string | null) ?? null,
          brand_name: (vp?.brand_name as string | null) ?? null,
          purchase_quantity:
            vp?.purchase_quantity != null
              ? Number(vp.purchase_quantity)
              : null,
          purchase_unit: (vp?.purchase_unit as string | null) ?? null,
          case_unit: ev.case_unit != null ? Number(ev.case_unit) : null,
          case_purchased:
            ev.case_purchased != null ? Number(ev.case_purchased) : null,
          unit_purchased:
            ev.unit_purchased != null ? Number(ev.unit_purchased) : null,
        };
      });

      return res.json(rows);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /price-events/vendor-products/:id/manual
 * 手動価格イベントを追加（append-only）
 */
router.post(
  "/vendor-products/:id/manual",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_item,
    getUnifiedVendorProductResource
  ),
  async (req, res) => {
    try {
      const { id } = req.params;
      const priceRaw = req.body?.price;
      const price = Number(priceRaw);

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: "price must be a positive number" });
      }

      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const purchaseFields = parsePurchaseFields(req.body);
      if (purchaseFields.error) {
        return res.status(400).json({ error: purchaseFields.error });
      }

      const { data, error } = await supabase
        .from("price_events")
        .insert([
          {
            tenant_id: selectedTenantId,
            virtual_vendor_product_id: id,
            price,
            source_type: "manual",
            user_id: req.user!.id,
            ...purchaseFields.fields,
          },
        ])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.status(201).json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /price-events/vendor-products/:id/invoice
 * 請求書取り込みなどの価格イベント（append-only、source_type = invoice）
 */
router.post(
  "/vendor-products/:id/invoice",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_item,
    getUnifiedVendorProductResource
  ),
  async (req, res) => {
    try {
      const { id } = req.params;
      const priceRaw = req.body?.price;
      const price = Number(priceRaw);

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: "price must be a positive number" });
      }

      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const applyRaw = req.body?.apply_to_current_price;
      const applyToCurrent =
        applyRaw === false || applyRaw === "false" ? false : true;

      const rawInvDate = req.body?.invoice_date;
      let effectiveAt: string | undefined;
      if (
        rawInvDate !== undefined &&
        rawInvDate !== null &&
        String(rawInvDate).trim() !== ""
      ) {
        const iso = utcMidnightIsoFromYyyyMmDd(rawInvDate);
        if (!iso) {
          return res
            .status(400)
            .json({ error: "invoice_date must be YYYY-MM-DD" });
        }
        effectiveAt = iso;
      }

      const purchaseFields = parsePurchaseFields(req.body);
      if (purchaseFields.error) {
        return res.status(400).json({ error: purchaseFields.error });
      }

      const rawInvoiceId = req.body?.invoice_id;
      const invoiceId =
        typeof rawInvoiceId === "string" && rawInvoiceId.trim() !== ""
          ? rawInvoiceId.trim()
          : null;

      const insertRow: Record<string, unknown> = {
        tenant_id: selectedTenantId,
        virtual_vendor_product_id: id,
        price,
        source_type: "invoice",
        user_id: req.user!.id,
        invoice_id: invoiceId,
        apply_to_current_price: applyToCurrent,
        ...purchaseFields.fields,
      };
      if (effectiveAt !== undefined) {
        insertRow.created_at = effectiveAt;
      }

      const { data, error } = await supabase
        .from("price_events")
        .insert([insertRow])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.status(201).json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  }
);

export default router;
