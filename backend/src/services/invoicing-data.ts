import { supabase } from "../config/supabase";
import { eachGramsForInvoicing, type InvoicingEachGramsContext } from "../lib/invoicing-calc";
import {
  fetchLatestWholesalePrices,
  fetchOwnTenantItemCandidates,
  type ItemCandidateRow,
} from "./recipe-cost-report-data";

export type InvoicingCostBreakdownRow = {
  food_cost_per_gram: number;
  labor_cost_per_gram: number;
  total_cost_per_gram: number;
};

export type InvoicingItemCandidateRow = ItemCandidateRow & {
  delivery: boolean;
};

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
  "id, tenant_id, name, delivery_site_id, wholesale_list_id, lines, created_at, updated_at, created_by";

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
): Promise<InvoicingItemCandidateRow[]> {
  const rows = await fetchOwnTenantItemCandidates(tenantId);
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("items")
    .select("id, delivery")
    .eq("tenant_id", tenantId)
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (error) throw new Error(error.message);

  const deliveryById = new Map(
    (data ?? []).map((row) => [row.id, Boolean(row.delivery)]),
  );
  return rows.map((row) => ({
    ...row,
    delivery: deliveryById.get(row.id) ?? false,
  }));
}

export async function assertWholesaleListInTenant(
  tenantId: string,
  wholesaleListId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("wholesale_lists")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", wholesaleListId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function validateInvoicingItemsForWholesaleList(
  wholesaleListId: string,
  itemIds: string[],
): Promise<string | null> {
  if (itemIds.length === 0) return "At least one item is required";

  const { data: members, error: memErr } = await supabase
    .from("wholesale_list_members")
    .select("item_id")
    .eq("wholesale_list_id", wholesaleListId)
    .in("item_id", itemIds);
  if (memErr) throw new Error(memErr.message);

  const memberIds = new Set((members ?? []).map((m) => m.item_id));
  const prices = await fetchLatestWholesalePrices(wholesaleListId, itemIds);

  for (const itemId of itemIds) {
    if (!memberIds.has(itemId)) {
      return "One or more items are not on the selected wholesale price list";
    }
    const price = prices.get(itemId);
    if (price == null || !Number.isFinite(price) || price <= 0) {
      return "One or more items do not have a wholesale price on the selected list";
    }
  }
  return null;
}

function wholesalePricePerKgToBreakdown(
  pricePerKg: number,
): InvoicingCostBreakdownRow {
  const perGram = pricePerKg / 1000;
  return {
    food_cost_per_gram: perGram,
    labor_cost_per_gram: 0,
    total_cost_per_gram: perGram,
  };
}

export async function computeInvoiceWholesaleCosts(
  wholesaleListId: string,
  itemIds: string[],
): Promise<Record<string, InvoicingCostBreakdownRow>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) return {};

  const prices = await fetchLatestWholesalePrices(wholesaleListId, uniqueIds);
  const costs: Record<string, InvoicingCostBreakdownRow> = {};
  for (const itemId of uniqueIds) {
    const pricePerKg = prices.get(itemId);
    if (pricePerKg != null && Number.isFinite(pricePerKg) && pricePerKg > 0) {
      costs[itemId] = wholesalePricePerKgToBreakdown(pricePerKg);
    }
  }
  return costs;
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

export async function assertDeliverySiteInCompany(
  companyId: string,
  deliverySiteId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("delivery_sites")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", deliverySiteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function assertInvoicingAccountInCompany(
  companyId: string,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invoicing_accounts")
    .select("id")
    .eq("company_id", companyId)
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

export type OrderLineJson = {
  item_id: string;
  name: string;
  unit_size: number;
  unit_size_unit: string;
  units: number;
  cost: number;
  sub_total: number;
  sort_order: number;
};

export function normalizeOrderLines(
  raw: unknown,
): OrderLineJson[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "lines must be an array" };
  }
  const lines: OrderLineJson[] = [];
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
  orderLines: OrderLineJson[],
): InvoiceListLineJson[] {
  const byItem = new Map(orderLines.map((l) => [l.item_id, l]));
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
export function validateOrderLinesCoverAllListLines(
  listLines: InvoiceListLineJson[],
  orderLines: OrderLineJson[],
): string | null {
  if (orderLines.length !== listLines.length) {
    return "Order must include every item on the list";
  }
  const listIds = new Set(listLines.map((l) => l.item_id));
  const orderIds = new Set(orderLines.map((l) => l.item_id));
  if (listIds.size !== orderIds.size || listIds.size !== listLines.length) {
    return "Order lines must match list items exactly";
  }
  for (const id of listIds) {
    if (!orderIds.has(id)) {
      return "Order is missing one or more list items";
    }
  }
  return null;
}

const COST_PER_KG_TOLERANCE = 0.02;

/** Verify client cost snapshots match current wholesale prices ($/kg). */
export function validateOrderLineCostsAgainstRpc(
  lines: OrderLineJson[],
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

const ORDER_COLUMNS =
  "id, tenant_id, invoice_number, list_id, list_name, delivery_site_id, delivery_site_name, delivery_email, company_name, order_received_date, delivery_date, order_created_date, total_amount, first_invoice_sent_at, note, lines, created_at, created_by";

export const PAYMENT_COLUMNS =
  "id, company_id, account_id, amount, type, note, payment_date, created_at, created_by";

export async function resolveCompanyIdForTenant(
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.company_id ?? null;
}

export async function assertAccountInCompany(
  companyId: string,
  accountId: string,
): Promise<boolean> {
  return assertInvoicingAccountInCompany(companyId, accountId);
}

export type CompanyInvoicingAccountRow = {
  id: string;
  company_id: string;
  company_name: string;
};

export async function fetchCompanyInvoicingAccounts(
  companyId: string,
): Promise<CompanyInvoicingAccountRow[]> {
  const { data, error } = await supabase
    .from("invoicing_accounts")
    .select("id, company_id, company_name")
    .eq("company_id", companyId)
    .order("company_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export { ORDER_COLUMNS };
