"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

/** Fixed-width slot so layout does not shift when radios replace loader. */
export const COST_BASIS_CONTROL_SLOT_CLASS = "inline-flex h-5 w-[11.5rem] shrink-0 items-center";

type Props = {
  loading: boolean;
  isDark: boolean;
  children: ReactNode;
};

export function CostBasisControlSlot({ loading, isDark, children }: Props) {
  return (
    <div
      className={`${COST_BASIS_CONTROL_SLOT_CLASS} justify-center`}
      aria-busy={loading}
    >
      {loading ? (
        <Loader2
          className={`h-4 w-4 animate-spin ${isDark ? "text-slate-400" : "text-gray-400"}`}
          aria-label="Loading cost basis"
        />
      ) : (
        <div className="flex w-full items-center justify-start">{children}</div>
      )}
    </div>
  );
}
