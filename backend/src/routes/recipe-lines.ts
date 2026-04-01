import { Router } from "express";
import { supabase } from "../config/supabase";
import { RecipeLine, Item } from "../types/database";
import { checkCycleCrossTenant } from "../services/cycle-detection-cross-tenant";
import {
  authorizeUnified,
  UnifiedTenantAction,
} from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import {
  getUnifiedRecipeLineResource,
  getUnifiedTenantResource,
} from "../middleware/unified-resource-helpers";

async function tenantsShareCompany(
  tenantIdA: string,
  tenantIdB: string,
): Promise<boolean> {
  if (tenantIdA === tenantIdB) return true;
  const { data: rowsA } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantIdA);
  const { data: rowsB } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantIdB);
  const companiesA = new Set(rowsA?.map((r) => r.company_id) ?? []);
  return (rowsB ?? []).some((r) => companiesA.has(r.company_id));
}

/**
 * Recipe Lineのバリデーション: deprecatedな材料やvendor_productを使おうとしていないかチェック
 */
async function validateRecipeLineNotDeprecated(
  line: Partial<RecipeLine>,
  tenantIds: string[],
  viewerTenantId: string,
): Promise<{ valid: boolean; error?: string }> {
  // ingredientのみチェック（laborはチェック不要）
  if (line.line_type !== "ingredient" || !line.child_item_id) {
    return { valid: true };
  }

  const { data: childItem, error: itemError } = await supabase
    .from("items")
    .select("*")
    .eq("id", line.child_item_id)
    .maybeSingle();

  if (itemError || !childItem) {
    return {
      valid: false,
      error: `Ingredient item not found: ${line.child_item_id}`,
    };
  }

  const childInUserTenants = tenantIds.includes(childItem.tenant_id);

  if (!childInUserTenants) {
    if (childItem.item_kind !== "prepped") {
      return {
        valid: false,
        error: `Ingredient item not found: ${line.child_item_id}`,
      };
    }
    const sameCompany = await tenantsShareCompany(
      viewerTenantId,
      childItem.tenant_id,
    );
    if (!sameCompany) {
      return {
        valid: false,
        error: `Ingredient item not found: ${line.child_item_id}`,
      };
    }
  }

  if (childItem.deprecated) {
    const itemType =
      childItem.item_kind === "raw" ? "Raw item" : "Prepped item";
    return {
      valid: false,
      error: `Cannot add deprecated ingredient: ${itemType} "${childItem.name}" is no longer available. Please select an active item.`,
    };
  }

  // Raw itemの場合、specific_childのvirtual_vendor_productをチェック
  if (childItem.item_kind === "raw" && line.specific_child) {
    // "lowest"は許可（最安を自動選択）
    if (line.specific_child !== "lowest" && line.specific_child !== null) {
      // まず、product_mappingsでマッピングが存在することを確認
      const { data: mapping, error: mappingError } = await supabase
        .from("product_mappings")
        .select("*")
        .eq("virtual_product_id", line.specific_child)
        .eq("base_item_id", childItem.base_item_id)
        .eq("tenant_id", childItem.tenant_id)
        .single();

      if (mappingError || !mapping) {
        return {
          valid: false,
          error: `Vendor product ${line.specific_child} is not mapped to base item ${childItem.base_item_id}`,
        };
      }

      const { data: vendorProduct, error: vpError } = await supabase
        .from("virtual_vendor_products")
        .select("*")
        .eq("id", line.specific_child)
        .eq("tenant_id", childItem.tenant_id)
        .single();

      if (vpError || !vendorProduct) {
        return {
          valid: false,
          error: `Vendor product not found: ${line.specific_child}`,
        };
      }

      if (vendorProduct.deprecated) {
        const productName = vendorProduct.product_name || "Unknown product";
        return {
          valid: false,
          error: `Cannot select deprecated vendor product: "${productName}" is no longer available. Please select an active vendor product or use "lowest cost" option.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * 新規/変更される cross-tenant ingredient が read 共有されているかを検証する。
 * 既存参照の grandfather を許可するため、このチェックは「新規追加・child変更時」にのみ使う。
 */
async function validateCrossTenantIngredientShare(
  line: Partial<RecipeLine>,
  viewerTenantId: string,
): Promise<{ valid: boolean; error?: string }> {
  if (line.line_type !== "ingredient" || !line.child_item_id) {
    return { valid: true };
  }

  const { data: childItem, error: childItemError } = await supabase
    .from("items")
    .select("id, name, tenant_id, item_kind")
    .eq("id", line.child_item_id)
    .maybeSingle();

  if (childItemError || !childItem) {
    return {
      valid: false,
      error: `Ingredient item not found: ${line.child_item_id}`,
    };
  }

  if (childItem.tenant_id === viewerTenantId) {
    return { valid: true };
  }

  if (childItem.item_kind !== "prepped") {
    return {
      valid: false,
      error: `Cannot use ingredient "${childItem.name || childItem.id}": it belongs to another tenant but is not a prepped item. Only shared prepped items may be used across tenants.`,
    };
  }

  const { data: viewerTenant, error: viewerTenantError } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", viewerTenantId)
    .maybeSingle();

  if (viewerTenantError || !viewerTenant) {
    return {
      valid: false,
      error:
        "Current tenant is not linked to a company; cross-tenant share cannot be verified.",
    };
  }

  const { data: shares, error: shareError } = await supabase
    .from("cross_tenant_item_shares")
    .select("target_type, target_id, allowed_actions, company_id")
    .eq("item_id", childItem.id)
    .eq("owner_tenant_id", childItem.tenant_id)
    .eq("company_id", viewerTenant.company_id)
    .contains("allowed_actions", ["read"]);

  if (shareError) {
    return {
      valid: false,
      error: `Failed to verify cross-tenant share: ${shareError.message}`,
    };
  }

  const allowed = (shares ?? []).some((s) => {
    const companyIdText = String(s.company_id);
    const matchesCompany =
      s.target_type === "company" && s.target_id === companyIdText;
    const matchesTenant =
      s.target_type === "tenant" && s.target_id === viewerTenantId;
    return matchesCompany || matchesTenant;
  });

  if (!allowed) {
    return {
      valid: false,
      error: `Cannot use ingredient "${childItem.name || childItem.id}": this prepped item is not shared for read access to your tenant (or the share does not match costing rules). Remove it or ask the owner tenant to publish it.`,
    };
  }

  return { valid: true };
}

/**
 * Labor Roleのバリデーション: labor_roleが存在するかチェック
 */
async function validateLaborRoleExists(
  laborRole: string | null | undefined,
  tenantIds: string[],
): Promise<{ valid: boolean; error?: string }> {
  // labor_roleが指定されていない場合はスキップ
  if (!laborRole) {
    return { valid: true };
  }

  // labor_rolesテーブルに、同じtenant_idで、同じnameが存在するかチェック
  const { data: laborRoleData, error } = await supabase
    .from("labor_roles")
    .select("name")
    .eq("name", laborRole)
    .in("tenant_id", tenantIds)
    .single();

  if (error || !laborRoleData) {
    return {
      valid: false,
      error: `Labor role "${laborRole}" does not exist. Please create it first in Settings.`,
    };
  }

  return { valid: true };
}

const router = Router();

/**
 * POST /recipe-lines
 * レシピラインを作成
 */
router.post(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_recipe,
    getUnifiedTenantResource,
  ),
  async (req, res) => {
    try {
      const line: Partial<RecipeLine> = req.body;
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];

      // バリデーション
      if (!line.parent_item_id || !line.line_type) {
        return res.status(400).json({
          error: "parent_item_id and line_type are required",
        });
      }

      if (line.line_type === "ingredient") {
        if (!line.child_item_id || !line.quantity || !line.unit) {
          return res.status(400).json({
            error: "ingredient line requires child_item_id, quantity, and unit",
          });
        }
        const shareValidation = await validateCrossTenantIngredientShare(
          line,
          selectedTenantId,
        );
        if (!shareValidation.valid) {
          return res.status(400).json({ error: shareValidation.error });
        }
      } else if (line.line_type === "labor") {
        if (!line.minutes || line.minutes <= 0) {
          return res.status(400).json({
            error: "labor line requires minutes > 0",
          });
        }
        // labor_roleの存在チェック
        if (line.labor_role) {
          const laborRoleValidation = await validateLaborRoleExists(
            line.labor_role,
            req.user!.tenant_ids,
          );
          if (!laborRoleValidation.valid) {
            return res.status(400).json({ error: laborRoleValidation.error });
          }
        }
      }

      // 循環参照チェック（ingredient lineの場合）
      if (line.line_type === "ingredient" && line.child_item_id) {
        // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
        const { data: allItems } = await supabase
          .from("items")
          .select("*")
          .in("tenant_id", req.user!.tenant_ids);

        // マップを作成
        const itemsMap = new Map<string, Item>();
        allItems?.forEach((i) => itemsMap.set(i.id, i));

        // すべてのレシピラインを取得（既存データとの整合性を確保）
        const { data: allRecipeLines } = await supabase
          .from("recipe_lines")
          .select("*")
          .eq("line_type", "ingredient")
          .in("tenant_id", req.user!.tenant_ids);

        // 新しいレシピラインを含むマップを作成
        const recipeLinesMap = new Map<string, RecipeLine[]>();
        allRecipeLines?.forEach((rl) => {
          const existing = recipeLinesMap.get(rl.parent_item_id) || [];
          existing.push(rl);
          recipeLinesMap.set(rl.parent_item_id, existing);
        });

        // 新しいレシピラインを追加
        const selectedTenantId =
          req.user!.selected_tenant_id || req.user!.tenant_ids[0];
        const newRecipeLine: RecipeLine = {
          id: "", // 一時的なID
          parent_item_id: line.parent_item_id!,
          line_type: line.line_type as "ingredient" | "labor",
          child_item_id: line.child_item_id,
          quantity: line.quantity || null,
          unit: line.unit || null,
          labor_role: null,
          tenant_id: selectedTenantId,
          user_id: req.user!.id, // Required field
          minutes: null,
        };
        const existing = recipeLinesMap.get(line.parent_item_id!) || [];
        existing.push(newRecipeLine);
        recipeLinesMap.set(line.parent_item_id!, existing);

        // 循環参照をチェック（既存データも含めてチェック）
        const viewerTenantId =
          req.user!.selected_tenant_id || req.user!.tenant_ids[0];
        try {
          await checkCycleCrossTenant(
            line.parent_item_id!,
            viewerTenantId,
            new Set(),
            itemsMap,
            recipeLinesMap,
            new Map(),
            new Map(),
            [],
            false,
          );
        } catch (cycleError: unknown) {
          const message =
            cycleError instanceof Error
              ? cycleError.message
              : String(cycleError);
          return res.status(400).json({
            error: message,
          });
        }
      }

      // Deprecatedバリデーション
      const validation = await validateRecipeLineNotDeprecated(
        line,
        req.user!.tenant_ids,
        selectedTenantId,
      );
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // tenant_idとuser_idを自動設定（選択されたテナントID、または最初のテナント）
      const lineWithTenantId = {
        ...line,
        tenant_id: selectedTenantId,
        user_id: req.user!.id, // 作成者を記録
      };

      const { data, error } = await supabase
        .from("recipe_lines")
        .insert([lineWithTenantId])
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // 自動undeprecateをチェック（ingredient lineの場合）
      if (line.line_type === "ingredient" && line.parent_item_id) {
        const { autoUndeprecateAfterRecipeLineUpdate } =
          await import("../services/deprecation");
        await autoUndeprecateAfterRecipeLineUpdate(
          line.parent_item_id,
          req.user!.tenant_ids,
        );
      }

      res.status(201).json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  },
);

/**
 * PUT /recipe-lines/:id
 * レシピラインを更新
 */
router.put(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.update_recipe,
    getUnifiedRecipeLineResource,
  ),
  async (req, res) => {
    try {
      const line: Partial<RecipeLine> = req.body;
      const { id } = req.params;

      // 既存のレシピラインを取得
      const { data: existingLine } = await supabase
        .from("recipe_lines")
        .select("*")
        .eq("id", id)
        .in("tenant_id", req.user!.tenant_ids)
        .single();

      if (!existingLine) {
        return res.status(404).json({ error: "Recipe line not found" });
      }

      // 循環参照チェック（ingredient lineの場合、child_item_idが変更される場合）
      const effectivePutLineType =
        line.line_type ?? existingLine.line_type ?? null;
      if (
        effectivePutLineType === "ingredient" &&
        line.child_item_id &&
        line.child_item_id !== existingLine.child_item_id
      ) {
        const selectedTenantIdForUpdate =
          req.user!.selected_tenant_id || req.user!.tenant_ids[0];
        const mergedLineForShare: Partial<RecipeLine> = {
          ...existingLine,
          ...line,
          line_type: "ingredient",
        };
        const shareValidation = await validateCrossTenantIngredientShare(
          mergedLineForShare,
          selectedTenantIdForUpdate,
        );
        if (!shareValidation.valid) {
          return res.status(400).json({ error: shareValidation.error });
        }

        // Itemsを取得（すべてのアイテムを取得して、既存データとの整合性を確保）
        const { data: allItems } = await supabase
          .from("items")
          .select("*")
          .in("tenant_id", req.user!.tenant_ids);

        // マップを作成
        const itemsMap = new Map<string, Item>();
        allItems?.forEach((i) => itemsMap.set(i.id, i));

        // すべてのレシピラインを取得（既存データとの整合性を確保）
        const { data: allRecipeLines } = await supabase
          .from("recipe_lines")
          .select("*")
          .eq("line_type", "ingredient")
          .in("tenant_id", req.user!.tenant_ids);

        // 更新後のレシピラインを含むマップを作成
        const recipeLinesMap = new Map<string, RecipeLine[]>();
        allRecipeLines?.forEach((rl) => {
          if (rl.id === id) {
            // 更新後のレシピライン
            const updated = { ...rl, ...line };
            const existing = recipeLinesMap.get(rl.parent_item_id) || [];
            existing.push(updated);
            recipeLinesMap.set(rl.parent_item_id, existing);
          } else {
            const existing = recipeLinesMap.get(rl.parent_item_id) || [];
            existing.push(rl);
            recipeLinesMap.set(rl.parent_item_id, existing);
          }
        });

        // 循環参照をチェック（既存データも含めてチェック）
        const viewerTenantIdPut =
          req.user!.selected_tenant_id || req.user!.tenant_ids[0];
        try {
          await checkCycleCrossTenant(
            existingLine.parent_item_id,
            viewerTenantIdPut,
            new Set(),
            itemsMap,
            recipeLinesMap,
            new Map(),
            new Map(),
            [],
            false,
          );
        } catch (cycleError: unknown) {
          const message =
            cycleError instanceof Error
              ? cycleError.message
              : String(cycleError);
          return res.status(400).json({
            error: message,
          });
        }
      }

      // labor_roleの存在チェック（labor lineの場合、labor_roleが設定される場合）
      if (
        (existingLine.line_type === "labor" || line.line_type === "labor") &&
        line.labor_role
      ) {
        const laborRoleValidation = await validateLaborRoleExists(
          line.labor_role,
          req.user!.tenant_ids,
        );
        if (!laborRoleValidation.valid) {
          return res.status(400).json({ error: laborRoleValidation.error });
        }
      }

      // user_idとtenant_idを更新から除外（セキュリティのため）
      // eslint-disable @typescript-eslint/no-unused-vars
      const {
        user_id: _user_id,
        tenant_id: _tenant_id,
        id: _id,
        ...lineWithoutIds
      } = line;
      // eslint-enable @typescript-eslint/no-unused-vars
      const { data, error } = await supabase
        .from("recipe_lines")
        .update(lineWithoutIds)
        .eq("id", id)
        .in("tenant_id", req.user!.tenant_ids)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // 自動undeprecateをチェック（ingredient lineの場合）
      if (
        existingLine.line_type === "ingredient" &&
        existingLine.parent_item_id
      ) {
        const { autoUndeprecateAfterRecipeLineUpdate } =
          await import("../services/deprecation");
        await autoUndeprecateAfterRecipeLineUpdate(
          existingLine.parent_item_id,
          req.user!.tenant_ids,
        );
      }

      res.json(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  },
);

/**
 * DELETE /recipe-lines/:id
 * レシピラインを削除
 */
router.delete(
  "/:id",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.delete_recipe,
    getUnifiedRecipeLineResource,
  ),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("recipe_lines")
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
  },
);

/**
 * POST /recipe-lines/batch
 * レシピラインを一括で作成/更新/削除
 */
router.post("/batch", async (req, res) => {
  try {
    const { creates, updates, deletes } = req.body;

    // バリデーション
    if (
      !Array.isArray(creates) ||
      !Array.isArray(updates) ||
      !Array.isArray(deletes)
    ) {
      return res.status(400).json({
        error: "creates, updates, and deletes must be arrays",
      });
    }

    // Cedar 統一: batch 内の操作を tenant_role ベースで個別認可
    const selectedTenantIdForAuth =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    const selectedTenantRole = req.user!.roles.get(selectedTenantIdForAuth);
    if (!selectedTenantIdForAuth || !selectedTenantRole) {
      return res.status(403).json({ error: "Forbidden: No tenant context" });
    }

    if (creates.length > 0) {
      const tenantResource = await getUnifiedTenantResource(req);
      if (!tenantResource) {
        return res.status(403).json({ error: "Forbidden: Tenant not found" });
      }

      const allowed = await authorizeUnified(
        req.user!.id,
        UnifiedTenantAction.create_recipe,
        tenantResource,
        undefined,
        { tenantId: selectedTenantIdForAuth, tenantRole: selectedTenantRole },
      );

      if (!allowed) {
        return res.status(403).json({
          error: "Forbidden: Insufficient permissions",
        });
      }
    }

    const batchUpdateIdsArr = updates
      .map((u: { id?: string }) => u.id)
      .filter((id: string | undefined): id is string => Boolean(id));
    const batchDeleteIdsArr = deletes.filter((id: any): id is string =>
      Boolean(id),
    );

    const targetRecipeLineIds = [...batchUpdateIdsArr, ...batchDeleteIdsArr];
    if (targetRecipeLineIds.length > 0) {
      const { data: recipeLines, error: recipeLinesError } = await supabase
        .from("recipe_lines")
        .select("id, tenant_id")
        .in("id", targetRecipeLineIds);

      if (recipeLinesError) {
        return res.status(500).json({ error: recipeLinesError.message });
      }

      const tenantIdByRecipeLineId = new Map<string, string>();
      (recipeLines ?? []).forEach((rl) => {
        tenantIdByRecipeLineId.set(rl.id, rl.tenant_id);
      });

      for (const id of batchUpdateIdsArr) {
        const tenantId = tenantIdByRecipeLineId.get(id);
        if (!tenantId) continue;
        const tenantRole = req.user!.roles.get(tenantId);
        if (!tenantRole) return res.status(403).json({ error: "Forbidden" });

        const resource = {
          type: "CostResource",
          id,
          resourceType: "recipe_line",
          tenant_id: tenantId,
          owner_tenant_id: tenantId,
        } as const;

        const allowed = await authorizeUnified(
          req.user!.id,
          UnifiedTenantAction.update_recipe,
          resource,
          undefined,
          { tenantId, tenantRole },
        );

        if (!allowed) {
          return res.status(403).json({
            error: "Forbidden: Insufficient permissions",
          });
        }
      }

      for (const id of batchDeleteIdsArr) {
        const tenantId = tenantIdByRecipeLineId.get(id);
        if (!tenantId) continue;
        const tenantRole = req.user!.roles.get(tenantId);
        if (!tenantRole) return res.status(403).json({ error: "Forbidden" });

        const resource = {
          type: "CostResource",
          id,
          resourceType: "recipe_line",
          tenant_id: tenantId,
          owner_tenant_id: tenantId,
        } as const;

        const allowed = await authorizeUnified(
          req.user!.id,
          UnifiedTenantAction.delete_recipe,
          resource,
          undefined,
          { tenantId, tenantRole },
        );

        if (!allowed) {
          return res.status(403).json({
            error: "Forbidden: Insufficient permissions",
          });
        }
      }
    }

    // すべてのアイテムとレシピラインを取得（循環参照チェック用）
    const { data: allItems } = await supabase
      .from("items")
      .select("*")
      .in("tenant_id", req.user!.tenant_ids);
    const itemsMap = new Map<string, Item>();
    allItems?.forEach((i) => itemsMap.set(i.id, i));

    // 循環参照チェック用: ingredientのみ取得
    const { data: ingredientRecipeLines } = await supabase
      .from("recipe_lines")
      .select("*")
      .eq("line_type", "ingredient")
      .in("tenant_id", req.user!.tenant_ids);

    // 更新対象を探す用: すべてのレシピライン（ingredientとlaborの両方）を取得
    const { data: allRecipeLines } = await supabase
      .from("recipe_lines")
      .select("*")
      .in("tenant_id", req.user!.tenant_ids);

    // 既存のレシピラインのマップを作成（循環参照チェック用）
    const recipeLinesMap = new Map<string, RecipeLine[]>();
    ingredientRecipeLines?.forEach((rl) => {
      const existing = recipeLinesMap.get(rl.parent_item_id) || [];
      existing.push(rl);
      recipeLinesMap.set(rl.parent_item_id, existing);
    });

    // 更新されるレシピラインのIDを取得
    const updateIds = new Set(updates.map((u: { id: string }) => u.id));
    const deleteIds = new Set(deletes);

    // 変更後のレシピラインのマップを作成（循環参照チェック用）
    const updatedRecipeLinesMap = new Map<string, RecipeLine[]>();

    // 既存のレシピラインをコピー（削除・更新されるものを除外）
    ingredientRecipeLines?.forEach((rl) => {
      if (!updateIds.has(rl.id) && !deleteIds.has(rl.id)) {
        const existing = updatedRecipeLinesMap.get(rl.parent_item_id) || [];
        existing.push(rl);
        updatedRecipeLinesMap.set(rl.parent_item_id, existing);
      }
    });

    // 更新されたレシピラインを追加
    for (const update of updates) {
      const { id, ...lineData } = update;
      // すべてのレシピライン（ingredientとlaborの両方）から探す
      const existingLine = allRecipeLines?.find((rl) => rl.id === id);
      if (!existingLine) {
        return res.status(404).json({
          error: `Recipe line with id ${id} not found`,
        });
      }
      const updatedLine: RecipeLine = {
        ...existingLine,
        ...lineData,
      };
      const existing =
        updatedRecipeLinesMap.get(updatedLine.parent_item_id) || [];
      existing.push(updatedLine);
      updatedRecipeLinesMap.set(updatedLine.parent_item_id, existing);
    }

    // 新規作成されるレシピラインを追加
    const selectedTenantId =
      req.user!.selected_tenant_id || req.user!.tenant_ids[0];
    for (const create of creates) {
      const newRecipeLine: RecipeLine = {
        id: "", // 一時的なID
        parent_item_id: create.parent_item_id,
        line_type: create.line_type as "ingredient" | "labor",
        child_item_id: create.child_item_id || null,
        quantity: create.quantity || null,
        unit: create.unit || null,
        specific_child: create.specific_child ?? null, // nullish coalescing: null/undefinedのみnullに
        tenant_id: selectedTenantId,
        user_id: req.user!.id, // Required field
        labor_role: create.labor_role || null,
        minutes: create.minutes || null,
        created_at: undefined,
        updated_at: undefined,
      };
      const existing =
        updatedRecipeLinesMap.get(newRecipeLine.parent_item_id) || [];
      existing.push(newRecipeLine);
      updatedRecipeLinesMap.set(newRecipeLine.parent_item_id, existing);
    }

    // バリデーション（各レシピライン）
    for (const create of creates) {
      if (
        create.tenant_id != null &&
        create.tenant_id !== selectedTenantIdForAuth
      ) {
        return res.status(400).json({
          error:
            "Recipe line tenant_id must match the selected tenant for this batch save.",
        });
      }
      if (!create.parent_item_id || !create.line_type) {
        return res.status(400).json({
          error: "parent_item_id and line_type are required for all creates",
        });
      }
      if (create.line_type === "ingredient") {
        if (!create.child_item_id || !create.quantity || !create.unit) {
          return res.status(400).json({
            error: "ingredient line requires child_item_id, quantity, and unit",
          });
        }
        const shareValidation = await validateCrossTenantIngredientShare(
          create,
          selectedTenantIdForAuth,
        );
        if (!shareValidation.valid) {
          return res.status(400).json({ error: shareValidation.error });
        }
        // Deprecatedバリデーション
        const validation = await validateRecipeLineNotDeprecated(
          create,
          req.user!.tenant_ids,
          selectedTenantIdForAuth,
        );
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }
      } else if (create.line_type === "labor") {
        if (!create.minutes || create.minutes <= 0) {
          return res.status(400).json({
            error: "labor line requires minutes > 0",
          });
        }
        // labor_roleの存在チェック
        if (create.labor_role) {
          const laborRoleValidation = await validateLaborRoleExists(
            create.labor_role,
            req.user!.tenant_ids,
          );
          if (!laborRoleValidation.valid) {
            return res.status(400).json({ error: laborRoleValidation.error });
          }
        }
      }
    }

    for (const update of updates) {
      const existingLine = allRecipeLines?.find((rl) => rl.id === update.id);
      const effectiveLineType =
        update.line_type ?? existingLine?.line_type ?? null;

      if (effectiveLineType === "ingredient") {
        const mergedIngredient = {
          ...existingLine,
          ...update,
          line_type: "ingredient" as const,
        };
        if (
          !mergedIngredient.child_item_id ||
          !mergedIngredient.quantity ||
          !mergedIngredient.unit
        ) {
          return res.status(400).json({
            error: "ingredient line requires child_item_id, quantity, and unit",
          });
        }
        const childChanged =
          !!existingLine &&
          mergedIngredient.child_item_id !== existingLine.child_item_id;
        if (childChanged) {
          const shareValidation = await validateCrossTenantIngredientShare(
            mergedIngredient,
            selectedTenantIdForAuth,
          );
          if (!shareValidation.valid) {
            return res.status(400).json({ error: shareValidation.error });
          }
        }
        // Deprecatedバリデーション
        const validation = await validateRecipeLineNotDeprecated(
          mergedIngredient,
          req.user!.tenant_ids,
          selectedTenantIdForAuth,
        );
        if (!validation.valid) {
          return res.status(400).json({ error: validation.error });
        }
      } else if (effectiveLineType === "labor") {
        const mergedLabor = { ...existingLine, ...update };
        if (!mergedLabor.minutes || mergedLabor.minutes <= 0) {
          return res.status(400).json({
            error: "labor line requires minutes > 0",
          });
        }
        // labor_roleの存在チェック
        if (mergedLabor.labor_role) {
          const laborRoleValidation = await validateLaborRoleExists(
            mergedLabor.labor_role,
            req.user!.tenant_ids,
          );
          if (!laborRoleValidation.valid) {
            return res.status(400).json({ error: laborRoleValidation.error });
          }
        }
      }
    }

    // 循環参照チェック（ingredient lineの場合）
    // 変更が影響する親アイテムのIDを収集
    const affectedParentIds = new Set<string>();
    creates.forEach((c: Partial<RecipeLine>) => {
      if (c.line_type === "ingredient" && c.parent_item_id) {
        affectedParentIds.add(c.parent_item_id);
      }
    });
    updates.forEach((u: Partial<RecipeLine>) => {
      const existingLine = allRecipeLines?.find((rl) => rl.id === u.id);
      if (existingLine && existingLine.line_type === "ingredient") {
        affectedParentIds.add(existingLine.parent_item_id);
      }
    });

    // 各影響を受ける親アイテムについて循環参照をチェック
    console.log(
      `[CYCLE DETECTION] Starting cycle detection for ${affectedParentIds.size} affected parent items:`,
      Array.from(affectedParentIds),
    );
    for (const parentId of affectedParentIds) {
      const parentItem = itemsMap.get(parentId);
      const parentItemName = parentItem?.name || parentId;
      console.log(
        `[CYCLE DETECTION] Checking parent item: ${parentItemName} (${parentId})`,
      );
      try {
        await checkCycleCrossTenant(
          parentId,
          selectedTenantIdForAuth,
          new Set(),
          itemsMap,
          updatedRecipeLinesMap,
          new Map(),
          new Map(),
          [],
          false,
        );
        console.log(
          `[CYCLE DETECTION] ✅ No cycle detected for parent item: ${parentItemName} (${parentId})`,
        );
      } catch (cycleError: unknown) {
        const message =
          cycleError instanceof Error ? cycleError.message : String(cycleError);
        console.error(
          `[CYCLE DETECTION] ❌ Cycle detected for parent item: ${parentItemName} (${parentId}): ${message}`,
        );
        return res.status(400).json({
          error: message,
        });
      }
    }
    console.log(
      `[CYCLE DETECTION] ✅ All ${affectedParentIds.size} parent items passed cycle detection`,
    );

    // データベース操作を実行（削除 → 更新 → 作成の順序）
    const results: {
      created: RecipeLine[];
      updated: RecipeLine[];
      deleted: string[];
    } = {
      created: [],
      updated: [],
      deleted: [],
    };

    // 削除
    if (deletes.length > 0) {
      const { error: deleteError } = await supabase
        .from("recipe_lines")
        .delete()
        .in("id", deletes)
        .in("tenant_id", req.user!.tenant_ids);

      if (deleteError) {
        return res.status(400).json({ error: deleteError.message });
      }
      results.deleted = deletes;

      // 削除された行の親itemsもaffectedParentIdsに追加
      for (const deleteId of deletes) {
        const deletedLine = allRecipeLines?.find((rl) => rl.id === deleteId);
        if (deletedLine && deletedLine.line_type === "ingredient") {
          affectedParentIds.add(deletedLine.parent_item_id);
        }
      }
    }

    // 更新
    if (updates.length > 0) {
      for (const update of updates) {
        // eslint-disable @typescript-eslint/no-unused-vars
        const {
          id,
          user_id: _user_id,
          tenant_id: _tenant_id,
          ...lineData
        } = update;
        // eslint-enable @typescript-eslint/no-unused-vars
        const { data, error: updateError } = await supabase
          .from("recipe_lines")
          .update(lineData)
          .eq("id", id)
          .in("tenant_id", req.user!.tenant_ids)
          .select()
          .single();

        if (updateError) {
          return res.status(400).json({ error: updateError.message });
        }
        if (data) {
          results.updated.push(data);
        }
      }
    }

    // 作成
    if (creates.length > 0) {
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      const createsWithTenantId = creates.map(
        (create: Partial<RecipeLine>) => ({
          ...create,
          tenant_id: selectedTenantId,
          user_id: req.user!.id, // 作成者を記録
        }),
      );
      const { data: createdData, error: createError } = await supabase
        .from("recipe_lines")
        .insert(createsWithTenantId)
        .select();

      if (createError) {
        return res.status(400).json({ error: createError.message });
      }
      if (createdData) {
        results.created = createdData;
      }
    }

    // 材料0個チェック: 影響を受けた各prepped itemが最低1つのingredient lineを持つことを確認
    for (const parentId of affectedParentIds) {
      // 親itemを取得
      const { data: parentItem, error: parentError } = await supabase
        .from("items")
        .select("*")
        .eq("id", parentId)
        .in("tenant_id", req.user!.tenant_ids)
        .single();

      if (parentError || !parentItem) {
        continue; // エラー時はスキップ
      }

      // Prepped itemのみチェック
      if (parentItem.item_kind === "prepped") {
        // ingredient lineの数を確認
        const { data: ingredientLines, error: ilError } = await supabase
          .from("recipe_lines")
          .select("id")
          .eq("parent_item_id", parentId)
          .eq("line_type", "ingredient")
          .in("tenant_id", req.user!.tenant_ids);

        if (ilError) {
          return res.status(500).json({ error: ilError.message });
        }

        if (!ingredientLines || ingredientLines.length === 0) {
          return res.status(400).json({
            error: `Cannot save: Prepped item "${parentItem.name}" must have at least one ingredient. Please add an ingredient before saving.`,
          });
        }
      }
    }

    // 自動undeprecateをチェック（影響を受けた親items）
    const { autoUndeprecateAfterRecipeLineUpdate } =
      await import("../services/deprecation");

    // 作成、更新、削除の影響を受けた親itemsをすべてチェック
    for (const parentId of affectedParentIds) {
      await autoUndeprecateAfterRecipeLineUpdate(
        parentId,
        req.user!.tenant_ids,
      );
    }

    res.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
