import { Router } from "express";
import { supabase } from "../config/supabase";
import { ResourceShare } from "../types/database";
import { authorizationMiddleware } from "../middleware/authorization";
import {
  getCollectionResource,
  getCreateResource,
} from "../middleware/resource-helpers";

const router = Router();

/**
 * GET /resource-shares
 * 共有設定を取得（フィルター対応）
 * Query params: resource_type, resource_id, owner_tenant_id, target_type, target_id
 */
router.get(
  "/",
  authorizationMiddleware("read", (req) =>
    getCollectionResource(req, "resource_share")
  ),
  async (req, res) => {
    try {
      let query = supabase.from("resource_shares").select("*");

      // フィルター
      if (req.query.resource_type) {
        query = query.eq("resource_type", req.query.resource_type);
      }
      if (req.query.resource_id) {
        query = query.eq("resource_id", req.query.resource_id);
      }
      if (req.query.owner_tenant_id) {
        query = query.eq("owner_tenant_id", req.query.owner_tenant_id);
      } else {
        // owner_tenant_idが指定されていない場合、自分のテナントが所有するリソースの共有設定のみ取得
        query = query.in("owner_tenant_id", req.user!.tenant_ids);
      }
      if (req.query.target_type) {
        query = query.eq("target_type", req.query.target_type);
      }
      if (req.query.target_id) {
        query = query.eq("target_id", req.query.target_id);
      }

      const { data, error } = await query.order("created_at", {
        ascending: false,
      });

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
 * GET /resource-shares/:id
 * 共有設定詳細を取得
 */
router.get(
  "/:id",
  authorizationMiddleware("read", async (req) => {
    const { id } = req.params;
    if (!id) {
      return null;
    }

    const { data, error } = await supabase
      .from("resource_shares")
      .select("*")
      .eq("id", id)
      .in("owner_tenant_id", req.user!.tenant_ids)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      resource_type: "resource_share",
      owner_tenant_id: data.owner_tenant_id,
    };
  }),
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data, error } = await supabase
        .from("resource_shares")
        .select("*")
        .eq("id", id)
        .in("owner_tenant_id", req.user!.tenant_ids)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return res.status(404).json({ error: "Resource share not found" });
        }
        return res.status(500).json({ error: error.message });
      }

      if (!data) {
        return res.status(404).json({ error: "Resource share not found" });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /resource-shares
 * 共有設定を作成（Adminのみ）
 */
router.post(
  "/",
  authorizationMiddleware("create", (req) =>
    getCreateResource(req, "resource_share")
  ),
  async (req, res) => {
    try {
      const share: Partial<ResourceShare> = req.body;

      // バリデーション
      if (!share.resource_type || !share.resource_id) {
        return res.status(400).json({
          error: "resource_type and resource_id are required",
        });
      }

      if (!share.target_type) {
        return res.status(400).json({
          error: "target_type is required",
        });
      }

      if (!["tenant", "role", "user"].includes(share.target_type)) {
        return res.status(400).json({
          error: "target_type must be one of: tenant, role, user",
        });
      }

      // target_idは必須
      if (!share.target_id) {
        return res.status(400).json({
          error: "target_id is required",
        });
      }

      // target_idのバリデーション
      if (share.target_type === "role") {
        if (!["admin", "manager", "staff"].includes(share.target_id)) {
          return res.status(400).json({
            error:
              "target_id must be one of: admin, manager, staff when target_type is 'role'",
          });
        }
      } else if (share.target_type === "tenant") {
        // tenant_idの形式をチェック（UUID形式）
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(share.target_id)) {
          return res.status(400).json({
            error:
              "target_id must be a valid UUID when target_type is 'tenant'",
          });
        }
        // テナントが存在するか確認
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("id", share.target_id)
          .single();
        if (!tenant) {
          return res.status(404).json({
            error: "Target tenant not found",
          });
        }
      } else if (share.target_type === "user") {
        // user_idの形式をチェック（UUID形式）
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(share.target_id)) {
          return res.status(400).json({
            error: "target_id must be a valid UUID when target_type is 'user'",
          });
        }
        // ユーザーが存在するか確認
        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("id", share.target_id)
          .single();
        if (!user) {
          return res.status(404).json({
            error: "Target user not found",
          });
        }
      }

      // リソースが存在するか確認し、同時にowner_tenant_idを取得（パフォーマンス最適化）
      const resourceType = share.resource_type;
      const resourceId = share.resource_id;

      let ownerTenantId: string | null = null;
      let resourceUserId: string | null = null;
      let resourceResponsibleUserId: string | null = null;
      if (resourceType === "item") {
        const { data, error } = await supabase
          .from("items")
          .select("id, tenant_id, user_id, responsible_user_id")
          .eq("id", resourceId)
          .in("tenant_id", req.user!.tenant_ids)
          .single();
        if (error || !data) {
          return res.status(404).json({
            error: `Resource not found: ${resourceType} with id ${resourceId}`,
          });
        }
        ownerTenantId = data.tenant_id;
        resourceUserId = data.user_id;
        resourceResponsibleUserId = data.responsible_user_id;
      } else if (resourceType === "base_item") {
        const { data, error } = await supabase
          .from("base_items")
          .select("id, tenant_id")
          .eq("id", resourceId)
          .in("tenant_id", req.user!.tenant_ids)
          .single();
        if (error || !data) {
          return res.status(404).json({
            error: `Resource not found: ${resourceType} with id ${resourceId}`,
          });
        }
        ownerTenantId = data.tenant_id;
      } else if (resourceType === "vendor_product") {
        const { data, error } = await supabase
          .from("virtual_vendor_products")
          .select("id, tenant_id")
          .eq("id", resourceId)
          .in("tenant_id", req.user!.tenant_ids)
          .single();
        if (error || !data) {
          return res.status(404).json({
            error: `Resource not found: ${resourceType} with id ${resourceId}`,
          });
        }
        ownerTenantId = data.tenant_id;
      } else {
        return res.status(400).json({
          error: `Unsupported resource_type: ${resourceType}`,
        });
      }

      if (!ownerTenantId) {
        return res.status(404).json({
          error: "Failed to determine resource owner",
        });
      }

      // 現在のユーザーがリソースのownerであることを確認
      const currentTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const role = req.user!.roles.get(currentTenantId);
      const currentUserId = req.user!.id;

      if (ownerTenantId !== currentTenantId) {
        return res.status(403).json({
          error: "You can only share resources owned by your tenant",
        });
      }

      // 権限チェック: Admin、または作成者かつresponsible_user_idが自分、またはresponsible_user_idが自分
      const isAdmin = role === "admin";
      const isCreatorAndResponsible =
        resourceUserId === currentUserId &&
        resourceResponsibleUserId === currentUserId;
      const isResponsibleUser = resourceResponsibleUserId === currentUserId;

      if (!isAdmin && !isCreatorAndResponsible && !isResponsibleUser) {
        return res.status(403).json({
          error:
            "Only admins, creators (if they are the responsible user), or the responsible user can create resource shares",
        });
      }

      // allowed_actionsのデフォルト値を設定（空配列の場合はhide状態として許可）
      const allowedActions = share.allowed_actions || ["read"];

      // バリデーション: allowed_actionsは空配列（hide状態）、'read'、または'read'と'update'のみ
      const validActions = ["read", "update"];
      const invalidActions = allowedActions.filter(
        (action) => !validActions.includes(action)
      );
      if (invalidActions.length > 0) {
        return res.status(400).json({
          error: `allowed_actions must only contain: ${validActions.join(
            ", "
          )} (or empty array for hide state)`,
        });
      }

      // allowed_actionsが空でない場合、'read'が含まれていることを確認
      // 空配列の場合はhide状態として許可
      if (allowedActions.length > 0 && !allowedActions.includes("read")) {
        return res.status(400).json({
          error:
            "allowed_actions must include 'read' (or be empty for hide state)",
        });
      }

      // 重複チェック: 同じresource_type, resource_id, target_type, target_idの組み合わせが既に存在するか確認
      const { data: existingShares } = await supabase
        .from("resource_shares")
        .select("id")
        .eq("resource_type", resourceType)
        .eq("resource_id", resourceId)
        .eq("target_type", share.target_type)
        .eq("target_id", share.target_id)
        .eq("owner_tenant_id", ownerTenantId);

      if (existingShares && existingShares.length > 0) {
        return res.status(409).json({
          error:
            "A resource share with the same resource_type, resource_id, target_type, and target_id already exists",
        });
      }

      // 共有設定を作成
      const shareWithTenantId: Partial<ResourceShare> = {
        ...share,
        owner_tenant_id: ownerTenantId,
        allowed_actions: allowedActions,
        is_exclusion: share.is_exclusion || false,
        show_history_to_shared: share.show_history_to_shared || false,
      };

      const { data, error } = await supabase
        .from("resource_shares")
        .insert([shareWithTenantId])
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
  }
);

