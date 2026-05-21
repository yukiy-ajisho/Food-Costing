import { Router, type Request } from "express";
import { supabase } from "../config/supabase";
import { withTenantFilter } from "../middleware/tenant-filter";
import {
  applyLatestPricesToSheet,
  buildStandardSnapshot,
  buildTechnicalSheet,
  type TechnicalSheetPayload,
} from "../services/technical-sheet-builder";
import {
  computeHasRecipeDiff,
  ensureStandardV0,
  getLatestStandardSheet,
  getRecipeDiffForLatest,
  insertStandardVersion,
  listVersionsForSource,
  saveStandardSheetEdits,
  type StandardSheetEditPayload,
} from "../services/standard-technical-sheet";
import type { StandardSnapshot } from "../services/technical-sheet-builder";
import { RecipeDependencyCycleError } from "../services/cycle-detection-cross-tenant";

const router = Router();

function parseSheetEditPayload(body: unknown): StandardSheetEditPayload {
  const raw = body as Record<string, unknown>;
  const rawRows = raw?.ingredient_rows;
  if (!Array.isArray(rawRows)) {
    throw new Error("ingredient_rows must be an array");
  }
  const ingredient_rows = rawRows
    .map((e: Record<string, unknown>) => ({
      item_id: String(e.item_id ?? "").trim(),
      total_grams: Number(e.total_grams),
      specific_child:
        e.specific_child === undefined
          ? undefined
          : e.specific_child == null
            ? null
            : String(e.specific_child),
      step_quantities:
        e.step_quantities && typeof e.step_quantities === "object"
          ? (e.step_quantities as Record<string, number>)
          : undefined,
    }))
    .filter(
      (e) =>
        e.item_id.length > 0 &&
        Number.isFinite(e.total_grams) &&
        e.total_grams > 0,
    );

  return { ingredient_rows, labor_rows: parseLaborRows(raw?.labor_rows) };
}

function parseLaborRows(raw: unknown): Array<{
  row_key?: string | null;
  labor_role: string;
  minutes: number;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: Record<string, unknown>) => ({
      row_key:
        e.row_key === undefined || e.row_key === null
          ? null
          : String(e.row_key).trim() || null,
      labor_role: String(e.labor_role ?? "").trim(),
      minutes: Number(e.minutes),
    }))
    .filter(
      (e) =>
        e.labor_role.length > 0 &&
        Number.isFinite(e.minutes) &&
        e.minutes > 0,
    );
}

