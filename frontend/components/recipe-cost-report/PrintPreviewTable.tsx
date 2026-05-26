"use client";

import type { CostBreakdown, ListMemberRow } from "@/lib/recipeCostReport";
import {
  formatCostDisplay,
  formatListPriceDisplay,
  lcogPercent,
  type FormatCostDisplayOptions,
} from "@/lib/recipeCostReportCalc";
import {
  PRINT_COLUMN_KEYS,
  printColumnLabel,
  printReportTypeLabel,
  type PrintColumnSelection,
  type PrintReportType,
} from "@/lib/recipeCostReportPrint";
import { ItemKindBadge } from "./ItemKindBadge";

type Props = {
  listName: string;
  reportType: PrintReportType;
  members: ListMemberRow[];
  costs: Record<string, CostBreakdown>;
  columns: PrintColumnSelection;
  costDisplayOptions: FormatCostDisplayOptions;
  compact?: boolean;
  className?: string;
};

export function PrintPreviewTable({
  listName,
  reportType,
  members,
  costs,
  columns,
  costDisplayOptions,
  compact = false,
  className = "",
}: Props) {
  const visibleKeys = PRINT_COLUMN_KEYS.filter((k) => columns[k]);
  const cellPad = compact ? "px-2 py-1" : "px-3 py-1.5";
  const textSize = compact ? "text-xs" : "text-sm";

  if (visibleKeys.length === 0) {
    return (
      <div
        className={`flex h-full min-h-[12rem] items-center justify-center text-sm text-gray-500 ${className}`}
      >
        Select at least one column to preview.
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={`mb-3 ${compact ? "text-xs" : "text-sm"}`}>
        <div className="font-semibold text-gray-900">
          {printReportTypeLabel(reportType)}
        </div>
        <div className="font-medium text-gray-800">{listName}</div>
      </div>
      <table className={`w-full border-collapse ${textSize} print:text-black`}>
        <thead>
          <tr className="border-b border-gray-300 bg-gray-50">
            {visibleKeys.map((key) => (
              <th
                key={key}
                className={`${cellPad} text-left font-medium text-gray-700`}
              >
                {printColumnLabel(key, reportType)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr>
              <td
                colSpan={visibleKeys.length}
                className={`${cellPad} text-center text-gray-500`}
              >
                No items on this list.
              </td>
            </tr>
          ) : (
            members.map((row) => {
              const bd = costs[row.item_id];
              const priceStored =
                reportType === "wholesale"
                  ? row.latest_wholesale_price
                  : row.latest_retail_price;
              const lcogStr = lcogPercent(bd, priceStored);
              return (
                <tr key={row.item_id} className="border-b border-gray-200">
                  {visibleKeys.map((key) => (
                    <td
                      key={key}
                      className={`${cellPad} tabular-nums text-gray-900`}
                    >
                      {key === "item" && (
                        <span className="font-medium">{row.name}</span>
                      )}
                      {key === "type" && (
                        <ItemKindBadge
                          isMenuItem={row.is_menu_item}
                          isDark={false}
                        />
                      )}
                      {key === "cost" &&
                        formatCostDisplay(row, bd, costDisplayOptions)}
                      {key === "price" &&
                        formatListPriceDisplay(
                          priceStored,
                          row,
                          costDisplayOptions.eachMode,
                          costDisplayOptions.menuPricingEach,
                        )}
                      {key === "lcog" && lcogStr}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
