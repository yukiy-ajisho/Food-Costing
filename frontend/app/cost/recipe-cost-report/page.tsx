"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "@/contexts/ThemeContext";
import { canAccessRecipeCostReport } from "@/lib/recipeCostReportAccess";
import { RecipeCostReportListPage } from "@/components/recipe-cost-report/RecipeCostReportListPage";

type ReportTab = "wholesale" | "menu";

function tabFromSearchParams(params: URLSearchParams): ReportTab {
  return params.get("tab") === "menu" ? "menu" : "wholesale";
}

function RecipeCostReportPageContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    companies,
    selectedCompanyId,
    loading: companyLoading,
  } = useCompany();
  const { selectedTenantId, tenants, loading: tenantLoading } = useTenant();
  const canAccess = useMemo(
    () =>
      canAccessRecipeCostReport(
        selectedCompanyId,
        selectedTenantId,
        companies,
        tenants,
      ),
    [selectedCompanyId, selectedTenantId, companies, tenants],
  );
  const activeTab = tabFromSearchParams(searchParams);

  const setActiveTab = (tab: ReportTab) => {
    const q = tab === "menu" ? "menu" : "wholesale";
    router.replace(`/cost/recipe-cost-report?tab=${q}`);
  };

  const textMuted = isDark ? "text-slate-400" : "text-gray-500";

  if (tenantLoading || companyLoading) {
    return (
      <div className={`flex h-full items-center justify-center p-12 text-sm ${textMuted}`}>
        Loading…
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className={`min-h-full p-6 ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
        <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <h1 className="mb-2 text-lg font-semibold">Pricing</h1>
          <p className="text-sm">
            Pricing is available to company administrators and directors,
            or tenant administrators and directors only.
          </p>
        </div>
      </div>
    );
  }

  const tabBtn = (tab: ReportTab, label: string) => {
    const active = activeTab === tab;
    return (
      <button
        type="button"
        onClick={() => setActiveTab(tab)}
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
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed ${
        isDark ? "bg-slate-900" : "bg-gray-50"
      }`}
    >
      <div className="flex h-full min-h-0 flex-col px-6 py-4 lg:px-8">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
          <div
            className={`mb-4 shrink-0 border-b transition-colors ${
              isDark ? "border-slate-700" : "border-gray-200"
            }`}
          >
            <nav className="flex space-x-8">
              {tabBtn("wholesale", "Wholesale price")}
              {tabBtn("menu", "Retail price")}
            </nav>
          </div>
          <RecipeCostReportListPage
            key={activeTab}
            pageMode={activeTab === "menu" ? "menu" : "wholesale"}
            showPageHeading={false}
          />
        </div>
      </div>
    </div>
  );
}

export default function RecipeCostReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <RecipeCostReportPageContent />
    </Suspense>
  );
}
