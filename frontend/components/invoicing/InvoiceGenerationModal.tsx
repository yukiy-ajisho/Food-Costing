"use client";

import { X } from "lucide-react";
import { InvoiceGenerationTab } from "./InvoiceGenerationTab";

type Props = {
  isDark: boolean;
  onClose: () => void;
  onInvoiceSaved?: () => void;
};

export function InvoiceGenerationModal({
  isDark,
  onClose,
  onInvoiceSaved,
}: Props) {
  const panel = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-gray-900";
  const border = isDark ? "border-slate-700" : "border-gray-200";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 px-12 pt-20 pb-4">
      <div
        className={`mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col overflow-hidden rounded-lg shadow-xl ${panel}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2 className="text-lg font-semibold">Generate Invoice</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 lg:px-6">
          <InvoiceGenerationTab onInvoiceSaved={onInvoiceSaved} />
        </div>
      </div>
    </div>
  );
}
