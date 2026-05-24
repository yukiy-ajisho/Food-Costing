"use client";

import type { CostBasis } from "@/lib/recipeCostReport";
import { costBasisLabel } from "@/lib/recipeCostReportCostBasis";

/** Distinct from Menu (violet) / Prepped (gray) badges. */
export function CostBasisBadge({
  basis,
  isDark,
}: {
  basis: CostBasis;
  isDark: boolean;
}) {
  const cls =
    basis === "wholesale"
      ? isDark
        ? "bg-teal-900/40 text-teal-200"
        : "bg-teal-100 text-teal-800"
      : isDark
        ? "bg-blue-900/40 text-blue-200"
        : "bg-blue-100 text-blue-800";

  return (
    <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {costBasisLabel(basis)}
    </span>
  );
}
