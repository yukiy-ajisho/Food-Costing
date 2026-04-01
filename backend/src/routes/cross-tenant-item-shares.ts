import { Router } from "express";
import { supabase } from "../config/supabase";
import type { CrossTenantItemShare } from "../types/database";

const router = Router();

/**
 * ユーザーが操作可能な company_id を取得する。
 * - テナントメンバー（admin/director）: 自分のテナントが属する company
 * - company_admin / company_director: 自分が属する company
 * どちらでもない場合は null を返す。
 */
async function getAccessibleCompanyIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();

  // テナント経由
  const { data: tenantLinks } = await supabase
    .from("company_tenants")
    .select("company_id, tenant_id")
    .in(
      "tenant_id",
      (
        await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("user_id", userId)
          .in("role", ["admin", "director"])
      ).data?.map((p) => p.tenant_id) ?? []
    );
  for (const row of tenantLinks ?? []) ids.add(row.company_id);

  // company_members 経由
  const { data: companyMembers } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .in("role", ["company_admin", "company_director"]);
  for (const row of companyMembers ?? []) ids.add(row.company_id);

  return [...ids];
}

/**
 * ユーザーが操作できる owner_tenant_id の一覧を返す。
 * - テナントの admin/director: 自分のテナントのみ
 * - company_admin / company_director: 同社の全テナント
 */
async function getWritableOwnerTenantIds(
  userId: string,
  companyId: string
): Promise<string[]> {
  const ids = new Set<string>();

  // 自分が admin/director のテナント（その company 配下のもの）
  const { data: ownTenants } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userId)
    .in("role", ["admin", "director"]);

  if (ownTenants && ownTenants.length > 0) {
    const ownTenantIds = ownTenants.map((p) => p.tenant_id);
    const { data: companyLinks } = await supabase
      .from("company_tenants")
      .select("tenant_id")
      .eq("company_id", companyId)
      .in("tenant_id", ownTenantIds);
    for (const row of companyLinks ?? []) ids.add(row.tenant_id);
  }

  // company_admin / company_director ならその company の全テナント
  const { data: companyMember } = await supabase
    .from("company_members")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .in("role", ["company_admin", "company_director"])
    .maybeSingle();

  if (companyMember) {
    const { data: allTenants } = await supabase
      .from("company_tenants")
      .select("tenant_id")
      .eq("company_id", companyId);
    for (const row of allTenants ?? []) ids.add(row.tenant_id);
  }

  return [...ids];
}

/**
 * GET /cross-tenant-item-shares
 * クエリパラメータ:
 *   - company_id (必須): 対象 company
 *   - owner_tenant_id (任意): owner テナントで絞り込み
 *   - item_id (任意): アイテムで絞り込み
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { company_id, owner_tenant_id, item_id } = req.query as Record<
      string,
      string | undefined
    >;

    if (!company_id) {
      return res.status(400).json({ error: "company_id is required" });
    }

    // アクセス可能な company かチェック
    const accessibleCompanyIds = await getAccessibleCompanyIds(userId);
    if (!accessibleCompanyIds.includes(company_id)) {
      return res.status(403).json({ error: "Access denied to this company" });
    }

    let query = supabase
      .from("cross_tenant_item_shares")
      .select("*")
      .eq("company_id", company_id);

    if (owner_tenant_id) query = query.eq("owner_tenant_id", owner_tenant_id);
    if (item_id) query = query.eq("item_id", item_id);

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /cross-tenant-item-shares/available
 * 自分のテナント（閲覧側）から見える他テナントの公開 prepped items を返す。
 * recipe 作成時の ingredient 選択ドロップダウン用。
 * items には proceed_yield_unit / each_grams を含め、閲覧側で「each」単位の可否判定に使う。
 * クエリパラメータ:
 *   - tenant_id (必須): 閲覧側テナント ID
 */
