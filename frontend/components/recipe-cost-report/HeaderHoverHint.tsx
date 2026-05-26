"use client";

import type { ReactNode } from "react";

function hintClass(isDark: boolean, multiline: boolean) {
  const position = multiline
    ? "left-1/2 -translate-x-1/2 min-w-[13rem] max-w-[17rem] w-max whitespace-normal text-left"
    : "left-0 whitespace-nowrap";
  return `pointer-events-none absolute top-[calc(100%+4px)] z-50 rounded-md border px-2 py-1 text-xs normal-case font-normal tracking-normal shadow-md backdrop-blur-sm opacity-0 transition-opacity duration-100 group-hover/col-hint:opacity-100 ${position} ${
    isDark
      ? "border-slate-600/80 bg-slate-800/90 text-slate-200"
      : "border-gray-200/80 bg-white/95 text-gray-700"
  }`;
}

/** Column header hint — CSS hover (browser `title` has a long show delay). */
export function HeaderHoverHint({
  hint,
  isDark,
  className = "",
  multiline = false,
  children,
}: {
  hint: string;
  isDark: boolean;
  className?: string;
  multiline?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`group/col-hint relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className={hintClass(isDark, multiline)}>
        {hint}
      </span>
    </span>
  );
}