function parseOptionalTextField(
  raw: unknown,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCreateVersionBody(body: unknown): {
  description?: string | null;
  procedure?: string | null;
} {
  const raw = body as Record<string, unknown>;
  return {
    description: parseOptionalTextField(raw?.description),
    procedure: parseOptionalTextField(raw?.procedure),
  };
}

function selectedTenantId(req: Request): string {
  const id = req.user?.selected_tenant_id || req.user?.tenant_ids?.[0];
  if (!id) throw new Error("No tenant associated");
  return id;
}

function tenantIds(req: Request): string[] {
  return req.user?.tenant_ids ?? [];
}

async function loadSourceItem(sourceItemId: string) {
  const { data, error } = await supabase
    .from("items")
    .select("id, name, item_kind, tenant_id, is_menu_item, description")
    .eq("id", sourceItemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.item_kind !== "prepped") return null;
  return data;
}

function enrichSheetProduct(
  sheet: TechnicalSheetPayload,
  item: { id: string; name: string | null },
): TechnicalSheetPayload {
  return {
    ...sheet,
    product: {
      item_id: item.id,
      name: (item.name ?? "").trim() || "(Unnamed)",
      description: null,
    },
  };
}

/** List base recipes (prepped items with at least one ingredient line) for Recipe Summary tab */
router.get("/base-recipes", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);

    let itemsQuery = supabase
      .from("items")
      .select("id, name, is_menu_item, tenant_id, deprecated")
      .eq("item_kind", "prepped")
      .is("deprecated", null)
      .order("name", { ascending: true });
    itemsQuery = withTenantFilter(itemsQuery, req);

    const { data: items, error: itemsErr } = await itemsQuery;
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length === 0) return res.json([]);

    const { data: lineRows, error: linesErr } = await supabase
      .from("recipe_lines")
      .select("parent_item_id")
      .eq("line_type", "ingredient")
      .in("parent_item_id", itemIds);
    if (linesErr) return res.status(500).json({ error: linesErr.message });

    const withRecipe = new Set((lineRows ?? []).map((r) => r.parent_item_id));
    const baseItems = (items ?? []).filter((i) => withRecipe.has(i.id));

    const latestBySource = new Map<
      string,
      {
        id: string;
        source_item_id: string;
        version_number: number;
        is_latest: boolean;
      }
    >();
    const baseIds = baseItems.map((i) => i.id);
    if (baseIds.length > 0) {
      const { data: latestSheets, error: sheetsErr } = await supabase
        .from("standard_technical_sheets")
        .select("id, source_item_id, version_number, is_latest")
        .eq("tenant_id", tenantId)
        .eq("is_latest", true)
        .in("source_item_id", baseIds);
      if (sheetsErr) return res.status(500).json({ error: sheetsErr.message });
      for (const s of latestSheets ?? []) {
        latestBySource.set(s.source_item_id, s);
      }
    }

    // v0 is created lazily when opening Show Standard (ensure-v0) or on new prepped item save.
    // Do not run ensureV0 here — it builds a full snapshot per item and blocks the list for a long time.

    return res.json(
      baseItems.map((item) => {
        const latest = latestBySource.get(item.id);
        return {
          source_item_id: item.id,
          name: item.name,
          is_menu_item: item.is_menu_item,
          latest_version_id: latest?.id ?? null,
          latest_version_number: latest?.version_number ?? null,
          has_standard_sheet: !!latest,
        };
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Version list for one base recipe */
router.get("/items/:sourceItemId/versions", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);
    const sourceItemId = String(req.params.sourceItemId ?? "").trim();
    if (!sourceItemId)
      return res.status(400).json({ error: "sourceItemId is required" });

    const item = await loadSourceItem(sourceItemId);
    if (!item) return res.status(404).json({ error: "base recipe not found" });

    const versions = await listVersionsForSource(tenantId, sourceItemId);
    return res.json({ source_item_id: sourceItemId, versions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Recipe diff (latest version only) */
router.get("/:id/recipe-diff", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    let query = supabase
      .from("standard_technical_sheets")
      .select("*")
      .eq("id", id);
    query = withTenantFilter(query, req);
    const { data: row, error } = await query.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row)
      return res
        .status(404)
        .json({ error: "standard technical sheet not found" });
    if (!row.is_latest) {
      return res
        .status(404)
        .json({
          error: "recipe diff is only available for the latest version",
        });
    }

    const snapshot = row.snapshot as StandardSnapshot;
    const diff = await getRecipeDiffForLatest(
      snapshot,
      row.source_item_id,
      tenantIds(req),
    );
    return res.json(diff);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Edit save: apply sheet to recipe + new version */
router.post("/:id/save-edits", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    let query = supabase
      .from("standard_technical_sheets")
      .select("*")
      .eq("id", id);
    query = withTenantFilter(query, req);
    const { data: row, error } = await query.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row)
      return res
        .status(404)
        .json({ error: "standard technical sheet not found" });
    if (!row.is_latest) {
      return res
        .status(400)
        .json({ error: "only the latest version can be edited" });
    }

    let payload: StandardSheetEditPayload;
    try {
      payload = parseSheetEditPayload(req.body);
    } catch (parseErr: unknown) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      return res.status(400).json({ error: message });
    }
    if (!payload.ingredient_rows.length) {
      return res
        .status(400)
        .json({ error: "ingredient_rows must contain at least one row" });
    }

    const { description, procedure } = parseCreateVersionBody(req.body);
    const inserted = await saveStandardSheetEdits({
      tenantId,
      tenantIds: tenantIds(req),
      sourceItemId: row.source_item_id,
      createdBy: req.user!.id,
      description:
        description !== undefined ? description : (row.description ?? null),
      procedure:
        procedure !== undefined ? procedure : (row.procedure ?? null),
      payload,
    });

    return res.status(201).json({
      id: inserted.id,
      version_number: inserted.version_number,
      is_latest: true,
    });
  } catch (error: unknown) {
    if (error instanceof RecipeDependencyCycleError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Get one version (display payload + flags) */
router.get("/:id", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    let query = supabase
      .from("standard_technical_sheets")
      .select("*")
      .eq("id", id);
    query = withTenantFilter(query, req);
    const { data: row, error } = await query.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row)
      return res
        .status(404)
        .json({ error: "standard technical sheet not found" });

    const snapshot = row.snapshot as StandardSnapshot;
    const item = await loadSourceItem(row.source_item_id);
    if (!item) return res.status(404).json({ error: "source item not found" });

    const hasRecipeDiff =
      row.is_latest &&
      (await computeHasRecipeDiff(
        snapshot,
        row.source_item_id,
        tenantIds(req),
      ));

    const priceMode = String(req.query.price_mode ?? "latest").toLowerCase();
    let ingredientRows = snapshot.sheet.ingredient_rows;
    let totalCost = snapshot.sheet.total_ingredient_cost;
    let laborRows = snapshot.sheet.labor_rows ?? [];
    let totalLaborCost = snapshot.sheet.total_labor_cost ?? null;
    let hasUnpricedLines = false;

    if (priceMode === "latest") {
      const repriced = await applyLatestPricesToSheet(
        snapshot.sheet,
        tenantIds(req),
      );
      ingredientRows = repriced.ingredient_rows;
      totalCost = repriced.total_ingredient_cost;
      laborRows = repriced.labor_rows;
      totalLaborCost = repriced.total_labor_cost;
      hasUnpricedLines = repriced.has_unpriced_lines;
    }

    const sheet: TechnicalSheetPayload = {
      product: {
        item_id: row.source_item_id,
        name: (item.name ?? "").trim() || "(Unnamed)",
        description: null,
      },
      steps: snapshot.sheet.steps,
      ingredient_rows: ingredientRows,
      total_ingredient_cost: totalCost,
      labor_rows: laborRows,
      total_labor_cost: totalLaborCost,
    };

    return res.json({
      id: row.id,
      tenant_id: row.tenant_id,
      source_item_id: row.source_item_id,
      version_number: row.version_number,
      is_latest: row.is_latest,
      created_at: row.created_at,
      created_by: row.created_by,
      description: row.description ?? null,
      procedure: row.procedure ?? null,
      sheet,
      snapshot,
      has_recipe_diff: hasRecipeDiff,
      has_unpriced_lines: hasUnpricedLines,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Preview TS from live recipe (no save) */
router.post(
  "/items/:sourceItemId/preview-from-latest-recipe",
  async (req, res) => {
    try {
      const sourceItemId = String(req.params.sourceItemId ?? "").trim();
      if (!sourceItemId)
        return res.status(400).json({ error: "sourceItemId is required" });

      const item = await loadSourceItem(sourceItemId);
      if (!item)
        return res.status(404).json({ error: "base recipe not found" });

      const sheet = await buildTechnicalSheet({
        sourceItemId,
        tenantIds: tenantIds(req),
        expandItemIds: new Set(),
      });
      return res.json(enrichSheetProduct(sheet, item));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    }
  },
);

/** Create new version from live recipe */
router.post("/items/:sourceItemId/from-latest-recipe", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);
    const sourceItemId = String(req.params.sourceItemId ?? "").trim();
    if (!sourceItemId)
      return res.status(400).json({ error: "sourceItemId is required" });

    const item = await loadSourceItem(sourceItemId);
    if (!item) return res.status(404).json({ error: "base recipe not found" });

    const latest = await getLatestStandardSheet(tenantId, sourceItemId);
    const { description, procedure } = parseCreateVersionBody(req.body);
    const normalizedDescription =
      description === undefined ? null : description;
    const normalizedProcedure = procedure === undefined ? null : procedure;

    if (latest) {
      const hasDiff = await computeHasRecipeDiff(
        latest.snapshot,
        sourceItemId,
        tenantIds(req),
      );
      const textChanged =
        (description !== undefined &&
          normalizedDescription !== (latest.description ?? null)) ||
        (procedure !== undefined &&
          normalizedProcedure !== (latest.procedure ?? null));
      if (!hasDiff && !textChanged) {
        return res.status(400).json({
          error: "Current recipe matches the latest technical sheet.",
          code: "no_recipe_diff",
        });
      }
    }

    const snapshot = await buildStandardSnapshot({
      sourceItemId,
      tenantIds: tenantIds(req),
      expandItemIds: new Set(),
    });

    const inserted = await insertStandardVersion({
      tenantId,
      sourceItemId,
      snapshot,
      createdBy: req.user!.id,
      description:
        description !== undefined ? normalizedDescription : latest?.description ?? null,
      procedure:
        procedure !== undefined ? normalizedProcedure : latest?.procedure ?? null,
    });

    return res.status(201).json({
      id: inserted.id,
      version_number: inserted.version_number,
      is_latest: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

/** Ensure v0 exists (idempotent) */
router.post("/ensure-v0", async (req, res) => {
  try {
    const tenantId = selectedTenantId(req);
    const sourceItemIdsRaw = req.body?.source_item_ids;
    if (!Array.isArray(sourceItemIdsRaw)) {
      return res
        .status(400)
        .json({ error: "source_item_ids must be an array" });
    }
    const sourceItemIds = [
      ...new Set(
        sourceItemIdsRaw
          .map((v) => String(v).trim())
          .filter((s) => s.length > 0),
      ),
    ];
    const created: Array<{
      source_item_id: string;
      id: string;
      version_number: number;
    }> = [];
    const errors: Array<{ source_item_id: string; error: string }> = [];

    for (const sourceItemId of sourceItemIds) {
      try {
        const item = await loadSourceItem(sourceItemId);
        if (!item || item.tenant_id !== tenantId) continue;
        const row = await ensureStandardV0({
          tenantId,
          sourceItemId,
          tenantIds: tenantIds(req),
          createdBy: req.user!.id,
        });
        if (row) {
          created.push({
            source_item_id: sourceItemId,
            id: row.id,
            version_number: row.version_number,
          });
        }
      } catch (itemErr: unknown) {
        const message =
          itemErr instanceof Error ? itemErr.message : String(itemErr);
        errors.push({ source_item_id: sourceItemId, error: message });
      }
    }

    return res.json({ created, errors });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
