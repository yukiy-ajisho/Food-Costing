import { Router } from "express";
import { supabase } from "../config/supabase";
import { Vendor } from "../types/database";

const router = Router();

/**
 * GET /vendors
 * 全Vendorsを取得
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("user_id", req.user!.id)
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
      .eq("user_id", req.user!.id)
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

    // user_idを自動設定
    const vendorWithUserId = {
      ...vendor,
      user_id: req.user!.id,
    };

    const { data, error } = await supabase
      .from("vendors")
      .insert([vendorWithUserId])
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

    // user_idを更新から除外（セキュリティのため）
    const { user_id, ...vendorWithoutUserId } = vendor;
    const { data, error } = await supabase
      .from("vendors")
      .update(vendorWithoutUserId)
      .eq("id", id)
      .eq("user_id", req.user!.id)
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
      .eq("user_id", req.user!.id);

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
