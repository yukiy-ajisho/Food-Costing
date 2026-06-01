"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import { AccountInformationTab } from "@/components/invoicing/AccountInformationTab";
import { DeliverySiteTab } from "@/components/invoicing/DeliverySiteTab";
import { InvoicingAccessGate } from "@/components/invoicing/InvoicingAccessGate";

type AccountTab = "accounts" | "delivery-site";

function accountTabFromParams(params: URLSearchParams): AccountTab {
  const tab = params.get("tab");
  if (tab === "delivery" || tab === "delivery-site") return "delivery-site";
  return "accounts";
}

function AccountPageContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const searchParams = useSearchParams();
  const [accountTab, setAccountTab] = useState<AccountTab>(() =>
    accountTabFromParams(searchParams),
  );

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
    <InvoicingAccessGate>
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
                {subTabBtn(
                  accountTab === "accounts",
                  () => setAccountTab("accounts"),
                  "Account Information",
                )}
                {subTabBtn(
                  accountTab === "delivery-site",
                  () => setAccountTab("delivery-site"),
                  "Delivery Site",
                )}
              </nav>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {accountTab === "accounts" ? <AccountInformationTab /> : null}
              {accountTab === "delivery-site" ? <DeliverySiteTab /> : null}
            </div>
          </div>
        </div>
      </div>
    </InvoicingAccessGate>
  );
}

export default function InvoicingAccountPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <AccountPageContent />
    </Suspense>
  );
}
