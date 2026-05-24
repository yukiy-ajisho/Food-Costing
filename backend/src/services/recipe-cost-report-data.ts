import { supabase } from "../config/supabase";

export type ItemCandidateRow = {
  id: string;
  name: string;
  is_menu_item: boolean;
  proceed_yield_unit: string | null;
  each_grams: number | null;
  is_cross_tenant?: boolean;
};

export type MemberListKind = "wholesale" | "menu";

async function resolveCompanyIdForTenant(
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

/** Cost の /cross-tenant-item-shares/available と同じ read 共有 prepped（menu 含む）。 */
export async function fetchCrossTenantReadableItemIds(
  viewerTenantId: string,
): Promise<Set<string>> {
  const companyId = await resolveCompanyIdForTenant(viewerTenantId);
  if (!companyId) return new Set();

  const { data: shares, error } = await supabase
    .from("cross_tenant_item_shares")
    .select("items(id)")
    .eq("company_id", companyId)
    .neq("owner_tenant_id", viewerTenantId)
    .or(
      `and(target_type.eq.company,target_id.eq.${companyId}),and(target_type.eq.tenant,target_id.eq.${viewerTenantId})`,
    )
    .contains("allowed_actions", ["read"]);

  if (error) throw new Error(error.message);

  const ids = new Set<string>();
  for (const row of shares ?? []) {
    const raw = row.items as { id?: string } | { id?: string }[] | null;
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (item?.id) ids.add(item.id);
  }
  return ids;
}

async function mapItemsToCandidateRows(
  items: Array<{
    id: string;
    name: string | null;
    is_menu_item: boolean | null;
    proceed_yield_unit: string | null;
    each_grams: number | null;
    base_item_id: string | null;
    item_kind: string;
  }>,
  options?: { is_cross_tenant?: boolean },
): Promise<ItemCandidateRow[]> {
  const baseIds = [
    ...new Set(
      items
        .map((i) => i.base_item_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const baseNameMap = new Map<string, string>();
  if (baseIds.length > 0) {
    const { data: bases } = await supabase
      .from("base_items")
      .select("id, name")
      .in("id", baseIds);
    for (const b of bases ?? []) {
      if (b.name) baseNameMap.set(b.id, b.name);
    }
  }

  return items.map((item) => ({
    id: item.id,
    name:
      item.item_kind === "raw" && item.base_item_id
        ? baseNameMap.get(item.base_item_id) ?? item.name ?? "(Unnamed)"
        : item.name ?? "(Unnamed)",
    is_menu_item: Boolean(item.is_menu_item),
    proceed_yield_unit: item.proceed_yield_unit,
    each_grams: item.each_grams != null ? Number(item.each_grams) : null,
    ...(options?.is_cross_tenant ? { is_cross_tenant: true } : {}),
  }));
}

export async function fetchOwnTenantItemCandidates(
  tenantId: string,
): Promise<ItemCandidateRow[]> {
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, name, item_kind, is_menu_item, proceed_yield_unit, each_grams, base_item_id",
    )
    .eq("tenant_id", tenantId)
    .eq("item_kind", "prepped")
    .is("deprecated", null)
    .order("name");
  if (error) throw new Error(error.message);
  return mapItemsToCandidateRows(data ?? []);
}

export async function fetchCrossTenantItemCandidates(
  viewerTenantId: string,
): Promise<ItemCandidateRow[]> {
  const companyId = await resolveCompanyIdForTenant(viewerTenantId);
  if (!companyId) return [];

  const { data: shares, error } = await supabase
    .from("cross_tenant_item_shares")
    .select(
      "owner_tenant_id, items(id, name, tenant_id, item_kind, is_menu_item, proceed_yield_unit, each_grams, base_item_id, deprecated)",
    )
    .eq("company_id", companyId)
    .neq("owner_tenant_id", viewerTenantId)
    .or(
      `and(target_type.eq.company,target_id.eq.${companyId}),and(target_type.eq.tenant,target_id.eq.${viewerTenantId})`,
    )
    .contains("allowed_actions", ["read"]);
  if (error) throw new Error(error.message);

  const byId = new Map<
    string,
    {
      id: string;
      name: string | null;
      tenant_id: string;
      item_kind: string;
      is_menu_item: boolean | null;
      proceed_yield_unit: string | null;
      each_grams: number | null;
      base_item_id: string | null;
    }
  >();
  for (const share of shares ?? []) {
    const raw = share.items as
      | {
          id: string;
          name: string | null;
          tenant_id: string;
          item_kind: string;
          is_menu_item: boolean | null;
          proceed_yield_unit: string | null;
          each_grams: number | null;
          base_item_id: string | null;
          deprecated: string | null;
        }
      | {
          id: string;
          name: string | null;
          tenant_id: string;
          item_kind: string;
          is_menu_item: boolean | null;
          proceed_yield_unit: string | null;
          each_grams: number | null;
          base_item_id: string | null;
          deprecated: string | null;
        }[]
      | null;
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item || item.tenant_id === viewerTenantId) continue;
    if (item.item_kind !== "prepped" || item.deprecated) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  const rows = await mapItemsToCandidateRows([...byId.values()], {
    is_cross_tenant: true,
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** WL / フランチャイズ MCL: 自テナントのみ。直営 MCL: cross-tenant prepped+menu をマージ。 */
export async function fetchRecipeCostReportItemCandidates(
  tenantId: string,
  includeCrossTenant: boolean,
): Promise<ItemCandidateRow[]> {
  const own = await fetchOwnTenantItemCandidates(tenantId);
  if (!includeCrossTenant) return own;

  const cross = await fetchCrossTenantItemCandidates(tenantId);
  const seen = new Set(own.map((o) => o.id));
  const merged = [...own];
  for (const c of cross) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

export async function getMenuCostListMode(
  listId: string,
  viewerTenantId: string,
): Promise<"company_owned" | "franchise" | null> {
  const { data, error } = await supabase
    .from("menu_cost_lists")
    .select("mode")
    .eq("id", listId)
    .eq("tenant_id", viewerTenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.mode) return null;
  return data.mode === "franchise" ? "franchise" : "company_owned";
}

export type ListMemberRow = {
  item_id: string;
  name: string;
  item_kind: string;
  is_menu_item: boolean;
  proceed_yield_amount: number;
  proceed_yield_unit: string;
  each_grams: number | null;
  latest_wholesale_price: number | null;
  latest_retail_price: number | null;
  /** Set when item is indirectly deprecated (affected by ingredient); direct members are removed. */
  deprecation_reason?: "indirect" | null;
};

export async function fetchLatestWholesalePrices(
  wholesaleListId: string,
  itemIds: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (itemIds.length === 0) return map;

  const { data, error } = await supabase
    .from("wholesale_list_lines")
    .select("item_id, wholesale_price, created_at")
    .eq("wholesale_list_id", wholesaleListId)
    .in("item_id", itemIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    if (!map.has(row.item_id)) {
      map.set(
        row.item_id,
        row.wholesale_price != null ? Number(row.wholesale_price) : null,
      );
    }
  }
  return map;
}

export async function fetchLatestRetailPrices(
  menuCostListId: string,
  itemIds: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (itemIds.length === 0) return map;

  const { data, error } = await supabase
    .from("menu_cost_list_lines")
    .select("item_id, retail_price, created_at")
    .eq("menu_cost_list_id", menuCostListId)
    .in("item_id", itemIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    if (!map.has(row.item_id)) {
      map.set(
        row.item_id,
        row.retail_price != null ? Number(row.retail_price) : null,
      );
    }
  }
  return map;
}

export async function enrichMemberRows(
  tenantId: string,
  itemIds: string[],
  latestPrices: Map<string, number | null>,
  priceKey: "wholesale" | "retail",
): Promise<ListMemberRow[]> {
  if (itemIds.length === 0) return [];

  const { data: items, error } = await supabase
    .from("items")
    .select(
      "id, name, item_kind, is_menu_item, proceed_yield_amount, proceed_yield_unit, each_grams, base_item_id, deprecated, deprecation_reason",
    )
    .in("id", itemIds)
    .eq("item_kind", "prepped");
  if (error) throw new Error(error.message);

  const mapped = await mapItemsToCandidateRows(
    (items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      is_menu_item: item.is_menu_item,
      proceed_yield_unit: item.proceed_yield_unit,
      each_grams: item.each_grams,
      base_item_id: item.base_item_id,
      item_kind: item.item_kind,
    })),
  );
  const nameById = new Map(mapped.map((m) => [m.id, m.name]));

  const order = new Map(itemIds.map((id, i) => [id, i]));
  const rows: ListMemberRow[] = (items ?? [])
    .filter(
      (item) =>
        !item.deprecated || item.deprecation_reason === "indirect",
    )
    .map((item) => {
      const displayName = nameById.get(item.id) ?? item.name;
      const latest = latestPrices.get(item.id) ?? null;
      return {
        item_id: item.id,
        name: displayName ?? "(Unnamed)",
        item_kind: item.item_kind,
        is_menu_item: Boolean(item.is_menu_item),
        proceed_yield_amount: Number(item.proceed_yield_amount) || 0,
        proceed_yield_unit: item.proceed_yield_unit || "g",
        each_grams: item.each_grams != null ? Number(item.each_grams) : null,
        latest_wholesale_price: priceKey === "wholesale" ? latest : null,
        latest_retail_price: priceKey === "retail" ? latest : null,
        deprecation_reason:
          item.deprecation_reason === "indirect" ? "indirect" : null,
      };
    });

  rows.sort(
    (a, b) => (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0),
  );
  return rows;
}

export async function validatePreppedMenuItemIds(
  tenantId: string,
  itemIds: string[],
  options?: { allowCrossTenant?: boolean },
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
  if (options?.allowCrossTenant) {
    const crossIds = await fetchCrossTenantReadableItemIds(tenantId);
    for (const id of itemIds) {
      if (crossIds.has(id)) allowed.add(id);
    }
  }
  return itemIds.filter((id) => allowed.has(id));
}

/** Removes direct-deprecated items from list membership; returns remaining member item ids. */
export async function purgeDirectDeprecatedMembers(
  listKind: MemberListKind,
  listId: string,
  itemIds: string[],
  tenantId: string,
): Promise<string[]> {
  if (itemIds.length === 0) return [];

  void tenantId;
  const { data: items, error } = await supabase
    .from("items")
    .select("id, deprecated, deprecation_reason")
    .in("id", itemIds);
  if (error) throw new Error(error.message);

  const directIds = (items ?? [])
    .filter((i) => i.deprecated && i.deprecation_reason === "direct")
    .map((i) => i.id);

  if (directIds.length > 0) {
    const memberTable =
      listKind === "wholesale"
        ? "wholesale_list_members"
        : "menu_cost_list_members";
    const listColumn =
      listKind === "wholesale" ? "wholesale_list_id" : "menu_cost_list_id";
    const { error: delErr } = await supabase
      .from(memberTable)
      .delete()
      .eq(listColumn, listId)
      .in("item_id", directIds);
    if (delErr) throw new Error(delErr.message);
  }

  const directSet = new Set(directIds);
  return itemIds.filter((id) => !directSet.has(id));
}

export async function loadListMemberRows(
  tenantId: string,
  listKind: MemberListKind,
  listId: string,
  itemIds: string[],
): Promise<ListMemberRow[]> {
  const activeIds = await purgeDirectDeprecatedMembers(
    listKind,
    listId,
    itemIds,
    tenantId,
  );
  const latest =
    listKind === "wholesale"
      ? await fetchLatestWholesalePrices(listId, activeIds)
      : await fetchLatestRetailPrices(listId, activeIds);
  return enrichMemberRows(
    tenantId,
    activeIds,
    latest,
    listKind === "wholesale" ? "wholesale" : "retail",
  );
}
