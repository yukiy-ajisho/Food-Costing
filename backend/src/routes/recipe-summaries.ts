import { Router } from "express";
import { supabase } from "../config/supabase";
import { withTenantFilter } from "../middleware/tenant-filter";
import { buildTechnicalSheet } from "../services/technical-sheet-builder";

const router = Router();

type RecipeSummaryRow = {
  id: string;
  tenant_id: string;
  summary_name: string;
  source_item_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type AccessCheckResult = {
  allowed: boolean;
  reason: "cross_tenant_restricted" | "hidden_by_access_control" | null;
};

async function isCompanyOfficerOnTenant(userId: string, tenantId: string): Promise<boolean> {
  const { data: link, error: linkErr } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (linkErr || !link?.company_id) return false;
  const { data: member } = await supabase
    .from("company_members")
    .select("id")
    .eq("company_id", link.company_id)
    .eq("user_id", userId)
    .in("role", ["company_admin", "company_director"])
    .maybeSingle();
  return !!member;
}

function evaluateAccessControl(
  roleInTenant: string | undefined,
  currentUserId: string,
  item: { id: string; tenant_id: string; responsible_user_id?: string | null },
  selectedTenantId: string,
  managerShareTypeByItemId: Map<string, "hide" | "view-only" | "editable">,
  canUseCrossTenant: boolean,
  sharedCrossTenantItemIds: Set<string>,
): AccessCheckResult {
  const isCrossTenant = item.tenant_id !== selectedTenantId;
  if (isCrossTenant) {
    if (!canUseCrossTenant || !sharedCrossTenantItemIds.has(item.id)) {
      return { allowed: false, reason: "cross_tenant_restricted" };
    }
  }

  if (roleInTenant !== "manager") {
    return { allowed: true, reason: null };
  }

  const shareType = managerShareTypeByItemId.get(item.id) ?? "hide";
  const isResponsible = item.responsible_user_id === currentUserId;
  if (shareType === "hide" && !isResponsible) {
    return { allowed: false, reason: "hidden_by_access_control" };
  }

  return { allowed: true, reason: null };
}

router.get("/", async (req, res) => {
  try {
    let query = supabase
      .from("recipe_summaries")
      .select("id, tenant_id, summary_name, source_item_id, created_by, created_at, updated_at")
      .order("created_at", { ascending: false });
    query = withTenantFilter(query, req);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const sourceItemIds = [...new Set((data ?? []).map((r) => r.source_item_id))];
    const itemNameMap = new Map<string, string | null>();
    if (sourceItemIds.length > 0) {
      const { data: itemRows, error: itemErr } = await supabase
        .from("items")
        .select("id, name")
        .in("id", sourceItemIds);
      if (itemErr) {
        return res.status(500).json({ error: itemErr.message });
      }
      for (const row of itemRows ?? []) {
        itemNameMap.set(row.id, row.name ?? null);
      }
    }

    const summaryIds = (data ?? []).map((r) => r.id);
    const targetMap = new Map<string, string[]>();
    if (summaryIds.length > 0) {
      const { data: targetRows, error: targetErr } = await supabase
        .from("recipe_summary_expand_targets")
        .select("summary_id, target_item_id")
        .in("summary_id", summaryIds);
      if (targetErr) {
        return res.status(500).json({ error: targetErr.message });
      }
      for (const row of targetRows ?? []) {
        const existing = targetMap.get(row.summary_id) ?? [];
        existing.push(row.target_item_id);
        targetMap.set(row.summary_id, existing);
      }
    }

    const rows = (data ?? []).map((row) => ({
      ...row,
      source_item_name: itemNameMap.get(row.source_item_id) ?? null,
      expand_target_item_ids: targetMap.get(row.id) ?? [],
    }));

    return res.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.post("/", async (req, res) => {
  try {
    const summaryName = String(req.body?.summary_name ?? "").trim();
    const sourceItemId = String(req.body?.source_item_id ?? "").trim();
    const expandTargetItemIdsRaw: unknown[] = Array.isArray(req.body?.expand_target_item_ids)
      ? (req.body.expand_target_item_ids as unknown[])
      : [];
    const expandTargetItemIds: string[] = Array.from(
      new Set(
        expandTargetItemIdsRaw
          .map((v) => String(v).trim())
          .filter((s) => s.length > 0),
      ),
    );

    if (!summaryName) {
      return res.status(400).json({ error: "summary_name is required" });
    }
    if (!sourceItemId) {
      return res.status(400).json({ error: "source_item_id is required" });
    }

    const selectedTenantId = req.user?.selected_tenant_id || req.user?.tenant_ids?.[0];
    if (!selectedTenantId) {
      return res.status(400).json({ error: "No tenant associated" });
    }

    const roleInTenant = req.user?.roles?.get(selectedTenantId);
    const canUseCrossTenant = await isCompanyOfficerOnTenant(req.user!.id, selectedTenantId);

    const sourceQuery = supabase
      .from("items")
      .select("id, item_kind, tenant_id, responsible_user_id")
      .eq("id", sourceItemId)
      .maybeSingle();
    // source は cross-tenant item も選択候補になり得るため tenant filter は掛けない
    const { data: sourceItem, error: sourceErr } = await sourceQuery;
    if (sourceErr) {
      return res.status(500).json({ error: sourceErr.message });
    }
    if (!sourceItem) {
      return res.status(404).json({ error: "source_item_id not found in tenant scope" });
    }
    if (sourceItem.item_kind !== "prepped") {
      return res.status(400).json({ error: "source_item_id must be a prepped item" });
    }

    const allIds = [sourceItemId, ...expandTargetItemIds];
    const { data: allCandidateItems, error: allItemsErr } = await supabase
      .from("items")
      .select("id, tenant_id")
      .in("id", allIds);
    if (allItemsErr) {
      return res.status(500).json({ error: allItemsErr.message });
    }
    const crossTenantCandidateIds = (allCandidateItems ?? [])
      .filter((it) => it.tenant_id !== selectedTenantId)
      .map((it) => it.id);
    const sharedCrossTenantItemIds = new Set<string>();
    if (crossTenantCandidateIds.length > 0) {
      const { data: tenantCompany, error: tenantCompanyErr } = await supabase
        .from("company_tenants")
        .select("company_id")
        .eq("tenant_id", selectedTenantId)
        .maybeSingle();
      if (tenantCompanyErr || !tenantCompany?.company_id) {
        return res.status(400).json({ error: "No company linked to selected tenant" });
      }

      const { data: shareRows, error: shareErr } = await supabase
        .from("cross_tenant_item_shares")
        .select("item_id, target_type, target_id, allowed_actions")
        .eq("company_id", tenantCompany.company_id)
        .in("item_id", crossTenantCandidateIds);
      if (shareErr) {
        return res.status(500).json({ error: shareErr.message });
      }
      for (const row of shareRows ?? []) {
        const allowed = Array.isArray(row.allowed_actions) && row.allowed_actions.includes("read");
        if (!allowed) continue;
        const hitsCompany = row.target_type === "company" && row.target_id === tenantCompany.company_id;
        const hitsTenant = row.target_type === "tenant" && row.target_id === selectedTenantId;
        if (hitsCompany || hitsTenant) {
          sharedCrossTenantItemIds.add(row.item_id);
        }
      }
    }
    const { data: managerShares } = await supabase
      .from("resource_shares")
      .select("resource_id, allowed_actions, is_exclusion")
      .eq("resource_type", "item")
      .eq("target_type", "role")
      .eq("target_id", "manager")
      .in("resource_id", allIds);

    const managerShareTypeByItemId = new Map<string, "hide" | "view-only" | "editable">();
    for (const row of managerShares ?? []) {
      if (row.is_exclusion) continue;
      const actions = row.allowed_actions ?? [];
      if (actions.length === 0) {
        managerShareTypeByItemId.set(row.resource_id, "hide");
      } else if (actions.length === 1 && actions[0] === "read") {
        managerShareTypeByItemId.set(row.resource_id, "view-only");
      } else if (actions.includes("read") && actions.includes("update")) {
        managerShareTypeByItemId.set(row.resource_id, "editable");
      }
    }

    const sourceAccess = evaluateAccessControl(
      roleInTenant,
      req.user!.id,
      {
        id: sourceItem.id,
        tenant_id: sourceItem.tenant_id,
        responsible_user_id: sourceItem.responsible_user_id ?? null,
      },
      selectedTenantId,
      managerShareTypeByItemId,
      canUseCrossTenant,
      sharedCrossTenantItemIds,
    );
    if (!sourceAccess.allowed) {
      return res.status(403).json({
        error: "source_item_id is not allowed for current role",
        reason: sourceAccess.reason,
      });
    }

    if (expandTargetItemIds.length > 0) {
      const targetQuery = supabase
        .from("items")
        .select("id, item_kind, tenant_id, responsible_user_id")
        .in("id", expandTargetItemIds);
      // expand target も cross-tenant item が入り得るため tenant filter は掛けない
      const { data: targetItems, error: targetErr } = await targetQuery;
      if (targetErr) {
        return res.status(500).json({ error: targetErr.message });
      }
      const validIds = new Set<string>();
      const deniedIds: string[] = [];
      for (const t of targetItems ?? []) {
        if (t.item_kind !== "prepped") continue;
        const access = evaluateAccessControl(
          roleInTenant,
          req.user!.id,
          {
            id: t.id,
            tenant_id: t.tenant_id,
            responsible_user_id: t.responsible_user_id ?? null,
          },
          selectedTenantId,
          managerShareTypeByItemId,
          canUseCrossTenant,
          sharedCrossTenantItemIds,
        );
        if (access.allowed) {
          validIds.add(t.id);
        } else {
          deniedIds.push(t.id);
        }
      }
      const invalidIds = expandTargetItemIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          error: "expand_target_item_ids contains non-prepped or out-of-scope items",
          invalid_item_ids: invalidIds,
          denied_item_ids: deniedIds,
        });
      }
    }

    const now = new Date().toISOString();
    const insertPayload = {
      tenant_id: selectedTenantId,
      summary_name: summaryName,
      source_item_id: sourceItemId,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("recipe_summaries")
      .insert(insertPayload)
      .select("id, tenant_id, summary_name, source_item_id, created_by, created_at, updated_at")
      .single<RecipeSummaryRow>();
    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    if (expandTargetItemIds.length > 0) {
      const targets = expandTargetItemIds.map((targetItemId) => ({
        summary_id: inserted.id,
        target_item_id: targetItemId,
      }));
      const { error: targetInsertErr } = await supabase
        .from("recipe_summary_expand_targets")
        .insert(targets);
      if (targetInsertErr) {
        return res.status(500).json({ error: targetInsertErr.message });
      }
    }

    return res.status(201).json({
      ...inserted,
      source_item_name: null,
      expand_target_item_ids: expandTargetItemIds,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const summaryId = String(req.params.id ?? "").trim();
    if (!summaryId) {
      return res.status(400).json({ error: "id is required" });
    }

    let deleteQuery = supabase.from("recipe_summaries").delete().eq("id", summaryId);
    deleteQuery = withTenantFilter(deleteQuery, req);
    const { error } = await deleteQuery;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(204).send();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

router.get("/:id/technical-sheet", async (req, res) => {
  try {
    const summaryId = String(req.params.id ?? "").trim();
    if (!summaryId) {
      return res.status(400).json({ error: "id is required" });
    }

    const tenantIdList = req.user?.tenant_ids ?? [];
    if (tenantIdList.length === 0) {
      return res.status(400).json({ error: "No tenant associated" });
    }

    let summaryQuery = supabase
      .from("recipe_summaries")
      .select("id, tenant_id, summary_name, source_item_id")
      .eq("id", summaryId)
      .maybeSingle();
    summaryQuery = withTenantFilter(summaryQuery, req);

    const { data: summary, error: summaryErr } = await summaryQuery;
    if (summaryErr) {
      return res.status(500).json({ error: summaryErr.message });
    }
    if (!summary) {
      return res.status(404).json({ error: "recipe summary not found" });
    }

    const { data: targets, error: targetsErr } = await supabase
      .from("recipe_summary_expand_targets")
      .select("target_item_id")
      .eq("summary_id", summary.id);
    if (targetsErr) {
      return res.status(500).json({ error: targetsErr.message });
    }
    const expandSet = new Set((targets ?? []).map((t) => t.target_item_id));

    const sheet = await buildTechnicalSheet({
      sourceItemId: summary.source_item_id,
      tenantIds: tenantIdList,
      expandItemIds: expandSet,
    });

    return res.json({
      summary_id: summary.id,
      summary_name: summary.summary_name,
      ...sheet,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