/**
 * PUT /resource-shares/:id
 * 共有設定を更新（Adminのみ）
 */
router.put(
  "/:id",
  authorizationMiddleware("update", async (req) => {
    const { id } = req.params;
    if (!id) {
      return null;
    }

    const { data, error } = await supabase
      .from("resource_shares")
      .select("id, owner_tenant_id")
      .eq("id", id)
      .in("owner_tenant_id", req.user!.tenant_ids)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      resource_type: "resource_share",
      owner_tenant_id: data.owner_tenant_id,
    };
  }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const share: Partial<ResourceShare> = req.body;

      // 既存の共有設定を取得
      const { data: existingShare, error: fetchError } = await supabase
        .from("resource_shares")
        .select("*")
        .eq("id", id)
        .in("owner_tenant_id", req.user!.tenant_ids)
        .single();

      if (fetchError || !existingShare) {
        return res.status(404).json({ error: "Resource share not found" });
      }

      // リソースのuser_idとresponsible_user_idを取得（権限チェック用）
      const currentTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const role = req.user!.roles.get(currentTenantId);
      const currentUserId = req.user!.id;
      let resourceUserId: string | null = null;
      let resourceResponsibleUserId: string | null = null;

      if (existingShare.resource_type === "item") {
        const { data: resourceData, error: resourceError } = await supabase
          .from("items")
          .select("user_id, responsible_user_id")
          .eq("id", existingShare.resource_id)
          .eq("tenant_id", currentTenantId)
          .single();
        if (!resourceError && resourceData) {
          resourceUserId = resourceData.user_id;
          resourceResponsibleUserId = resourceData.responsible_user_id;
        }
      }

      // 権限チェック: Admin、または作成者かつresponsible_user_idが自分、またはresponsible_user_idが自分
      const isAdmin = role === "admin";
      const isCreatorAndResponsible =
        resourceUserId === currentUserId &&
        resourceResponsibleUserId === currentUserId;
      const isResponsibleUser = resourceResponsibleUserId === currentUserId;

      if (!isAdmin && !isCreatorAndResponsible && !isResponsibleUser) {
        return res.status(403).json({
          error:
            "Only admins, creators (if they are the responsible user), or the responsible user can update resource shares",
        });
      }

      // 変更不可のフィールドが送信された場合はエラーを返す
      if (
        share.resource_type !== undefined &&
        share.resource_type !== existingShare.resource_type
      ) {
        return res.status(400).json({
          error: "resource_type cannot be changed",
        });
      }

      if (
        share.resource_id !== undefined &&
        share.resource_id !== existingShare.resource_id
      ) {
        return res.status(400).json({
          error: "resource_id cannot be changed",
        });
      }

      if (
        share.owner_tenant_id !== undefined &&
        share.owner_tenant_id !== existingShare.owner_tenant_id
      ) {
        return res.status(400).json({
          error: "owner_tenant_id cannot be changed",
        });
      }

      // target_typeとtarget_idのバリデーション（更新時）
      if (share.target_type !== undefined) {
        if (!["tenant", "role", "user"].includes(share.target_type)) {
          return res.status(400).json({
            error: "target_type must be one of: tenant, role, user",
          });
        }
      }

      // 最終的なtarget_typeとtarget_idを決定（バリデーション用）
      const finalTargetType = share.target_type || existingShare.target_type;
      const finalTargetId =
        share.target_id !== undefined
          ? share.target_id
          : existingShare.target_id;

      // target_idがnullまたは空文字列の場合はエラー
      if (finalTargetId === null || finalTargetId === "") {
        return res.status(400).json({
          error: "target_id cannot be null or empty",
        });
      }

      // target_typeに応じたバリデーション（最終的な組み合わせをチェック）
      if (finalTargetType === "role") {
        if (!["admin", "manager", "staff"].includes(finalTargetId)) {
          return res.status(400).json({
            error:
              "target_id must be one of: admin, manager, staff when target_type is 'role'",
          });
        }
      } else if (finalTargetType === "tenant") {
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(finalTargetId)) {
          return res.status(400).json({
            error:
              "target_id must be a valid UUID when target_type is 'tenant'",
          });
        }
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("id", finalTargetId)
          .single();
        if (!tenant) {
          return res.status(404).json({
            error: "Target tenant not found",
          });
        }
      } else if (finalTargetType === "user") {
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(finalTargetId)) {
          return res.status(400).json({
            error: "target_id must be a valid UUID when target_type is 'user'",
          });
        }
        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("id", finalTargetId)
          .single();
        if (!user) {
          return res.status(404).json({
            error: "Target user not found",
          });
        }
      }

      // allowed_actionsのバリデーション
      if (share.allowed_actions !== undefined) {
        const validActions = ["read", "update"];
        const invalidActions = share.allowed_actions.filter(
          (action) => !validActions.includes(action)
        );
        if (invalidActions.length > 0) {
          return res.status(400).json({
            error: `allowed_actions must only contain: ${validActions.join(
              ", "
            )} (or empty array for hide state)`,
          });
        }

        // allowed_actionsが空でない場合、'read'が含まれていることを確認
        // 空配列の場合はhide状態として許可
        if (
          share.allowed_actions.length > 0 &&
          !share.allowed_actions.includes("read")
        ) {
          return res.status(400).json({
            error:
              "allowed_actions must include 'read' (or be empty for hide state)",
          });
        }
      }

      // 重複チェック: target_typeまたはtarget_idが変更された場合、新しい組み合わせで重複が発生しないか確認
      // 注意: finalTargetTypeとfinalTargetIdは上記のバリデーションで既に決定済み
      const finalResourceType = existingShare.resource_type; // resource_typeは変更不可
      const finalResourceId = existingShare.resource_id; // resource_idは変更不可
      const finalOwnerTenantId = existingShare.owner_tenant_id; // owner_tenant_idは変更不可

      // 現在のレコード以外で、同じ組み合わせが存在するかチェック
      const { data: duplicateShares } = await supabase
        .from("resource_shares")
        .select("id")
        .eq("resource_type", finalResourceType)
        .eq("resource_id", finalResourceId)
        .eq("target_type", finalTargetType)
        .eq("target_id", finalTargetId)
        .eq("owner_tenant_id", finalOwnerTenantId)
        .neq("id", id); // 現在のレコードを除外

      if (duplicateShares && duplicateShares.length > 0) {
        return res.status(409).json({
          error:
            "A resource share with the same resource_type, resource_id, target_type, and target_id already exists",
        });
      }

      // 更新可能なフィールドのみを抽出
      const updateableFields: Partial<ResourceShare> = {
        target_type: share.target_type,
        target_id: share.target_id,
        is_exclusion: share.is_exclusion,
        allowed_actions: share.allowed_actions,
        show_history_to_shared: share.show_history_to_shared,
        updated_at: new Date().toISOString(),
      };

      // undefinedのフィールドを除外
      Object.keys(updateableFields).forEach((key) => {
        if (updateableFields[key as keyof ResourceShare] === undefined) {
          delete updateableFields[key as keyof ResourceShare];
        }
      });

      const { data, error } = await supabase
        .from("resource_shares")
        .update(updateableFields)
        .eq("id", id)
        .in("owner_tenant_id", req.user!.tenant_ids)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /resource-shares/:id
 * 共有設定を削除（Adminのみ）
 */