router.get("/available", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { tenant_id } = req.query as { tenant_id?: string };

    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id is required" });
    }

    // そのテナントが属する company を取得
    const { data: companyLink } = await supabase
      .from("company_tenants")
      .select("company_id")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!companyLink) {
      return res.json([]); // company に属していない場合は空
    }

    const companyId = companyLink.company_id;

    // tenant メンバー、または company_admin/company_director（company 経由）なら許可
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!profile) {
      const accessibleCompanyIds = await getAccessibleCompanyIds(userId);
      if (!accessibleCompanyIds.includes(companyId)) {
        return res.status(403).json({ error: "Access denied to this tenant" });
      }
    }

    // 自分のテナントが閲覧できる shares を取得
    // target_type='company' かつ target_id = company_id
    // または target_type='tenant' かつ target_id = tenant_id
    const { data: shares, error } = await supabase
      .from("cross_tenant_item_shares")
      .select(
        "*, items(id, name, tenant_id, proceed_yield_unit, each_grams, item_kind, deprecated)",
      )
      .eq("company_id", companyId)
      .neq("owner_tenant_id", tenant_id) // 自分のテナントのアイテムは除外
      .or(
        `and(target_type.eq.company,target_id.eq.${companyId}),and(target_type.eq.tenant,target_id.eq.${tenant_id})`
      )
      .contains("allowed_actions", ["read"]); // 'read' 権限がある場合のみ（empty = hide は除外）

    if (error) return res.status(500).json({ error: error.message });
    res.json(shares ?? []);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /cross-tenant-item-shares/grandfathered-ingredients
 * Hide 後も閲覧テナントの既存 recipe_lines が参照している他テナント prepped の表示用メタデータ。
 * 新規 ingredient 用の /available には出さないが、既存行の名前・単位・コスト補完に必要。
 * body: { tenant_id: string, item_ids: string[] }
 */
