"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AccountInformationTab } from "@/components/invoicing/AccountInformationTab";
import { DeliverySiteTab } from "@/components/invoicing/DeliverySiteTab";
import { InvoiceGenerationTab } from "@/components/invoicing/InvoiceGenerationTab";
import { InvoiceBoxTab } from "@/components/invoicing/InvoiceBoxTab";

type InvoicingSection = "account" | "invoice";
type AccountTab = "accounts" | "delivery-site";
type InvoiceTab = "box" | "generation";

function sectionFromParams(params: URLSearchParams): InvoicingSection {
  const section = params.get("section");
  if (section === "account") return "account";
  const legacyTab = params.get("tab");
  if (legacyTab === "delivery") return "account";
  return "invoice";
}

function accountTabFromParams(params: URLSearchParams): AccountTab {
  const tab = params.get("tab");
  if (tab === "delivery" || tab === "delivery-site") return "delivery-site";
  if (tab === "accounts") return "accounts";
  return "accounts";
}

function invoiceTabFromParams(params: URLSearchParams): InvoiceTab {
  const tab = params.get("tab");
  if (tab === "box") return "box";
  if (tab === "generation") return "generation";
  return "box";
}

function InvoicingPageContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: companyLoading, companies, selectedCompanyId } =
    useCompany();
  const { loading: tenantLoading, tenants, selectedTenantId } = useTenant();
  const section = sectionFromParams(searchParams);
  const accountTab = accountTabFromParams(searchParams);
  const invoiceTab = invoiceTabFromParams(searchParams);

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

  const navigateTab = (tab: string) => {
    router.replace(`/invoicing?section=${section}&tab=${tab}`);
  };

  const textMuted = isDark ? "text-slate-400" : "text-gray-500";

  if (tenantLoading || companyLoading) {
    return (
      <div className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}>
        Loading…
      </div>
    );
  }

  if (!canAccessInvoicing) {
    return (
      <div className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}>
        You do not have permission to access Invoicing.
      </div>
    );
  }

  const subTabBtn = (active: boolean, onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
        active
          ? "border-blue-500 text-blue-600"
          : isDark
            ? "border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-300"
            : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`}
    >
      <div className="flex h-full min-h-0 flex-col px-6 py-4 lg:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
          <div
            className={`mb-4 shrink-0 border-b transition-colors ${
              isDark ? "border-slate-700" : "border-gray-200"
            }`}
          >
            <nav className="flex space-x-8">
              {section === "account" ? (
                <>
                  {subTabBtn(
                    accountTab === "accounts",
                    () => navigateTab("accounts"),
                    "Account Information",
                  )}
                  {subTabBtn(
                    accountTab === "delivery-site",
                    () => navigateTab("delivery-site"),
                    "Delivery Site",
                  )}
                </>
              ) : (
                <>
                  {subTabBtn(
                    invoiceTab === "box",
                    () => navigateTab("box"),
                    "Invoice Box",
                  )}
                  {subTabBtn(
                    invoiceTab === "generation",
                    () => navigateTab("generation"),
                    "Invoice Generation",
                  )}
                </>
              )}
            </nav>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {section === "account" && accountTab === "accounts" ? (
              <AccountInformationTab />
            ) : null}
            {section === "account" && accountTab === "delivery-site" ? (
              <DeliverySiteTab />
            ) : null}
            {section === "invoice" && invoiceTab === "box" ? (
              <InvoiceBoxTab />
            ) : null}
            {section === "invoice" && invoiceTab === "generation" ? (
              <InvoiceGenerationTab />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoicingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <InvoicingPageContent />
    </Suspense>
  );
}
