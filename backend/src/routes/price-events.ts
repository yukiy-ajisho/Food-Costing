import { Router } from "express";
import { supabase } from "../config/supabase";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import {
  getUnifiedTenantResource,
  getUnifiedVendorProductResource,
} from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

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

      const { data, error } = await supabase
        .from("price_events")
        .insert([
          {
            tenant_id: selectedTenantId,
            virtual_vendor_product_id: id,
            price,
            source_type: "manual",
            user_id: req.user!.id,
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

export default router;
