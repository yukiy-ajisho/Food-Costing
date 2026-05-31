"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCompany } from "@/contexts/CompanyContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "@/contexts/ThemeContext";
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
  const { loading: companyLoading } = useCompany();
  const { loading: tenantLoading } = useTenant();
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
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
          <div
            className={`mb-4 shrink-0 border-b transition-colors ${
              isDark ? "border-slate-700" : "border-gray-200"
            }`}
          >
            <nav className="flex space-x-8">
              {tabBtn("wholesale", "Wholesale Costing")}
              {tabBtn("menu", "Pricing Strategy")}
            </nav>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <RecipeCostReportListPage
              key={activeTab}
              pageMode={activeTab === "menu" ? "menu" : "wholesale"}
              showPageHeading={false}
            />
          </div>
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
