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
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
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
      .single();

    if (error) {
      return res.status(404).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
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

    const { data, error } = await supabase
      .from("vendors")
      .insert([vendor])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
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

    const { data, error } = await supabase
      .from("vendors")
      .update(vendor)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
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
      .eq("id", req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
