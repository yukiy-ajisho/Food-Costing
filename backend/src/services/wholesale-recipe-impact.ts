import { supabase } from "../config/supabase";

async function latestWholesalePricesByItem(
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

/** WL members with a positive latest wholesale price ($/kg). */
export async function fetchWholesalePricedItemIds(
  wholesaleListId: string,
): Promise<Set<string>> {
  const { data: members, error } = await supabase
    .from("wholesale_list_members")
    .select("item_id")
    .eq("wholesale_list_id", wholesaleListId);
  if (error) throw new Error(error.message);

  const itemIds = (members ?? []).map((m) => m.item_id);
  if (itemIds.length === 0) return new Set();

  const prices = await latestWholesalePricesByItem(wholesaleListId, itemIds);
  const priced = new Set<string>();
  for (const id of itemIds) {
    const p = prices.get(id);
    if (p != null && p > 0 && Number.isFinite(p)) priced.add(id);
  }
  return priced;
}

/**
 * Seed items whose recipe tree (or self) touches any WL-priced member.
 * Matches wholesale override RPC: WL-priced leaves/children affect rolled-up cost.
 */
export async function computeWholesaleRecipeImpactByItem(
  tenantId: string,
  wholesaleListId: string,
  seedItemIds: string[],
): Promise<Set<string>> {
  const seeds = [...new Set(seedItemIds.filter(Boolean))];
  if (seeds.length === 0) return new Set();

  const wlPriced = await fetchWholesalePricedItemIds(wholesaleListId);
  if (wlPriced.size === 0) return new Set();

  const impacted = new Set<string>();
  for (const s of seeds) {
    if (wlPriced.has(s)) impacted.add(s);
  }

  const seedsByItem = new Map<string, Set<string>>();
  for (const s of seeds) {
    seedsByItem.set(s, new Set([s]));
  }

  let frontier = seeds.filter((s) => !wlPriced.has(s));
  const visited = new Set<string>(seeds);

  while (frontier.length > 0) {
    const { data: lines, error } = await supabase
      .from("recipe_lines")
      .select("parent_item_id, child_item_id")
      .eq("tenant_id", tenantId)
      .eq("line_type", "ingredient")
      .in("parent_item_id", frontier)
      .not("child_item_id", "is", null);
    if (error) throw new Error(error.message);

    const nextFrontier: string[] = [];
    for (const line of lines ?? []) {
      const parentId = line.parent_item_id as string;
      const childId = line.child_item_id as string;
      const parentSeeds = seedsByItem.get(parentId);
      if (!parentSeeds) continue;

      if (wlPriced.has(childId)) {
        for (const s of parentSeeds) impacted.add(s);
      }

      let childSeeds = seedsByItem.get(childId);
      if (!childSeeds) {
        childSeeds = new Set(parentSeeds);
        seedsByItem.set(childId, childSeeds);
      } else {
        for (const s of parentSeeds) childSeeds.add(s);
      }

      if (!visited.has(childId)) {
        visited.add(childId);
        if (!wlPriced.has(childId)) nextFrontier.push(childId);
      }
    }
    frontier = nextFrontier;
  }

  return impacted;
}
