import { Router } from "express";
import { supabase } from "../config/supabase";
import { Vendor } from "../types/database";
import { authorizationMiddleware } from "../middleware/authorization";
import { getCollectionResource } from "../middleware/resource-helpers";

const router = Router();

/**
 * GET /vendors
 * 全Vendorsを取得
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) =>
    getCollectionResource(req, "vendor")
  ),
  async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .in("tenant_id", req.user!.tenant_ids)
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /vendors/:id
 * VendorをIDで取得
 */
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids)
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /vendors
 * Vendorを作成
 */
router.post("/", async (req, res) => {
  try {
    const vendor: Partial<Vendor> = req.body;

    // バリデーション
    if (!vendor.name) {
      return res.status(400).json({ error: "name is required" });
    }

    // tenant_idを自動設定
    const vendorWithTenantId = {
      ...vendor,
      tenant_id: req.user!.tenant_ids[0], // Phase 2で改善予定
    };

    const { data, error } = await supabase
      .from("vendors")
      .insert([vendorWithTenantId])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /vendors/:id
 * Vendorを更新
 */
router.put("/:id", async (req, res) => {
  try {
    const vendor: Partial<Vendor> = req.body;
    const { id } = req.params;

    // user_idとtenant_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user_id: _user_id, tenant_id: _tenant_id, id: _id, ...vendorWithoutIds } = vendor;
    const { data, error } = await supabase
      .from("vendors")
      .update(vendorWithoutIds)
      .eq("id", id)
      .in("tenant_id", req.user!.tenant_ids)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /vendors/:id
 * Vendorを削除
 */
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("vendors")
      .delete()
      .eq("id", req.params.id)
      .in("tenant_id", req.user!.tenant_ids);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