router.delete(
  "/:id",
  authorizationMiddleware("delete", async (req) => {
    const { id } = req.params;
    if (!id) {
      return null;
    }

    const { data, error } = await supabase
      .from("resource_shares")
      .select("id, owner_tenant_id")
      .eq("id", id)
      .in("owner_tenant_id", req.user!.tenant_ids)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      resource_type: "resource_share",
      owner_tenant_id: data.owner_tenant_id,
    };
  }),
  async (req, res) => {
    try {
      const { id } = req.params;

      // 既存の共有設定を取得（権限チェック用）
      const { data: existingShare, error: fetchError } = await supabase
        .from("resource_shares")
        .select("*")
        .eq("id", id)
        .in("owner_tenant_id", req.user!.tenant_ids)
        .single();

      if (fetchError || !existingShare) {
        return res.status(404).json({ error: "Resource share not found" });
      }

      // リソースのuser_idとresponsible_user_idを取得（権限チェック用）
      const currentTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const role = req.user!.roles.get(currentTenantId);
      const currentUserId = req.user!.id;
      let resourceUserId: string | null = null;
      let resourceResponsibleUserId: string | null = null;

      if (existingShare.resource_type === "item") {
        const { data: resourceData, error: resourceError } = await supabase
          .from("items")
          .select("user_id, responsible_user_id")
          .eq("id", existingShare.resource_id)
          .eq("tenant_id", currentTenantId)
          .single();
        if (!resourceError && resourceData) {
          resourceUserId = resourceData.user_id;
          resourceResponsibleUserId = resourceData.responsible_user_id;
        }
      }

      // 権限チェック: Admin、または作成者かつresponsible_user_idが自分、またはresponsible_user_idが自分
      const isAdmin = role === "admin";
      const isCreatorAndResponsible =
        resourceUserId === currentUserId &&
        resourceResponsibleUserId === currentUserId;
      const isResponsibleUser = resourceResponsibleUserId === currentUserId;

      if (!isAdmin && !isCreatorAndResponsible && !isResponsibleUser) {
        return res.status(403).json({
          error:
            "Only admins, creators (if they are the responsible user), or the responsible user can delete resource shares",
        });
      }

      const { error } = await supabase
        .from("resource_shares")
        .delete()
        .eq("id", id)
        .in("owner_tenant_id", req.user!.tenant_ids);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(204).send();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
