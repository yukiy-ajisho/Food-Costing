"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";
import {
  addDaysYmd,
  maxAmountBefore,
  minAmountAfter,
} from "@/lib/invoiceBoxTable";
import {
  isOutsidePortaledMenu,
  usePortaledHeaderMenu,
} from "./usePortaledHeaderMenu";

type Props = {
  isDark: boolean;
  kind: "date" | "amount";
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  ariaLabel: string;
  fromLabel?: string;
  toLabel?: string;
};

export function InvoiceBoxHeaderRangeFilter({
  isDark,
  kind,
  min,
  max,
  onChange,
  ariaLabel,
  fromLabel = "From",
  toLabel = "To",
}: Props) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef, mounted, menuStyle } = usePortaledHeaderMenu(open);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (isOutsidePortaledMenu(e.target as Node, triggerRef, menuRef)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, triggerRef, menuRef]);

  const active = min.trim() !== "" || max.trim() !== "";
  const panel = isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const fieldCls = `invoicing-box-mini-field h-7 w-full rounded border px-1.5 text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const clearCls = `mt-1.5 w-full rounded px-2 py-1 text-left text-[11px] ${
    isDark
      ? "text-slate-300 hover:bg-slate-700"
      : "text-gray-700 hover:bg-gray-50"
  }`;

  const dateMaxMin = min ? addDaysYmd(min, 1) : undefined;
  const dateMinMax = max ? addDaysYmd(max, -1) : undefined;

  const filterButton = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
        active
          ? isDark
            ? "text-blue-400 hover:bg-slate-600"
            : "text-blue-600 hover:bg-blue-50"
          : isDark
            ? "text-slate-500 hover:bg-slate-600 hover:text-slate-300"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      }`}
    >
      <Filter className="h-3 w-3" strokeWidth={2.25} />
    </button>
  );

  const menu =
    open && menuStyle ? (
      <div
        ref={menuRef}
        className={`fixed z-[80] min-w-42 rounded border p-2 shadow-lg ${panel}`}
        style={{ top: menuStyle.top, left: menuStyle.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "date" ? (
          <div className="space-y-2">
            <label className={`block text-[10px] font-medium uppercase ${muted}`}>
              {fromLabel}
              <input
                type="date"
                className={`${fieldCls} mt-0.5`}
                value={min}
                max={dateMinMax}
                onChange={(e) => onChange(e.target.value, max)}
              />
            </label>
            <label className={`block text-[10px] font-medium uppercase ${muted}`}>
              {toLabel}
              <input
                type="date"
                className={`${fieldCls} mt-0.5`}
                value={max}
                min={dateMaxMin}
                onChange={(e) => onChange(min, e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            <label className={`block text-[10px] font-medium uppercase ${muted}`}>
              Min
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="Min"
                className={`${fieldCls} mt-0.5`}
                value={min}
                max={max ? maxAmountBefore(max) : undefined}
                onChange={(e) => onChange(e.target.value, max)}
              />
            </label>
            <label className={`block text-[10px] font-medium uppercase ${muted}`}>
              Max
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="Max"
                className={`${fieldCls} mt-0.5`}
                value={max}
                min={min ? minAmountAfter(min) : undefined}
                onChange={(e) => onChange(min, e.target.value)}
              />
            </label>
          </div>
        )}
        <button
          type="button"
          className={clearCls}
          onClick={() => onChange("", "")}
        >
          Clear
        </button>
      </div>
    ) : null;

  return (
    <>
      {filterButton}
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
