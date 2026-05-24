"use client";

export function ItemKindBadge({
  isMenuItem,
  isDark,
}: {
  isMenuItem: boolean;
  isDark: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
        isMenuItem
          ? isDark
            ? "bg-violet-900/40 text-violet-200"
            : "bg-violet-100 text-violet-800"
          : isDark
            ? "bg-slate-700 text-slate-300"
            : "bg-gray-100 text-gray-600"
      }`}
    >
      {isMenuItem ? "Menu" : "Prepped"}
    </span>
  );
}
