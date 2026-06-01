"use client";

import { Suspense } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { InvoiceBoxTab } from "@/components/invoicing/InvoiceBoxTab";
import { InvoicingAccessGate } from "@/components/invoicing/InvoicingAccessGate";

function InvoicePageContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <InvoicingAccessGate>
      <div
        className={`flex h-full min-h-0 flex-col overflow-hidden [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed ${
          isDark ? "bg-slate-900" : "bg-gray-50"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col px-6 py-4 lg:px-8">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
            <InvoiceBoxTab />
          </div>
        </div>
      </div>
    </InvoicingAccessGate>
  );
}

export default function InvoicingInvoicePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-0 items-center justify-center p-12 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <InvoicePageContent />
    </Suspense>
  );
}
