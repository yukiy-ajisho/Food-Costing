import { Router, type NextFunction, type Request, type Response } from "express";
import { supabase } from "../config/supabase";
import { authorizeRecipeCostReportAccess } from "../authz/unified/authorize";
import { withTenantFilter } from "../middleware/tenant-filter";
import {
  computeMenuCostListCosts,
  computeScopedBreakdownCosts,
} from "../services/franchise-menu-cost";
import {
  type CostBasis,
  defaultCostBasisForMenuMember,
  fetchLatestWholesalePrices,
  fetchRecipeCostReportItemCandidates,
  getMenuCostListMode,
  loadListMemberRows,
  purgeDirectDeprecatedMembers,
  validatePreppedMenuItemIds,
  wholesaleCostBasisSelectableFlag,
} from "../services/recipe-cost-report-data";
import { computeWholesaleRecipeImpactByItem } from "../services/wholesale-recipe-impact";

const router = Router();

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const tenantId =
      req.user.selected_tenant_id || req.user.tenant_ids[0] || undefined;
    if (!tenantId) {
      return res.status(403).json({ error: "No tenant associated" });
    }
    const mode = req.method === "GET" || req.method === "HEAD" ? "read" : "manage";
    const allowed = await authorizeRecipeCostReportAccess(
      req.user.id,
      tenantId,
      mode,
      req.user.roles,
    );
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }
    next();
  } catch (e: unknown) {
    console.error("Recipe cost report authorization error:", e);
    return res.status(500).json({ error: "Authorization check failed" });
  }
});

function tenantId(req: Request): string {
  const id = req.user?.selected_tenant_id || req.user?.tenant_ids?.[0];
  if (!id) throw new Error("No tenant selected");
  return id;
}

function userId(req: Request): string {
  if (!req.user?.id) throw new Error("Unauthorized");
  return req.user.id;
}