router.post("/grandfathered-ingredients", async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as {
      tenant_id?: string;
      item_ids?: unknown;
    };

    const tenant_id = body.tenant_id;
    if (!tenant_id || !Array.isArray(body.item_ids)) {
      return res
        .status(400)
        .json({ error: "tenant_id and item_ids array are required" });
    }

    const rawIds = body.item_ids.filter(
      (x): x is string => typeof x === "string",
    );
    const item_ids = [...new Set(rawIds)].slice(0, 100);
    if (item_ids.length === 0) {
      return res.json([]);
    }

    const { data: companyLink } = await supabase
      .from("company_tenants")
      .select("company_id")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!companyLink) {
      return res.json([]);
    }

    const companyId = companyLink.company_id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    if (!profile) {
      const accessibleCompanyIds = await getAccessibleCompanyIds(userId);
      if (!accessibleCompanyIds.includes(companyId)) {
        return res.status(403).json({ error: "Access denied to this tenant" });
      }
    }

    const { data: lines, error: rlError } = await supabase
      .from("recipe_lines")
      .select("child_item_id")
      .eq("tenant_id", tenant_id)
      .eq("line_type", "ingredient")
      .in("child_item_id", item_ids);

    if (rlError) {
      return res.status(500).json({ error: rlError.message });
    }

    const referenced = new Set(
      (lines ?? [])
        .map((l) => l.child_item_id)
        .filter((id): id is string => typeof id === "string"),
    );
    const candidateIds = item_ids.filter((id) => referenced.has(id));
    if (candidateIds.length === 0) {
      return res.json([]);
    }

    const { data: itemRows, error: itemErr } = await supabase
      .from("items")
      .select(
        "id, name, tenant_id, item_kind, proceed_yield_unit, each_grams",
      )
      .in("id", candidateIds);

    if (itemErr) {
      return res.status(500).json({ error: itemErr.message });
    }

    const foreignTenantIds = [
      ...new Set(
        (itemRows ?? [])
          .filter(
            (row) =>
              row.item_kind === "prepped" &&
              row.tenant_id !== tenant_id,
          )
          .map((row) => row.tenant_id),
      ),
    ];

    if (foreignTenantIds.length === 0) {
      return res.json([]);
    }

    const { data: coTenants } = await supabase
      .from("company_tenants")
      .select("tenant_id")
      .eq("company_id", companyId)
      .in("tenant_id", foreignTenantIds);

    const allowedForeign = new Set(
      (coTenants ?? []).map((r) => r.tenant_id),
    );

    const out: {
      id: string;
      name: string | null;
      tenant_id: string;
      proceed_yield_unit: string | null;
      each_grams: number | null;
    }[] = [];

    for (const row of itemRows ?? []) {
      if (row.item_kind !== "prepped") continue;
      if (row.tenant_id === tenant_id) continue;
      if (!allowedForeign.has(row.tenant_id)) continue;
      out.push({
        id: row.id,
        name: row.name,
        tenant_id: row.tenant_id,
        proceed_yield_unit: row.proceed_yield_unit ?? null,
        each_grams: row.each_grams ?? null,
      });
    }

    res.json(out);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /cross-tenant-item-shares
 * 公開設定を作成（または更新）。
 * body: { company_id, item_id, owner_tenant_id, target_type, target_id, allowed_actions? }
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      company_id,
      item_id,
      owner_tenant_id,
      target_type,
      target_id,
      allowed_actions,
    } = req.body as Partial<CrossTenantItemShare>;

    // 必須フィールドチェック
    if (!company_id || !item_id || !owner_tenant_id || !target_type || !target_id) {
      return res.status(400).json({
        error: "company_id, item_id, owner_tenant_id, target_type, target_id are required",
      });
    }

    if (!["company", "tenant"].includes(target_type)) {
      return res.status(400).json({
        error: "target_type must be 'company' or 'tenant'",
      });
    }

    // 書き込み権限チェック
    const writableTenantIds = await getWritableOwnerTenantIds(userId, company_id);
    if (!writableTenantIds.includes(owner_tenant_id)) {
      return res.status(403).json({
        error: "You do not have permission to manage shares for this tenant",
      });
    }

    // アイテムが prepped かつ owner_tenant_id に属するか確認
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("id, item_kind, tenant_id, deprecated")
      .eq("id", item_id)
      .eq("tenant_id", owner_tenant_id)
      .single();

    if (itemError || !item) {
      return res.status(404).json({ error: "Item not found in the specified tenant" });
    }
    if (item.item_kind !== "prepped") {
      return res.status(400).json({ error: "Only prepped items can be shared cross-tenant" });
    }
    if (item.deprecated) {
      return res.status(400).json({
        error: "Deprecated items cannot be shared cross-tenant",
      });
    }

    // target_type='tenant' の場合、対象テナントが同じ company に属するか確認
    if (target_type === "tenant") {
      const { data: targetLink } = await supabase
        .from("company_tenants")
        .select("company_id")
        .eq("tenant_id", target_id)
        .eq("company_id", company_id)
        .maybeSingle();

      if (!targetLink) {
        return res.status(400).json({
          error: "Target tenant does not belong to the same company",
        });
      }
    }

    const finalAllowedActions =
      Array.isArray(allowed_actions) ? allowed_actions : ["read"];

    // 有効な allowed_actions かチェック
    const validActions = ["read"];
    const invalidActions = finalAllowedActions.filter(
      (a) => !validActions.includes(a)
    );
    if (invalidActions.length > 0) {
      return res.status(400).json({
        error: `allowed_actions must only contain: ${validActions.join(", ")} (or empty array for hide)`,
      });
    }

    const { data, error } = await supabase
      .from("cross_tenant_item_shares")
      .insert({
        company_id,
        item_id,
        owner_tenant_id,
        target_type,
        target_id,
        created_by: userId,
        allowed_actions: finalAllowedActions,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "A share with this item and target already exists",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * PUT /cross-tenant-item-shares/:id
 * allowed_actions のみ更新可能。
 */
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { allowed_actions } = req.body as Pick<
      CrossTenantItemShare,
      "allowed_actions"
    >;

    if (!Array.isArray(allowed_actions)) {
      return res.status(400).json({ error: "allowed_actions must be an array" });
    }

    // 既存レコード取得
    const { data: existing, error: fetchError } = await supabase
      .from("cross_tenant_item_shares")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Share not found" });
    }

    // 書き込み権限チェック
    const writableTenantIds = await getWritableOwnerTenantIds(
      userId,
      existing.company_id
    );
    if (!writableTenantIds.includes(existing.owner_tenant_id)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // 有効な allowed_actions かチェック
    const validActions = ["read"];
    const invalidActions = allowed_actions.filter(
      (a) => !validActions.includes(a)
    );
    if (invalidActions.length > 0) {
      return res.status(400).json({
        error: `allowed_actions must only contain: ${validActions.join(", ")} (or empty array for hide)`,
      });
    }

    const { data, error } = await supabase
      .from("cross_tenant_item_shares")
      .update({ allowed_actions, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * DELETE /cross-tenant-item-shares/:id
 * レコードを削除（= hide に戻す）。
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // 既存レコード取得
    const { data: existing, error: fetchError } = await supabase
      .from("cross_tenant_item_shares")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Share not found" });
    }

    // 書き込み権限チェック
    const writableTenantIds = await getWritableOwnerTenantIds(
      userId,
      existing.company_id
    );
    if (!writableTenantIds.includes(existing.owner_tenant_id)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { error } = await supabase
      .from("cross_tenant_item_shares")
      .delete()
      .eq("id", id);

    if (error) return res.status(400).json({ error: error.message });
    res.status(204).send();
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
