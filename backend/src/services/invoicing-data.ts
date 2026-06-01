import { supabase } from "../config/supabase";
import { eachGramsForInvoicing, type InvoicingEachGramsContext } from "../lib/invoicing-calc";
import {
  fetchOwnTenantItemCandidates,
  type ItemCandidateRow,
} from "./recipe-cost-report-data";

export type InvoiceListLineJson = {
  item_id: string;
  unit_size: number | null;
  unit_size_unit: string | null;
  sort_order: number;
};

export type InvoiceListItemRow = InvoiceListLineJson & {
  name: string;
  is_menu_item: boolean;
  each_grams: number | null;
  proceed_yield_amount: number;
  proceed_yield_unit: string | null;
};

const LIST_COLUMNS =
  "id, tenant_id, name, delivery_site_id, lines, created_at, updated_at, created_by";

export function normalizeInvoiceListLines(
  raw: unknown,
): InvoiceListLineJson[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "lines must be an array" };
  }
  const lines: InvoiceListLineJson[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown>;
    const itemId = typeof row.item_id === "string" ? row.item_id.trim() : "";
    if (!itemId) {
      return { error: `lines[${i}].item_id is required` };
    }
    let unitSize: number | null = null;
    if (row.unit_size != null && row.unit_size !== "") {
      const n = Number(row.unit_size);
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `lines[${i}].unit_size must be a positive number` };
      }
      unitSize = n;
    }
    const unitSizeUnit =
      row.unit_size_unit == null || row.unit_size_unit === ""
        ? null
        : String(row.unit_size_unit).trim();
    const sortOrder =
      typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
        ? row.sort_order
        : i;
    lines.push({
      item_id: itemId,
      unit_size: unitSize,
      unit_size_unit: unitSizeUnit,
      sort_order: sortOrder,
    });
  }
  lines.sort((a, b) => a.sort_order - b.sort_order);
  return lines;
}

export function buildInitialLines(itemIds: string[]): InvoiceListLineJson[] {
  return itemIds.map((item_id, sort_order) => ({
    item_id,
    unit_size: null,
    unit_size_unit: null,
    sort_order,
  }));
}

export async function validateInvoicingItemIds(
  tenantId: string,
  itemIds: string[],
): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase
    .from("items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("item_kind", "prepped")
    .is("deprecated", null)
    .in("id", itemIds);
  if (error) throw new Error(error.message);
  const allowed = new Set((data ?? []).map((r) => r.id));
  return itemIds.filter((id) => allowed.has(id));
}

export async function fetchInvoicingItemCandidates(
  tenantId: string,
): Promise<ItemCandidateRow[]> {
  return fetchOwnTenantItemCandidates(tenantId);
}

export async function enrichInvoiceListLines(
  tenantId: string,
  lines: InvoiceListLineJson[],
): Promise<InvoiceListItemRow[]> {
  if (lines.length === 0) return [];
  const itemIds = [...new Set(lines.map((l) => l.item_id))];
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, name, is_menu_item, each_grams, proceed_yield_amount, proceed_yield_unit, item_kind, tenant_id",
    )
    .eq("tenant_id", tenantId)
    .in("id", itemIds);
  if (error) throw new Error(error.message);

  const byId = new Map(
    (data ?? []).map((item) => [
      item.id,
      {
        name: item.name ?? "(Unnamed)",
        is_menu_item: Boolean(item.is_menu_item),
        each_grams:
          item.each_grams != null ? Number(item.each_grams) : null,
        proceed_yield_amount: Number(item.proceed_yield_amount) || 0,
        proceed_yield_unit: item.proceed_yield_unit,
      },
    ]),
  );

  return lines
    .filter((line) => byId.has(line.item_id))
    .map((line) => {
      const item = byId.get(line.item_id)!;
      return {
        ...line,
        name: item.name,
        is_menu_item: item.is_menu_item,
        each_grams: item.each_grams,
        proceed_yield_amount: item.proceed_yield_amount,
        proceed_yield_unit: item.proceed_yield_unit,
      };
    });
}

export async function assertDeliverySiteInTenant(
  tenantId: string,
  deliverySiteId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("delivery_sites")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", deliverySiteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function assertInvoicingAccountInTenant(
  tenantId: string,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invoicing_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function fetchEffectiveEachGramsByItemIds(
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (itemIds.length === 0) return map;
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, is_menu_item, each_grams, proceed_yield_amount, proceed_yield_unit",
    )
    .eq("tenant_id", tenantId)
    .in("id", itemIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const ctx: InvoicingEachGramsContext = {
      is_menu_item: Boolean(row.is_menu_item),
      each_grams: row.each_grams != null ? Number(row.each_grams) : null,
      proceed_yield_amount: Number(row.proceed_yield_amount) || 0,
      proceed_yield_unit: row.proceed_yield_unit,
    };
    map.set(row.id, eachGramsForInvoicing(ctx));
  }
  return map;
}