function parseLcogThresholdField(
  value: unknown,
  fieldName: string,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a number greater than 0`);
  }
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(n - rounded) > 1e-9) {
    throw new Error(`${fieldName} allows at most 2 decimal places`);
  }
  return rounded;
}

function parseLcogThresholdPair(
  body: unknown,
): { caution: number | null; over: number | null } {
  const raw = body as { caution?: unknown; over?: unknown };
  const caution = parseLcogThresholdField(raw.caution, "caution");
  const over = parseLcogThresholdField(raw.over, "over");
  if (caution != null && over != null && caution >= over) {
    throw new Error("caution must be less than over when both are set");
  }
  return { caution, over };
}

function parseMemberCostBasisBody(
  body: unknown,
): Record<string, CostBasis> | undefined {
  const raw = (body as { member_cost_basis?: unknown })?.member_cost_basis;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, CostBasis> = {};
  for (const [itemId, basis] of Object.entries(raw as Record<string, unknown>)) {
    if (basis === "wholesale") out[itemId] = "wholesale";
    else if (basis === "corporate") out[itemId] = "corporate";
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function resolveInsertCostBasis(
  tenantId: string,
  mode: "company_owned" | "franchise",
  wholesaleListId: string | null,
  itemIds: string[],
  requested?: Record<string, CostBasis>,
): Promise<Map<string, CostBasis>> {
  const map = new Map<string, CostBasis>();
  if (mode === "company_owned" || !wholesaleListId) {
    for (const id of itemIds) map.set(id, "corporate");
    return map;
  }

  const { data: wlMem } = await supabase
    .from("wholesale_list_members")
    .select("item_id")
    .eq("wholesale_list_id", wholesaleListId)
    .in("item_id", itemIds);
  const onWl = new Set((wlMem ?? []).map((r) => r.item_id));
  const wlPrices = await fetchLatestWholesalePrices(wholesaleListId, itemIds);
  const wlImpact = await computeWholesaleRecipeImpactByItem(
    tenantId,
    wholesaleListId,
    itemIds,
  );

  for (const itemId of itemIds) {
    const onLinked = onWl.has(itemId);
    const linkedPrice = onLinked ? (wlPrices.get(itemId) ?? null) : null;
    const selectable = wlImpact.has(itemId);
    const requestedBasis = requested?.[itemId];
    if (
      requestedBasis === "wholesale" &&
      wholesaleCostBasisSelectableFlag(selectable)
    ) {
      map.set(itemId, "wholesale");
    } else {
      map.set(
        itemId,
        defaultCostBasisForMenuMember(
          mode,
          selectable,
          onLinked,
          linkedPrice,
        ),
      );
    }
  }
  return map;
}

// =============================================================================
// Wholesale lists
// =============================================================================

router.get("/wholesale-lists", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .select("id, name, caution, over, created_at")
        .order("name"),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ lists: data ?? [] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/wholesale-lists", async (req, res) => {
  try {
    const tid = tenantId(req);
    const uid = userId(req);
    const name = String(req.body?.name ?? "").trim();
    const itemIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];
    if (!name) return res.status(400).json({ error: "name is required" });

    let thresholds: { caution: number | null; over: number | null };
    try {
      thresholds = parseLcogThresholdPair(req.body);
    } catch (e: unknown) {
      return res
        .status(400)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }

    const validIds = await validatePreppedMenuItemIds(tid, itemIds);

    const { data: list, error: listErr } = await supabase
      .from("wholesale_lists")
      .insert({
        tenant_id: tid,
        name,
        created_by: uid,
        caution: thresholds.caution,
        over: thresholds.over,
      })
      .select("id, name, caution, over, created_at")
      .single();
    if (listErr) return res.status(500).json({ error: listErr.message });

    if (validIds.length > 0) {
      const { error: memErr } = await supabase.from("wholesale_list_members").insert(
        validIds.map((item_id) => ({
          wholesale_list_id: list.id,
          item_id,
          created_by: uid,
        })),
      );
      if (memErr) return res.status(500).json({ error: memErr.message });
    }

    const members = await loadListMemberRows(
      tid,
      "wholesale",
      list.id,
      validIds,
    );

    res.status(201).json({ list, members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/wholesale-lists/:listId", async (req, res) => {
  try {
    const tid = tenantId(req);
    const { listId } = req.params;

    const { data: list, error: listErr } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .select("id, name, caution, over, created_at")
        .eq("id", listId)
        .maybeSingle(),
      req,
    );
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const { data: memRows, error: memErr } = await supabase
      .from("wholesale_list_members")
      .select("item_id")
      .eq("wholesale_list_id", listId)
      .order("created_at");
    if (memErr) return res.status(500).json({ error: memErr.message });

    const itemIds = (memRows ?? []).map((m) => m.item_id);
    const members = await loadListMemberRows(tid, "wholesale", listId, itemIds);

    res.json({ list, members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/wholesale-lists/:listId", async (req, res) => {
  try {
    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    if (name !== undefined && !name) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (req.body?.caution !== undefined || req.body?.over !== undefined) {
      try {
        const thresholds = parseLcogThresholdPair({
          caution:
            req.body?.caution !== undefined ? req.body.caution : null,
          over: req.body?.over !== undefined ? req.body.over : null,
        });
        updates.caution = thresholds.caution;
        updates.over = thresholds.over;
      } catch (e: unknown) {
        return res
          .status(400)
          .json({ error: e instanceof Error ? e.message : String(e) });
      }
    }

    const { data, error } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .update(updates)
        .eq("id", req.params.listId)
        .select("id, name, caution, over, created_at")
        .maybeSingle(),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "List not found" });
    res.json({ list: data });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/wholesale-lists/:listId/delete-impact", async (req, res) => {
  try {
    const { listId } = req.params;

    const { data: list, error: listErr } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .select("id, name")
        .eq("id", listId)
        .maybeSingle(),
      req,
    );
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const { data: linked, error: linkedErr } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .select("id, name")
        .eq("wholesale_list_id", listId)
        .eq("mode", "franchise")
        .order("name"),
      req,
    );
    if (linkedErr) return res.status(500).json({ error: linkedErr.message });

    res.json({
      list,
      linked_retail_lists: linked ?? [],
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/wholesale-lists/:listId/wholesale-recipe-impact", async (req, res) => {
  try {
    const tid = tenantId(req);
    const { listId } = req.params;
    const raw = req.body?.item_ids;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: "item_ids must be an array" });
    }
    const itemIds = raw
      .map((id) => String(id ?? "").trim())
      .filter((id) => id.length > 0);
    if (itemIds.length === 0) {
      return res.json({ item_ids: [] as string[] });
    }

    const { data: list, error: listErr } = await withTenantFilter(
      supabase.from("wholesale_lists").select("id").eq("id", listId).maybeSingle(),
      req,
    );
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const impacted = await computeWholesaleRecipeImpactByItem(
      tid,
      listId,
      itemIds,
    );
    res.json({ item_ids: [...impacted] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/wholesale-lists/:listId", async (req, res) => {
  try {
    const { listId } = req.params;
    const deleteLinkedRetail =
      req.body?.delete_linked_retail_lists === true ||
      String(req.query.delete_linked_retail_lists ?? "").toLowerCase() === "true";

    const { data: list, error: listErr } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .select("id, name")
        .eq("id", listId)
        .maybeSingle(),
      req,
    );
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const { data: linked, error: linkedErr } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .select("id, name")
        .eq("wholesale_list_id", listId)
        .order("name"),
      req,
    );
    if (linkedErr) return res.status(500).json({ error: linkedErr.message });

    const linkedRetail = linked ?? [];
    if (linkedRetail.length > 0 && !deleteLinkedRetail) {
      return res.status(409).json({
        error: "Wholesale list is used by retail price lists",
        linked_retail_lists: linkedRetail,
      });
    }

    if (linkedRetail.length > 0 && deleteLinkedRetail) {
      const { error: mclDelErr } = await withTenantFilter(
        supabase.from("menu_cost_lists").delete().eq("wholesale_list_id", listId),
        req,
      );
      if (mclDelErr) return res.status(500).json({ error: mclDelErr.message });
    }

    const { error } = await withTenantFilter(
      supabase.from("wholesale_lists").delete().eq("id", listId),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/wholesale-lists/:listId/members", async (req, res) => {
  try {
    const uid = userId(req);
    const itemId = String(req.body?.item_id ?? "").trim();
    if (!itemId) return res.status(400).json({ error: "item_id is required" });

    const tid = tenantId(req);
    const valid = await validatePreppedMenuItemIds(tid, [itemId]);
    if (valid.length === 0) {
      return res.status(400).json({ error: "Invalid item_id" });
    }

    const { error } = await supabase.from("wholesale_list_members").insert({
      wholesale_list_id: req.params.listId,
      item_id: itemId,
      created_by: uid,
    });
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Item already on list" });
      }
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/wholesale-lists/:listId/members/:itemId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("wholesale_list_members")
      .delete()
      .eq("wholesale_list_id", req.params.listId)
      .eq("item_id", req.params.itemId);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/wholesale-lists/:listId/wholesale-prices", async (req, res) => {
  try {
    const uid = userId(req);
    const itemId = String(req.body?.item_id ?? "").trim();
    const rawPrice = req.body?.wholesale_price;
    if (!itemId) return res.status(400).json({ error: "item_id is required" });
    if (rawPrice == null || rawPrice === "") {
      return res.status(400).json({ error: "wholesale_price is required" });
    }
    const wholesale_price = Number(rawPrice);
    if (!Number.isFinite(wholesale_price) || wholesale_price < 0) {
      return res.status(400).json({ error: "Invalid wholesale_price" });
    }

    const { data: member } = await supabase
      .from("wholesale_list_members")
      .select("id")
      .eq("wholesale_list_id", req.params.listId)
      .eq("item_id", itemId)
      .maybeSingle();
    if (!member) {
      return res.status(400).json({ error: "Item is not on this list" });
    }

    const { data: line, error } = await supabase
      .from("wholesale_list_lines")
      .insert({
        wholesale_list_id: req.params.listId,
        item_id: itemId,
        wholesale_price,
        created_by: uid,
      })
      .select("id, item_id, wholesale_price, created_at")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ line });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/wholesale-lists/:listId/costs", async (req, res) => {
  try {
    const tid = tenantId(req);
    const itemIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];

    const { listId } = req.params;
    const { data: memRows } = await supabase
      .from("wholesale_list_members")
      .select("item_id")
      .eq("wholesale_list_id", listId);
    const memberIds = await purgeDirectDeprecatedMembers(
      "wholesale",
      listId,
      (memRows ?? []).map((m) => m.item_id),
      tid,
    );
    let seeds = memberIds;
    if (itemIds.length > 0) {
      const valid = await validatePreppedMenuItemIds(tid, itemIds);
      seeds = [...new Set([...memberIds, ...valid])];
    }

    const costs = await computeScopedBreakdownCosts(tid, seeds);
    res.json({ costs });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// =============================================================================
// Menu cost lists
// =============================================================================

router.get("/menu-cost-lists", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .select("id, name, mode, wholesale_list_id, caution, over, created_at")
        .order("name"),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ lists: data ?? [] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/menu-cost-lists/wholesale-list-options", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase.from("wholesale_lists").select("id, name").order("name"),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ lists: data ?? [] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/menu-cost-lists", async (req, res) => {
  try {
    const tid = tenantId(req);
    const uid = userId(req);
    const name = String(req.body?.name ?? "").trim();
    const mode = req.body?.mode === "franchise" ? "franchise" : "company_owned";
    const wholesaleListId =
      req.body?.wholesale_list_id != null
        ? String(req.body.wholesale_list_id).trim() || null
        : null;
    const itemIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];

    if (!name) return res.status(400).json({ error: "name is required" });
    if (mode === "franchise" && !wholesaleListId) {
      return res.status(400).json({ error: "wholesale_list_id required for franchise" });
    }

    let thresholds: { caution: number | null; over: number | null };
    try {
      thresholds = parseLcogThresholdPair(req.body);
    } catch (e: unknown) {
      return res
        .status(400)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }

    if (mode === "franchise" && wholesaleListId) {
      const { data: wl } = await withTenantFilter(
        supabase
          .from("wholesale_lists")
          .select("id")
          .eq("id", wholesaleListId)
          .maybeSingle(),
        req,
      );
      if (!wl) return res.status(400).json({ error: "Invalid wholesale_list_id" });
    }

    const validIds = await validatePreppedMenuItemIds(tid, itemIds, {
      allowCrossTenant: mode === "company_owned",
    });

    const { data: list, error: listErr } = await supabase
      .from("menu_cost_lists")
      .insert({
        tenant_id: tid,
        name,
        mode,
        wholesale_list_id: mode === "franchise" ? wholesaleListId : null,
        created_by: uid,
        caution: thresholds.caution,
        over: thresholds.over,
      })
      .select("id, name, mode, wholesale_list_id, caution, over, created_at")
      .single();
    if (listErr) return res.status(500).json({ error: listErr.message });

    const memberCostBasis = parseMemberCostBasisBody(req.body);
    const costBasisByItem = await resolveInsertCostBasis(
      tid,
      mode,
      mode === "franchise" ? wholesaleListId : null,
      validIds,
      memberCostBasis,
    );

    if (validIds.length > 0) {
      const { error: memInsErr } = await supabase
        .from("menu_cost_list_members")
        .insert(
          validIds.map((item_id) => ({
            menu_cost_list_id: list.id,
            item_id,
            cost_basis: costBasisByItem.get(item_id) ?? "corporate",
            created_by: uid,
          })),
        );
      if (memInsErr) return res.status(500).json({ error: memInsErr.message });
    }

    const members = await loadListMemberRows(tid, "menu", list.id, validIds, {
      mode: list.mode,
      wholesale_list_id: list.wholesale_list_id,
    });

    res.status(201).json({ list, members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/menu-cost-lists/:listId", async (req, res) => {
  try {
    const tid = tenantId(req);
    const { listId } = req.params;

    const { data: list, error: listErr } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .select("id, name, mode, wholesale_list_id, caution, over, created_at")
        .eq("id", listId)
        .maybeSingle(),
      req,
    );
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const { data: memRows } = await supabase
      .from("menu_cost_list_members")
      .select("item_id")
      .eq("menu_cost_list_id", listId);
    const itemIds = (memRows ?? []).map((m) => m.item_id);
    const members = await loadListMemberRows(tid, "menu", listId, itemIds, {
      mode: list.mode,
      wholesale_list_id: list.wholesale_list_id,
    });

    res.json({ list, members });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/menu-cost-lists/:listId", async (req, res) => {
  try {
    const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
    const mode =
      req.body?.mode === "franchise"
        ? "franchise"
        : req.body?.mode === "company_owned"
          ? "company_owned"
          : undefined;
    const wholesaleListId =
      req.body?.wholesale_list_id !== undefined
        ? req.body.wholesale_list_id == null
          ? null
          : String(req.body.wholesale_list_id).trim() || null
        : undefined;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      updates.name = name;
    }
    if (mode !== undefined) {
      updates.mode = mode;
      if (mode === "company_owned") updates.wholesale_list_id = null;
      else if (wholesaleListId === undefined) {
        return res.status(400).json({
          error: "wholesale_list_id required when switching to franchise",
        });
      }
    }
    if (wholesaleListId !== undefined && (mode === "franchise" || mode === undefined)) {
      if (mode !== "company_owned") updates.wholesale_list_id = wholesaleListId;
    }
    if (req.body?.caution !== undefined || req.body?.over !== undefined) {
      try {
        const thresholds = parseLcogThresholdPair({
          caution:
            req.body?.caution !== undefined ? req.body.caution : null,
          over: req.body?.over !== undefined ? req.body.over : null,
        });
        updates.caution = thresholds.caution;
        updates.over = thresholds.over;
      } catch (e: unknown) {
        return res
          .status(400)
          .json({ error: e instanceof Error ? e.message : String(e) });
      }
    }

    const { data, error } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .update(updates)
        .eq("id", req.params.listId)
        .select("id, name, mode, wholesale_list_id, caution, over, created_at")
        .maybeSingle(),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "List not found" });
    res.json({ list: data });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/menu-cost-lists/:listId", async (req, res) => {
  try {
    const { error } = await withTenantFilter(
      supabase.from("menu_cost_lists").delete().eq("id", req.params.listId),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/menu-cost-lists/:listId/members", async (req, res) => {
  try {
    const uid = userId(req);
    const tid = tenantId(req);
    const itemId = String(req.body?.item_id ?? "").trim();
    if (!itemId) return res.status(400).json({ error: "item_id is required" });
    const listMode = await getMenuCostListMode(req.params.listId, tid);
    if (!listMode) return res.status(404).json({ error: "List not found" });
    const valid = await validatePreppedMenuItemIds(tid, [itemId], {
      allowCrossTenant: listMode === "company_owned",
    });
    if (valid.length === 0) return res.status(400).json({ error: "Invalid item_id" });

    const { error } = await supabase.from("menu_cost_list_members").insert({
      menu_cost_list_id: req.params.listId,
      item_id: itemId,
      created_by: uid,
    });
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Item already on list" });
      }
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/menu-cost-lists/:listId/members/:itemId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("menu_cost_list_members")
      .delete()
      .eq("menu_cost_list_id", req.params.listId)
      .eq("item_id", req.params.itemId);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch(
  "/menu-cost-lists/:listId/members/:itemId/cost-basis",
  async (req, res) => {
    try {
      const { listId, itemId } = req.params;
      const rawBasis = req.body?.cost_basis;
      if (rawBasis !== "corporate" && rawBasis !== "wholesale") {
        return res.status(400).json({ error: "cost_basis must be corporate or wholesale" });
      }

      const { data: list, error: listErr } = await withTenantFilter(
        supabase
          .from("menu_cost_lists")
          .select("id, mode, wholesale_list_id")
          .eq("id", listId)
          .maybeSingle(),
        req,
      );
      if (listErr || !list) {
        return res.status(404).json({ error: "List not found" });
      }

      const { data: member } = await supabase
        .from("menu_cost_list_members")
        .select("item_id")
        .eq("menu_cost_list_id", listId)
        .eq("item_id", itemId)
        .maybeSingle();
      if (!member) {
        return res.status(404).json({ error: "Member not found" });
      }

      let cost_basis: CostBasis = rawBasis;
      if (list.mode === "company_owned") {
        cost_basis = "corporate";
      } else if (rawBasis === "wholesale" && list.wholesale_list_id) {
        const tid = tenantId(req);
        const impact = await computeWholesaleRecipeImpactByItem(
          tid,
          list.wholesale_list_id,
          [itemId],
        );
        if (!wholesaleCostBasisSelectableFlag(impact.has(itemId))) {
          return res.status(400).json({
            error: "Wholesale cost basis not available for this item",
          });
        }
      } else if (rawBasis === "wholesale") {
        return res.status(400).json({
          error: "Wholesale cost basis requires a linked wholesale list",
        });
      }

      const { error } = await supabase
        .from("menu_cost_list_members")
        .update({ cost_basis })
        .eq("menu_cost_list_id", listId)
        .eq("item_id", itemId);
      if (error) return res.status(500).json({ error: error.message });

      res.json({ ok: true, cost_basis });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

router.post("/menu-cost-lists/:listId/retail-prices", async (req, res) => {
  try {
    const uid = userId(req);
    const itemId = String(req.body?.item_id ?? "").trim();
    const rawPrice = req.body?.retail_price;
    if (!itemId) return res.status(400).json({ error: "item_id is required" });
    if (rawPrice == null || rawPrice === "") {
      return res.status(400).json({ error: "retail_price is required" });
    }
    const retail_price = Number(rawPrice);
    if (!Number.isFinite(retail_price) || retail_price < 0) {
      return res.status(400).json({ error: "Invalid retail_price" });
    }

    const { data: member } = await supabase
      .from("menu_cost_list_members")
      .select("id")
      .eq("menu_cost_list_id", req.params.listId)
      .eq("item_id", itemId)
      .maybeSingle();
    if (!member) {
      return res.status(400).json({ error: "Item is not on this list" });
    }

    const { data: line, error } = await supabase
      .from("menu_cost_list_lines")
      .insert({
        menu_cost_list_id: req.params.listId,
        item_id: itemId,
        retail_price,
        created_by: uid,
      })
      .select("id, item_id, retail_price, created_at")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ line });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/menu-cost-lists/:listId/costs", async (req, res) => {
  try {
    const tid = tenantId(req);
    const { listId } = req.params;

    const { data: list, error: listErr } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .select("id, mode, wholesale_list_id")
        .eq("id", listId)
        .maybeSingle(),
      req,
    );
    if (listErr || !list) {
      return res.status(404).json({ error: "List not found" });
    }

    const { data: memRows } = await supabase
      .from("menu_cost_list_members")
      .select("item_id, cost_basis")
      .eq("menu_cost_list_id", listId);
    const bodyIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];
    const bodyMembers = Array.isArray(req.body?.members)
      ? (req.body.members as Array<{ item_id?: string; cost_basis?: string }>)
      : [];
    const bodyBasisByItem = new Map<string, CostBasis>();
    for (const m of bodyMembers) {
      if (!m.item_id) continue;
      bodyBasisByItem.set(
        m.item_id,
        m.cost_basis === "wholesale" ? "wholesale" : "corporate",
      );
    }

    let itemIds = await purgeDirectDeprecatedMembers(
      "menu",
      listId,
      (memRows ?? []).map((m) => m.item_id),
      tid,
    );
    if (bodyIds.length > 0) {
      const valid = await validatePreppedMenuItemIds(tid, bodyIds, {
        allowCrossTenant: list.mode === "company_owned",
      });
      itemIds = [...new Set([...itemIds, ...valid])];
    }
    if (itemIds.length === 0) {
      return res.json({ costs: {} });
    }

    const storedBasis = new Map<string, CostBasis>();
    for (const row of memRows ?? []) {
      storedBasis.set(
        row.item_id,
        row.cost_basis === "wholesale" ? "wholesale" : "corporate",
      );
    }

    const costMembers = itemIds.map((item_id) => ({
      item_id,
      cost_basis:
        bodyBasisByItem.get(item_id) ??
        storedBasis.get(item_id) ??
        ("corporate" as CostBasis),
    }));

    const costs = await computeMenuCostListCosts(
      tid,
      costMembers,
      list.mode,
      list.wholesale_list_id,
    );

    res.json({ costs });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function parsePrintPresetColumns(raw: unknown): {
  item: boolean;
  type: boolean;
  cost: boolean;
  price: boolean;
  lcog: boolean;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("columns object is required");
  }
  const c = raw as Record<string, unknown>;
  const cols = {
    item: c.item === true,
    type: c.type === true,
    cost: c.cost === true,
    price: c.price === true,
    lcog: c.lcog === true,
  };
  if (!Object.values(cols).some(Boolean)) {
    throw new Error("Select at least one column");
  }
  return cols;
}

router.get("/print-presets", async (req, res) => {
  try {
    tenantId(req);
    const reportType = String(req.query.report_type ?? "").toLowerCase();
    if (reportType !== "wholesale" && reportType !== "retail") {
      return res
        .status(400)
        .json({ error: "report_type must be wholesale or retail" });
    }
    const { data, error } = await withTenantFilter(
      supabase
        .from("recipe_cost_report_print_presets")
        .select(
          "preset_slot, name, col_item, col_type, col_cost, col_price, col_lcog",
        )
        .eq("report_type", reportType)
        .order("preset_slot"),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      presets: (data ?? []).map((row) => ({
        preset_slot: row.preset_slot,
        name: row.name,
        columns: {
          item: row.col_item,
          type: row.col_type,
          cost: row.col_cost,
          price: row.col_price,
          lcog: row.col_lcog,
        },
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.put("/print-presets/:slot", async (req, res) => {
  try {
    const tid = tenantId(req);
    const slot = parseInt(String(req.params.slot), 10);
    if (!Number.isFinite(slot) || slot < 1 || slot > 4) {
      return res.status(400).json({ error: "preset slot must be 1–4" });
    }
    const reportType = String(req.body?.report_type ?? "").toLowerCase();
    if (reportType !== "wholesale" && reportType !== "retail") {
      return res
        .status(400)
        .json({ error: "report_type must be wholesale or retail" });
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    let columns;
    try {
      columns = parsePrintPresetColumns(req.body?.columns);
    } catch (e: unknown) {
      return res
        .status(400)
        .json({ error: e instanceof Error ? e.message : String(e) });
    }

    const row = {
      tenant_id: tid,
      report_type: reportType,
      preset_slot: slot,
      name,
      col_item: columns.item,
      col_type: columns.type,
      col_cost: columns.cost,
      col_price: columns.price,
      col_lcog: columns.lcog,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("recipe_cost_report_print_presets")
      .upsert(row, { onConflict: "tenant_id,report_type,preset_slot" })
      .select(
        "preset_slot, name, col_item, col_type, col_cost, col_price, col_lcog",
      )
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      preset: {
        preset_slot: data.preset_slot,
        name: data.name,
        columns: {
          item: data.col_item,
          type: data.col_type,
          cost: data.col_cost,
          price: data.col_price,
          lcog: data.col_lcog,
        },
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Candidate prepped/menu items for create modal & add-item picker */
router.get("/item-candidates", async (req, res) => {
  try {
    const tid = tenantId(req);
    const includeCrossTenant =
      String(req.query.include_cross_tenant ?? "").toLowerCase() === "true";
    const items = await fetchRecipeCostReportItemCandidates(
      tid,
      includeCrossTenant,
    );
    res.json({ items });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
