import { Router } from "express";
import { supabase } from "../config/supabase";
import { LaborRole } from "../types/database";
import { authorizationMiddleware } from "../middleware/authorization";
import { getCollectionResource } from "../middleware/resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();

/**
 * GET /labor-roles
 * 全役職を取得
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) =>
    getCollectionResource(req, "labor_role")
  ),
  async (req, res) => {
    try {
      let query = supabase.from("labor_roles").select("*");
      query = withTenantFilter(query, req);
      query = query.order("name");

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /labor-roles/:id
 * 役職詳細を取得
 */
router.get("/:id", async (req, res) => {
  try {
    let query = supabase
      .from("labor_roles")
      .select("*")
      .eq("id", req.params.id);
    query = withTenantFilter(query, req);
    const { data, error } = await query.single();

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
 * POST /labor-roles
 * 役職を作成
 */
router.post("/", async (req, res) => {
  try {
    const role: Partial<LaborRole> = req.body;

    // バリデーション
    if (!role.name || !role.hourly_wage) {
      return res.status(400).json({
        error: "name and hourly_wage are required",
      });
    }

    if (role.hourly_wage <= 0) {
      return res.status(400).json({
        error: "hourly_wage must be greater than 0",
      });
    }

    // tenant_idとuser_idを自動設定（選択されたテナントを使用）
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const roleWithTenantId = {
      ...role,
      tenant_id: selectedTenantId,
      user_id: req.user!.id, // 作成者を記録
    };

    const { data, error } = await supabase
      .from("labor_roles")
      .insert([roleWithTenantId])
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
 * PUT /labor-roles/:id
 * 役職を更新
 */
router.put("/:id", async (req, res) => {
  try {
    const role: Partial<LaborRole> = req.body;
    const { id } = req.params;

    // user_idとtenant_idを更新から除外（セキュリティのため）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      user_id: _user_id,
      tenant_id: _tenant_id,
      id: _id,
      ...roleWithoutIds
    } = role;
    let query = supabase
      .from("labor_roles")
      .update(roleWithoutIds)
      .eq("id", id);
    query = withTenantFilter(query, req);
    const { data, error } = await query.select().single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Labor role not found" });
    }

    res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /labor-roles/:id
 * 役職を削除
 */
router.delete("/:id", async (req, res) => {
  try {
    let query = supabase.from("labor_roles").delete().eq("id", req.params.id);
    query = withTenantFilter(query, req);
    const { error } = await query;

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
