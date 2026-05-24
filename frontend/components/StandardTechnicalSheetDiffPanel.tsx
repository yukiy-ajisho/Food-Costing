"use client";

import {
  type StandardRecipeDiff,
  type StandardRecipeDiffLine,
} from "@/lib/api";

function formatGrams(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} g`;
}

export function StandardTechnicalSheetDiffPanel({
  diff,
  isDark,
}: {
  diff: StandardRecipeDiff;
  isDark: boolean;
}) {
  const typeByKey = new Map(diff.lines.map((l) => [l.row_key, l.type]));
  const savedByKey = new Map(diff.saved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(diff.live.map((l) => [l.row_key, l]));
  const rowKeys = [
    ...new Set([
      ...diff.saved.map((l) => l.row_key),
      ...diff.live.map((l) => l.row_key),
    ]),
  ].sort((a, b) => {
    const nameA = savedByKey.get(a)?.name ?? liveByKey.get(a)?.name ?? a;
    const nameB = savedByKey.get(b)?.name ?? liveByKey.get(b)?.name ?? b;
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });

  if (rowKeys.length === 0) {
    return (
      <p className={`text-sm ${isDark ? "text-slate-300" : "text-gray-600"}`}>
        No recipe differences.
      </p>
    );
  }

  const rowClass = (type: StandardRecipeDiffLine["type"] | undefined) => {
    if (type === "added") return isDark ? "bg-green-950/40" : "bg-green-50";
    if (type === "removed") return isDark ? "bg-red-950/40" : "bg-red-50";
    if (type === "changed") return isDark ? "bg-amber-950/40" : "bg-amber-50";
    return isDark ? "bg-slate-800" : "bg-gray-50";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] border-collapse text-sm">
        <thead>
          <tr className={isDark ? "bg-slate-900" : "bg-gray-100"}>
            <th className="border px-3 py-2 text-left">Ingredient</th>
            <th className="border px-3 py-2 text-left">Vendor Selection</th>
            <th className="border px-3 py-2 text-right">Technical sheet (g)</th>
            <th className="border px-3 py-2 text-right">Live recipe (g)</th>
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((rowKey) => {
            const type = typeByKey.get(rowKey);
            const saved = savedByKey.get(rowKey);
            const live = liveByKey.get(rowKey);
            const diffLine = diff.lines.find((l) => l.row_key === rowKey);
            return (
              <tr key={rowKey} className={rowClass(type)}>
                <td className="border px-3 py-2 font-medium">
                  {saved?.name ?? live?.name ?? rowKey}
                </td>
                <td className="border px-3 py-2 text-xs">
                  {diffLine?.saved_vendor_label ??
                    saved?.vendor_label ??
                    "—"}{" "}
                  →{" "}
                  {diffLine?.live_vendor_label ?? live?.vendor_label ?? "—"}
                </td>
                <td
                  className={`border px-3 py-2 text-right ${
                    type === "removed"
                      ? isDark
                        ? "text-red-300 line-through"
                        : "text-red-700 line-through"
                      : ""
                  }`}
                >
                  {formatGrams(saved?.grams ?? null)}
                </td>
                <td
                  className={`border px-3 py-2 text-right ${
                    type === "added"
                      ? isDark
                        ? "text-green-300"
                        : "text-green-800"
                      : type === "changed"
                        ? isDark
                          ? "text-amber-200 font-semibold"
                          : "text-amber-900 font-semibold"
                        : ""
                  }`}
                >
                  {formatGrams(live?.grams ?? null)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