export { LIST_COLUMNS };

export type InvoiceBoxLineJson = {
  item_id: string;
  name: string;
  unit_size: number;
  unit_size_unit: string;
  units: number;
  cost: number;
  sub_total: number;
  sort_order: number;
};

export function normalizeInvoiceBoxLines(
  raw: unknown,
): InvoiceBoxLineJson[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "lines must be an array" };
  }
  const lines: InvoiceBoxLineJson[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as Record<string, unknown>;
    const itemId = typeof row.item_id === "string" ? row.item_id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!itemId) return { error: `lines[${i}].item_id is required` };
    if (!name) return { error: `lines[${i}].name is required` };

    const unitSize = Number(row.unit_size);
    const units = Number(row.units);
    const cost = Number(row.cost);
    const subTotal = Number(row.sub_total);
    const unitSizeUnit =
      typeof row.unit_size_unit === "string" ? row.unit_size_unit.trim() : "";

    if (!Number.isFinite(unitSize) || unitSize <= 0) {
      return { error: `lines[${i}].unit_size must be positive` };
    }
    if (!unitSizeUnit) {
      return { error: `lines[${i}].unit_size_unit is required` };
    }
    if (!Number.isFinite(units) || units <= 0) {
      return { error: `lines[${i}].units must be positive` };
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return { error: `lines[${i}].cost must be >= 0` };
    }
    if (!Number.isFinite(subTotal) || subTotal < 0) {
      return { error: `lines[${i}].sub_total must be >= 0` };
    }

    const sortOrder =
      typeof row.sort_order === "number" && Number.isFinite(row.sort_order)
        ? row.sort_order
        : i;

    lines.push({
      item_id: itemId,
      name,
      unit_size: unitSize,
      unit_size_unit: unitSizeUnit,
      units,
      cost,
      sub_total: subTotal,
      sort_order: sortOrder,
    });
  }
  lines.sort((a, b) => a.sort_order - b.sort_order);
  return lines;
}

export function mergeUnitSizesIntoListLines(
  listLines: InvoiceListLineJson[],
  boxLines: InvoiceBoxLineJson[],
): InvoiceListLineJson[] {
  const byItem = new Map(boxLines.map((l) => [l.item_id, l]));
  return listLines.map((line) => {
    const saved = byItem.get(line.item_id);
    if (!saved) return line;
    return {
      ...line,
      unit_size: saved.unit_size,
      unit_size_unit: saved.unit_size_unit,
    };
  });
}

/** Every list row must appear exactly once on the invoice (no partial generate). */
export function validateBoxLinesCoverAllListLines(
  listLines: InvoiceListLineJson[],
  boxLines: InvoiceBoxLineJson[],
): string | null {
  if (boxLines.length !== listLines.length) {
    return "Invoice must include every item on the list";
  }
  const listIds = new Set(listLines.map((l) => l.item_id));
  const boxIds = new Set(boxLines.map((l) => l.item_id));
  if (listIds.size !== boxIds.size || listIds.size !== listLines.length) {
    return "Invoice lines must match list items exactly";
  }
  for (const id of listIds) {
    if (!boxIds.has(id)) {
      return "Invoice is missing one or more list items";
    }
  }
  return null;
}

const COST_PER_KG_TOLERANCE = 0.02;

/** Verify client cost snapshots match current scoped RPC ($/kg). */
export function validateBoxLineCostsAgainstRpc(
  lines: InvoiceBoxLineJson[],
  costs: Record<string, { total_cost_per_gram: number }>,
): string | null {
  for (const line of lines) {
    const breakdown = costs[line.item_id];
    if (!breakdown?.total_cost_per_gram) {
      return `Cost unavailable for "${line.name}"`;
    }
    const expectedCost = breakdown.total_cost_per_gram * 1000;
    if (Math.abs(expectedCost - line.cost) > COST_PER_KG_TOLERANCE) {
      return `cost mismatch for "${line.name}"`;
    }
  }
  return null;
}

const INVOICE_COLUMNS =
  "id, tenant_id, invoice_number, list_id, delivery_site_id, delivery_site_name, delivery_email, company_name, order_received_date, delivery_date, invoice_date, total_amount, sent_at, note, lines, created_at, created_by";

export { INVOICE_COLUMNS };
