import { supabase } from "../config/supabase";
import type { Item, RecipeLine } from "../types/database";
import {
  buildRecipeDiffLines,
  buildLaborDiffLines,
  buildRecipeSnapshotLines,
  buildLaborSnapshotLines,
  buildStandardSnapshot,
  compareIngredientSnapshotsAsync,
  compareLaborSnapshots,
  compareRecipeSnapshotsAsync,
  isIngredientSnapshotLine,
  isLaborSnapshotLine,
  laborSnapshotLinesToDisplay,
  recipeSnapshotLinesToDisplay,
  type LaborDiffLine,
  type LaborSnapshotDisplayLine,
  type RecipeDiffLine,
  type RecipeSnapshotDisplayLine,
  type StandardSnapshot,
  type TechnicalSheetPayload,
} from "./technical-sheet-builder";
import { quantityFromGrams } from "./units";
import { checkCycleCrossTenant } from "./cycle-detection-cross-tenant";

export type StandardTechnicalSheetRow = {
  id: string;
  tenant_id: string;
  source_item_id: string;
  version_number: number;
  is_latest: boolean;
  description: string | null;
  procedure: string | null;
  snapshot: StandardSnapshot;
  created_by: string;
  created_at: string;
};

export async function getLatestStandardSheet(
  tenantId: string,
  sourceItemId: string,
): Promise<StandardTechnicalSheetRow | null> {
  const { data, error } = await supabase
    .from("standard_technical_sheets")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_item_id", sourceItemId)
    .eq("is_latest", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as StandardTechnicalSheetRow | null;
}

type RpcVersionRow = {
  id: string;
  version_number: number;
  is_latest: boolean;
};

function parseRpcRow(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function parseRpcVersionRow(data: unknown): RpcVersionRow | null {
  const r = parseRpcRow(data);
  if (!r) return null;
  const id = r.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return {
    id,
    version_number: Number(r.version_number),
    is_latest: Boolean(r.is_latest),
  };
}

async function loadStandardSheetRowById(
  id: string,
): Promise<StandardTechnicalSheetRow> {
  const { data: full, error: loadErr } = await supabase
    .from("standard_technical_sheets")
    .select("*")
    .eq("id", id)
    .single();
  if (loadErr) throw new Error(loadErr.message);
  return full as StandardTechnicalSheetRow;
}

export async function listVersionsForSource(
  tenantId: string,
  sourceItemId: string,
): Promise<
  Array<{
    id: string;
    version_number: number;
    is_latest: boolean;
    created_at: string;
    created_by: string;
  }>
> {
  const { data, error } = await supabase
    .from("standard_technical_sheets")
    .select("id, version_number, is_latest, created_at, created_by")
    .eq("tenant_id", tenantId)
    .eq("source_item_id", sourceItemId)
    .order("version_number", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function insertStandardVersion(params: {
  tenantId: string;
  sourceItemId: string;
  snapshot: StandardSnapshot;
  createdBy: string;
  description?: string | null;
  procedure?: string | null;
}): Promise<StandardTechnicalSheetRow> {
  const { tenantId, sourceItemId, snapshot, createdBy, description, procedure } =
    params;

  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    "insert_standard_technical_sheet_version_atomic",
    {
      p_tenant_id: tenantId,
      p_source_item_id: sourceItemId,
      p_snapshot: snapshot,
      p_created_by: createdBy,
      p_description: description ?? null,
      p_procedure: procedure ?? null,
    },
  );
  if (rpcErr) {
    throw new Error(
      `insert_standard_technical_sheet_version_atomic failed: ${rpcErr.message}. ` +
        "Apply migration 20260520143000_fix_standard_ts_insert_is_latest_ambiguous.sql.",
    );
  }

  const rpcRow = parseRpcVersionRow(rpcRows);
  if (rpcRow) {
    return loadStandardSheetRowById(rpcRow.id);
  }

  const latest = await getLatestStandardSheet(tenantId, sourceItemId);
  if (latest) {
    return latest;
  }

  throw new Error(
    "insert_standard_technical_sheet_version_atomic returned no row and no latest sheet was found.",
  );
}

function isMissingEnsureV0RpcError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("does not exist") ||
    m.includes("42883")
  );
}

/** Fallback when ensure_standard_technical_sheet_v0_if_absent migration is not applied yet. */
async function insertStandardV0Direct(params: {
  tenantId: string;
  sourceItemId: string;
  snapshot: StandardSnapshot;
  createdBy: string;
}): Promise<StandardTechnicalSheetRow | null> {
  const latest = await getLatestStandardSheet(
    params.tenantId,
    params.sourceItemId,
  );
  if (latest) return null;

  const { data: anyRow, error: anyErr } = await supabase
    .from("standard_technical_sheets")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("source_item_id", params.sourceItemId)
    .limit(1)
    .maybeSingle();
  if (anyErr) throw new Error(anyErr.message);
  if (anyRow) return null;

  const { data, error } = await supabase
    .from("standard_technical_sheets")
    .insert({
      tenant_id: params.tenantId,
      source_item_id: params.sourceItemId,
      version_number: 0,
      is_latest: true,
      snapshot: params.snapshot,
      created_by: params.createdBy,
      description: null,
      procedure: null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }
  return data as StandardTechnicalSheetRow;
}

export async function ensureStandardV0(params: {
  tenantId: string;
  sourceItemId: string;
  tenantIds: string[];
  createdBy: string;
}): Promise<StandardTechnicalSheetRow | null> {
  const existing = await getLatestStandardSheet(
    params.tenantId,
    params.sourceItemId,
  );
  if (existing) return null;

  const snapshot = await buildStandardSnapshot({
    sourceItemId: params.sourceItemId,
    tenantIds: params.tenantIds,
    expandItemIds: new Set(),
  });

  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    "ensure_standard_technical_sheet_v0_if_absent",
    {
      p_tenant_id: params.tenantId,
      p_source_item_id: params.sourceItemId,
      p_snapshot: snapshot,
      p_created_by: params.createdBy,
    },
  );
  if (rpcErr) {
    if (isMissingEnsureV0RpcError(rpcErr.message)) {
      return insertStandardV0Direct({
        tenantId: params.tenantId,
        sourceItemId: params.sourceItemId,
        snapshot,
        createdBy: params.createdBy,
      });
    }
    throw new Error(
      `ensure_standard_technical_sheet_v0_if_absent failed: ${rpcErr.message}. ` +
        "Apply migration 20260518150000_ensure_standard_technical_sheet_v0_if_absent.sql.",
    );
  }

  const r = parseRpcRow(rpcRows);
  if (!r) return null;
  const created = r.created === true;
  if (!created) return null;

  const rpcRow = parseRpcVersionRow(rpcRows);
  if (!rpcRow) return null;
  return loadStandardSheetRowById(rpcRow.id);
}

export async function computeHasRecipeDiff(
  snapshot: StandardSnapshot,
  sourceItemId: string,
  tenantIds: string[],
): Promise<boolean> {
  const live = await buildRecipeSnapshotLines(sourceItemId, tenantIds);
  return compareRecipeSnapshotsAsync(snapshot.recipe_snapshot.lines, live);
}

export function sheetFromSnapshot(
  snapshot: StandardSnapshot,
  meta?: { description?: string | null; procedure?: string | null },
): TechnicalSheetPayload & {
  product: TechnicalSheetPayload["product"];
} {
  return {
    product: {
      item_id: snapshot.source_item_id,
      name: "",
      description: meta?.description ?? null,
    },
    steps: snapshot.sheet.steps,
    ingredient_rows: snapshot.sheet.ingredient_rows,
    total_ingredient_cost: snapshot.sheet.total_ingredient_cost,
    labor_rows: snapshot.sheet.labor_rows ?? [],
    total_labor_cost: snapshot.sheet.total_labor_cost ?? null,
  };
}

export async function getRecipeDiffForLatest(
  snapshot: StandardSnapshot,
  sourceItemId: string,
  tenantIds: string[],
): Promise<{
  has_diff: boolean;
  lines: RecipeDiffLine[];
  saved: RecipeSnapshotDisplayLine[];
  live: RecipeSnapshotDisplayLine[];
  labor_has_diff: boolean;
  labor_lines: LaborDiffLine[];
  labor_saved: LaborSnapshotDisplayLine[];
  labor_live: LaborSnapshotDisplayLine[];
}> {
  const savedAll = snapshot.recipe_snapshot.lines;
  const savedIngredients = savedAll.filter(isIngredientSnapshotLine);
  const savedLabor = savedAll.filter(isLaborSnapshotLine);
  const [liveIngredients, liveLabor] = await Promise.all([
    buildRecipeSnapshotLines(sourceItemId, tenantIds),
    buildLaborSnapshotLines(sourceItemId),
  ]);
  const hasIngredientDiff = await compareIngredientSnapshotsAsync(
    savedIngredients,
    liveIngredients,
  );
  const hasLaborDiff = compareLaborSnapshots(savedLabor, liveLabor);
  const lines = await buildRecipeDiffLines(savedAll, [
    ...liveIngredients,
    ...liveLabor,
  ]);
  const labor_lines = buildLaborDiffLines(savedLabor, liveLabor);
  const [saved, liveDisplay] = await Promise.all([
    recipeSnapshotLinesToDisplay(savedAll),
    recipeSnapshotLinesToDisplay([...liveIngredients, ...liveLabor]),
  ]);
  return {
    has_diff: hasIngredientDiff || hasLaborDiff,
    lines,
    saved,
    live: liveDisplay,
    labor_has_diff: hasLaborDiff,
    labor_lines,
    labor_saved: laborSnapshotLinesToDisplay(savedLabor),
    labor_live: laborSnapshotLinesToDisplay(liveLabor),
  };
}

export type SheetIngredientEdit = {
  item_id: string;
  total_grams: number;
  specific_child?: string | null;
  step_quantities?: Record<string, number>;
};

export type SheetLaborEdit = {
  row_key?: string | null;
  labor_role: string;
  minutes: number;
};

export type StandardSheetEditPayload = {
  ingredient_rows: SheetIngredientEdit[];
  labor_rows?: SheetLaborEdit[];
};

export type SheetEditActor = {
  tenantId: string;
  userId: string;
};

function ingredientEditsByChild(
  edits: SheetIngredientEdit[],
): Map<string, SheetIngredientEdit> {
  const editByChild = new Map<string, SheetIngredientEdit>();
  for (const edit of edits) {
    const grams = Number(edit.total_grams);
    if (!edit.item_id || !Number.isFinite(grams) || grams <= 0) continue;
    editByChild.set(edit.item_id, edit);
  }
  return editByChild;
}

function resolveSpecificChild(
  edit: SheetIngredientEdit,
  existingLine: RecipeLine | undefined,
  childItem: Item,
): string | null {
  if (edit.specific_child !== undefined) {
    const sc = edit.specific_child;
    if (!sc || sc === "lowest") return "lowest";
    return sc;
  }
  if (existingLine?.specific_child) return existingLine.specific_child;
  if (childItem.item_kind === "raw") return "lowest";
  return null;
}

/** Reject edits that would create a recipe dependency cycle (before mutating recipe_lines). */
export async function validateSheetEditsNoCycle(
  sourceItemId: string,
  actor: SheetEditActor,
  payload: StandardSheetEditPayload,
): Promise<void> {
  const editByChild = ingredientEditsByChild(payload.ingredient_rows);
  if (editByChild.size === 0) return;

  const { data: existing, error: loadErr } = await supabase
    .from("recipe_lines")
    .select("*")
    .eq("parent_item_id", sourceItemId);
  if (loadErr) throw new Error(loadErr.message);

  const allLines = (existing ?? []) as RecipeLine[];
  const nonIngredient = allLines.filter((l) => l.line_type !== "ingredient");
  const template = allLines[0];

  const { data: parentItem, error: itemErr } = await supabase
    .from("items")
    .select("tenant_id")
    .eq("id", sourceItemId)
    .single();
  if (itemErr) throw new Error(itemErr.message);

  const lineTenantId = template?.tenant_id ?? parentItem.tenant_id;
  const lineUserId = template?.user_id ?? actor.userId;

  const simulatedIngredients: RecipeLine[] = [...editByChild.entries()].map(
    ([childId, edit]) => ({
      id: `overlay-${childId}`,
      parent_item_id: sourceItemId,
      line_type: "ingredient",
      child_item_id: childId,
      quantity: edit.total_grams,
      unit: "g",
      specific_child: "lowest",
      user_id: lineUserId,
      tenant_id: lineTenantId,
    }),
  );

  const overlay = new Map<string, RecipeLine[]>();
  overlay.set(sourceItemId, [...nonIngredient, ...simulatedIngredients]);

  await checkCycleCrossTenant(
    sourceItemId,
    actor.tenantId,
    new Set(),
    new Map(),
    overlay,
    new Map(),
    new Map(),
    [],
    false,
  );
}

export async function applySheetEditsToRecipe(
  sourceItemId: string,
  payload: StandardSheetEditPayload,
  actor: SheetEditActor,
): Promise<void> {
  const { ingredient_rows: edits, labor_rows: laborEdits = [] } = payload;

  const { data: parentItem, error: parentErr } = await supabase
    .from("items")
    .select("tenant_id")
    .eq("id", sourceItemId)
    .single();
  if (parentErr) throw new Error(parentErr.message);

  const { data: existing, error: loadErr } = await supabase
    .from("recipe_lines")
    .select("*")
    .eq("parent_item_id", sourceItemId);
  if (loadErr) throw new Error(loadErr.message);

  const allLines = (existing ?? []) as RecipeLine[];
  const ingredientLines = allLines.filter((l) => l.line_type === "ingredient");
  const lineTemplate = allLines[0];
  const lineTenantId = lineTemplate?.tenant_id ?? parentItem.tenant_id;
  const lineUserId = lineTemplate?.user_id ?? actor.userId;

  const editByChild = ingredientEditsByChild(edits);

  const childIds = [
    ...new Set([
      ...editByChild.keys(),
      ...ingredientLines
        .map((l) => l.child_item_id)
        .filter((id): id is string => !!id),
    ]),
  ];

  const itemMap = new Map<string, Item>();
  const baseItemMap = new Map<string, import("../types/database").BaseItem>();

  if (childIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("*")
      .in("id", childIds);
    if (itemsErr) throw new Error(itemsErr.message);
    for (const item of (items ?? []) as Item[]) {
      itemMap.set(item.id, item);
    }
    const baseIds = [
      ...new Set((items ?? []).map((i) => i.base_item_id).filter(Boolean)),
    ];
    if (baseIds.length > 0) {
      const { data: bases } = await supabase
        .from("base_items")
        .select("*")
        .in("id", baseIds);
      for (const b of bases ?? []) {
        baseItemMap.set(b.id, b);
      }
    }
  }

  const linesByChild = new Map<string, RecipeLine[]>();
  for (const line of ingredientLines) {
    if (!line.child_item_id) continue;
    const group = linesByChild.get(line.child_item_id) ?? [];
    group.push(line);
    linesByChild.set(line.child_item_id, group);
  }

  for (const [childId, lines] of linesByChild) {
    if (!editByChild.has(childId)) {
      for (const line of lines) {
        const { error: delErr } = await supabase
          .from("recipe_lines")
          .delete()
          .eq("id", line.id);
        if (delErr) throw new Error(delErr.message);
      }
    }
  }

  for (const [childId, edit] of editByChild) {
    const grams = edit.total_grams;
    const existingLines = linesByChild.get(childId) ?? [];
    const existingLine = existingLines[0];
    for (let i = 1; i < existingLines.length; i++) {
      const { error: dupDelErr } = await supabase
        .from("recipe_lines")
        .delete()
        .eq("id", existingLines[i].id);
      if (dupDelErr) throw new Error(dupDelErr.message);
    }
    const childItem = itemMap.get(childId);
    if (!childItem) throw new Error(`Ingredient item not found: ${childId}`);

    let quantity = grams;
    let unit = "g";
    let specificChild = resolveSpecificChild(edit, existingLine, childItem);

    if (existingLine?.unit) {
      unit = existingLine.unit;
      try {
        quantity = quantityFromGrams(
          grams,
          unit,
          childId,
          itemMap,
          baseItemMap,
        );
      } catch {
        unit = "g";
        quantity = grams;
      }
    } else if (childItem.item_kind === "raw") {
      unit = "g";
      quantity = grams;
    }

    if (existingLine) {
      const { error: updErr } = await supabase
        .from("recipe_lines")
        .update({
          quantity,
          unit,
          specific_child: specificChild,
        })
        .eq("id", existingLine.id);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { error: insErr } = await supabase.from("recipe_lines").insert({
        parent_item_id: sourceItemId,
        line_type: "ingredient",
        child_item_id: childId,
        quantity,
        unit,
        specific_child: specificChild,
        tenant_id: lineTenantId,
        user_id: lineUserId,
      });
      if (insErr) throw new Error(insErr.message);
    }
  }

  const validLaborEdits = laborEdits.filter(
    (e) =>
      (e.labor_role ?? "").trim().length > 0 &&
      Number.isFinite(Number(e.minutes)) &&
      Number(e.minutes) > 0,
  );
  const laborLinesExisting = allLines.filter((l) => l.line_type === "labor");
  const keptLaborIds = new Set(
    validLaborEdits
      .map((e) => e.row_key?.trim())
      .filter((id): id is string => !!id),
  );

  for (const line of laborLinesExisting) {
    if (!keptLaborIds.has(line.id)) {
      const { error: delErr } = await supabase
        .from("recipe_lines")
        .delete()
        .eq("id", line.id);
      if (delErr) throw new Error(delErr.message);
    }
  }

  for (const edit of validLaborEdits) {
    const role = edit.labor_role.trim();
    const minutes = Number(edit.minutes);
    const existingId = edit.row_key?.trim();
    const existingLabor = existingId
      ? laborLinesExisting.find((l) => l.id === existingId)
      : undefined;

    if (existingLabor) {
      const { error: updErr } = await supabase
        .from("recipe_lines")
        .update({ labor_role: role, minutes })
        .eq("id", existingLabor.id);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { error: insErr } = await supabase.from("recipe_lines").insert({
        parent_item_id: sourceItemId,
        line_type: "labor",
        labor_role: role,
        minutes,
        tenant_id: lineTenantId,
        user_id: lineUserId,
      });
      if (insErr) throw new Error(insErr.message);
    }
  }
}

export async function saveStandardSheetEdits(params: {
  tenantId: string;
  tenantIds: string[];
  sourceItemId: string;
  createdBy: string;
  description: string | null;
  procedure: string | null;
  payload: StandardSheetEditPayload;
}): Promise<StandardTechnicalSheetRow> {
  const actor: SheetEditActor = {
    tenantId: params.tenantId,
    userId: params.createdBy,
  };
  await validateSheetEditsNoCycle(params.sourceItemId, actor, params.payload);
  await applySheetEditsToRecipe(params.sourceItemId, params.payload, actor);
  const snapshot = await buildStandardSnapshot({
    sourceItemId: params.sourceItemId,
    tenantIds: params.tenantIds,
    expandItemIds: new Set(),
  });
  return insertStandardVersion({
    tenantId: params.tenantId,
    sourceItemId: params.sourceItemId,
    snapshot,
    createdBy: params.createdBy,
    description: params.description,
    procedure: params.procedure,
  });
}
