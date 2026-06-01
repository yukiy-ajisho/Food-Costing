"use client";

import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "@/contexts/ThemeContext";

export function InvoicingAccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { loading: companyLoading, companies, selectedCompanyId } =
    useCompany();
  const { loading: tenantLoading, tenants, selectedTenantId } = useTenant();

  const canAccessInvoicing = (() => {
    if (!selectedCompanyId) return false;
    const companyRole = companies.find((c) => c.id === selectedCompanyId)?.role;
    if (companyRole === "company_admin" || companyRole === "company_director") {
      return true;
    }
    if (!selectedTenantId) return false;
    const tenantRole = tenants.find((t) => t.id === selectedTenantId)?.role;
    return tenantRole === "admin" || tenantRole === "director";
  })();

  const textMuted = isDark ? "text-slate-400" : "text-gray-500";

  if (tenantLoading || companyLoading) {
    return (
      <div
        className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}
      >
        Loading…
      </div>
    );
  }

  if (!canAccessInvoicing) {
    return (
      <div
        className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}
      >
        You do not have permission to access Invoicing.
      </div>
    );
  }

  return children;
}
