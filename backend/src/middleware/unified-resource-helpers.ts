import { Request } from "express";
import { supabase } from "../config/supabase";
import { withTenantFilter } from "./tenant-filter";
import type { UnifiedResource } from "../authz/unified/authorize";

function getCurrentTenantId(req: Request): string | null {
  const tid = req.user?.selected_tenant_id || req.user?.tenant_ids[0];
  return tid ?? null;
}

async function getCompanyIdForTenant(tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("company_tenants")
    .select("company_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data?.company_id) return null;
  return data.company_id;
}

/**
 * Tenant container resource（create/list のアンカー）
 */
export async function getUnifiedTenantResource(
  req: Request
): Promise<UnifiedResource | null> {
  const tenantId = getCurrentTenantId(req);
  if (!tenantId) return null;

  const companyId = await getCompanyIdForTenant(tenantId);
  if (!companyId) return null;

  return {
    type: "Tenant",
    id: tenantId,
    company_id: companyId,
  };
}

/**
 * items の CostResource
 */
export async function getUnifiedItemResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase
    .from("items")
    .select("id, tenant_id, item_kind, user_id, responsible_user_id")
    .eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  return {
    type: "CostResource",
    id: data.id,
    resourceType: "item",
    tenant_id: data.tenant_id,
    owner_tenant_id: data.tenant_id,
    item_kind: data.item_kind,
    user_id: data.user_id,
    responsible_user_id: data.responsible_user_id,
  };
}

/**
 * base_items の CostResource
 */
export async function getUnifiedBaseItemResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase.from("base_items").select("id, tenant_id").eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  return {
    type: "CostResource",
    id: data.id,
    resourceType: "base_item",
    tenant_id: data.tenant_id,
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * virtual_vendor_products の CostResource
 */
export async function getUnifiedVendorProductResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase
    .from("virtual_vendor_products")
    .select("id, tenant_id")
    .eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  return {
    type: "CostResource",
    id: data.id,
    resourceType: "vendor_product",
    tenant_id: data.tenant_id,
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * recipe_lines の CostResource（owner_tenant_id は tenant_id）
 */
export async function getUnifiedRecipeLineResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  let query = supabase
    .from("recipe_lines")
    .select("id, tenant_id")
    .eq("id", id);
  query = withTenantFilter(query, req);

  const { data, error } = await query.single();
  if (error || !data) return null;

  return {
    type: "CostResource",
    id: data.id,
    resourceType: "recipe_line",
    tenant_id: data.tenant_id,
    owner_tenant_id: data.tenant_id,
  };
}

/**
 * resource_shares 行そのものを CostResource として扱う（owner_tenant_id=owner_tenant_id）
 */
export async function getUnifiedResourceShareResource(
  req: Request
): Promise<UnifiedResource | null> {
  const { id } = req.params;
  if (!id) return null;

  const { data, error } = await supabase
    .from("resource_shares")
    .select("id, owner_tenant_id")
    .eq("id", id)
    .in("owner_tenant_id", req.user!.tenant_ids)
    .single();

  if (error || !data) return null;

  return {
    type: "CostResource",
    id: data.id,
    resourceType: "resource_share",
    tenant_id: data.owner_tenant_id,
    owner_tenant_id: data.owner_tenant_id,
  };
}

