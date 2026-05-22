import type { Company } from "@/contexts/CompanyContext";
import type { Tenant } from "@/contexts/TenantContext";

const COMPANY_OFFICER_ROLES = new Set(["company_admin", "company_director"]);
const TENANT_OFFICER_ROLES = new Set(["admin", "director"]);

/**
 * Recipe Cost Report: company_admin/director またはテナント admin/director。
 * 会社オフィサーは profiles 無し（tenant.role === "company"）でも可。
 */
export function canAccessRecipeCostReport(
  selectedCompanyId: string | null,
  selectedTenantId: string | null,
  companies: Company[],
  tenants: Tenant[],
): boolean {
  if (!selectedTenantId) return false;

  if (selectedCompanyId) {
    const companyRole = companies.find((c) => c.id === selectedCompanyId)?.role;
    if (companyRole && COMPANY_OFFICER_ROLES.has(companyRole)) {
      return true;
    }
  }

  const tenantRole = tenants.find((t) => t.id === selectedTenantId)?.role;
  if (!tenantRole) return false;
  if (tenantRole === "company") {
    return companies.some(
      (c) => c.role != null && COMPANY_OFFICER_ROLES.has(c.role),
    );
  }
  return TENANT_OFFICER_ROLES.has(tenantRole);
}
