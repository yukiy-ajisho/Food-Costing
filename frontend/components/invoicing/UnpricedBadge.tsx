"use client";

export const UNPRICED_TOOLTIP =
  "This item has no wholesale price on the currently selected wholesale list.";

const hoverTooltipBaseClass = (isDark: boolean) =>
  `pointer-events-none z-50 max-w-xs whitespace-normal rounded-md border px-2 py-1 text-xs shadow-md backdrop-blur-sm transition-opacity duration-100 ${
    isDark
      ? "border-slate-600/80 bg-slate-800/90 text-slate-200"
      : "border-gray-200/80 bg-white/95 text-gray-700"
  }`;

const hoverTooltipRightClass = (isDark: boolean) =>
  `${hoverTooltipBaseClass(isDark)} absolute left-[calc(100%+4px)] top-1/2 w-56 -translate-y-1/2 opacity-0 group-hover/unpriced:opacity-100`;

export function UnpricedBadge({ isDark }: { isDark: boolean }) {
  return (
    <span
      className={`group/unpriced relative inline-flex shrink-0 items-center ${isDark ? "" : ""}`}
    >
      <span
        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
          isDark
            ? "bg-amber-900/40 text-amber-200"
            : "bg-amber-100 text-amber-900"
        }`}
      >
        Unpriced
      </span>
      <span role="tooltip" className={hoverTooltipRightClass(isDark)}>
        {UNPRICED_TOOLTIP}
      </span>
    </span>
  );
}
