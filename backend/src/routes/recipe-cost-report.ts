import { Router, type NextFunction, type Request, type Response } from "express";
import { supabase } from "../config/supabase";
import { authorizeRecipeCostReportAccess } from "../authz/unified/authorize";
import { withTenantFilter } from "../middleware/tenant-filter";
import {
  computeFranchiseMenuCosts,
  computeScopedBreakdownCosts,
} from "../services/franchise-menu-cost";
import {
  fetchRecipeCostReportItemCandidates,
  getMenuCostListMode,
  loadListMemberRows,
  purgeDirectDeprecatedMembers,
  validatePreppedMenuItemIds,
} from "../services/recipe-cost-report-data";

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

// =============================================================================
// Wholesale lists
// =============================================================================

router.get("/wholesale-lists", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase.from("wholesale_lists").select("id, name, created_at").order("name"),
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

    const validIds = await validatePreppedMenuItemIds(tid, itemIds);

    const { data: list, error: listErr } = await supabase
      .from("wholesale_lists")
      .insert({ tenant_id: tid, name, created_by: uid })
      .select("id, name, created_at")
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
        .select("id, name, created_at")
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
    const updates: Record<string, string> = {};
    if (name !== undefined) updates.name = name;

    const { data, error } = await withTenantFilter(
      supabase
        .from("wholesale_lists")
        .update(updates)
        .eq("id", req.params.listId)
        .select("id, name, created_at")
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

router.delete("/wholesale-lists/:listId", async (req, res) => {
  try {
    const { error } = await withTenantFilter(
      supabase.from("wholesale_lists").delete().eq("id", req.params.listId),
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
        .select("id, name, mode, wholesale_list_id, created_at")
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
      })
      .select("id, name, mode, wholesale_list_id, created_at")
      .single();
    if (listErr) return res.status(500).json({ error: listErr.message });

    if (validIds.length > 0) {
      await supabase.from("menu_cost_list_members").insert(
        validIds.map((item_id) => ({
          menu_cost_list_id: list.id,
          item_id,
          created_by: uid,
        })),
      );
    }

    const members = await loadListMemberRows(tid, "menu", list.id, validIds);

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
        .select("id, name, mode, wholesale_list_id, created_at")
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
    const members = await loadListMemberRows(tid, "menu", listId, itemIds);

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

    const { data, error } = await withTenantFilter(
      supabase
        .from("menu_cost_lists")
        .update(updates)
        .eq("id", req.params.listId)
        .select("id, name, mode, wholesale_list_id, created_at")
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
      .select("item_id")
      .eq("menu_cost_list_id", listId);
    const bodyIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];

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

    let costs: Record<string, unknown>;
    if (list.mode === "franchise" && list.wholesale_list_id) {
      costs = await computeFranchiseMenuCosts(
        tid,
        itemIds,
        list.wholesale_list_id,
      );
    } else {
      costs = await computeScopedBreakdownCosts(tid, itemIds);
    }

    res.json({ costs });
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
