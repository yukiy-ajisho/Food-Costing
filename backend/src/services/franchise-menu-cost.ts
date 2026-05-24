import { supabase } from "../config/supabase";

export type CostBreakdownRow = {
  food_cost_per_gram: number;
  labor_cost_per_gram: number;
  total_cost_per_gram: number;
};

export async function computeFranchiseMenuCosts(
  tenantId: string,
  seedItemIds: string[],
  wholesaleListId: string,
): Promise<Record<string, CostBreakdownRow>> {
  if (seedItemIds.length === 0) return {};

  const { data, error } = await supabase.rpc(
    "calculate_item_costs_with_breakdown_wholesale_overrides",
    {
      p_tenant_id: tenantId,
      p_call_depth: 0,
      p_seed_item_ids: seedItemIds,
      p_wholesale_list_id: wholesaleListId,
    },
  );
  if (error) throw new Error(error.message);

  const result: Record<string, CostBreakdownRow> = {};
  for (const row of data ?? []) {
    result[row.out_item_id] = {
      food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
      labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
      total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
    };
  }
  return result;
}

export async function computeScopedBreakdownCosts(
  tenantId: string,
  seedItemIds: string[],
): Promise<Record<string, CostBreakdownRow>> {
  if (seedItemIds.length === 0) return {};

  const { data, error } = await supabase.rpc(
    "calculate_item_costs_with_breakdown_scoped",
    {
      p_tenant_id: tenantId,
      p_call_depth: 0,
      p_seed_item_ids: seedItemIds,
    },
  );
  if (error) throw new Error(error.message);

  const result: Record<string, CostBreakdownRow> = {};
  for (const row of data ?? []) {
    result[row.out_item_id] = {
      food_cost_per_gram: parseFloat(row.out_food_cost_per_gram) || 0,
      labor_cost_per_gram: parseFloat(row.out_labor_cost_per_gram) || 0,
      total_cost_per_gram: parseFloat(row.out_total_cost_per_gram) || 0,
    };
  }
  return result;
}
