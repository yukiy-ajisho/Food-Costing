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

  const selectedCompany = selectedCompanyId
    ? companies.find((c) => c.id === selectedCompanyId)
    : undefined;

  const hasInvoicingPermission = (() => {
    if (!selectedCompanyId) return false;
    const companyRole = selectedCompany?.role;
    if (companyRole === "company_admin" || companyRole === "company_director") {
      return true;
    }
    if (!selectedTenantId) return false;
    const tenantRole = tenants.find((t) => t.id === selectedTenantId)?.role;
    return tenantRole === "admin" || tenantRole === "director";
  })();

  const hasCompanyTimezone = Boolean(selectedCompany?.timezone?.trim());

  const textMuted = isDark ? "text-slate-400" : "text-gray-500";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";

  if (tenantLoading || companyLoading) {
    return (
      <div
        className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}
      >
        Loading…
      </div>
    );
  }

  if (!hasInvoicingPermission) {
    return (
      <div
        className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}
      >
        You do not have permission to access Invoicing.
      </div>
    );
  }

  if (!hasCompanyTimezone) {
    return (
      <div
        className={`flex h-full items-center justify-center p-12 text-center ${textMuted}`}
      >
        <div className="max-w-md space-y-2">
          <p className={`text-base font-medium ${textMain}`}>
            Timezone is not configured
          </p>
          <p className="text-sm">
            A company timezone is required to use Invoicing.
          </p>
          <p className="text-sm">
            Check company details on the Team page.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
