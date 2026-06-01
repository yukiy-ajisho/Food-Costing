"use client";

import { useEffect, useRef, useState } from "react";
import { Filter } from "lucide-react";

type Props = {
  isDark: boolean;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  ariaLabel: string;
};

export function InvoiceBoxHeaderFilter({
  isDark,
  value,
  onChange,
  options,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = value.trim() !== "";
  const panel = isDark ? "bg-slate-800 border-slate-600" : "bg-white border-gray-200";
  const item = isDark
    ? "text-slate-200 hover:bg-slate-700"
    : "text-gray-800 hover:bg-gray-50";
  const itemActive = isDark ? "bg-slate-700 text-slate-100" : "bg-gray-100 text-gray-900";

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
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
      {open ? (
        <div
          className={`absolute left-0 top-full z-30 mt-0.5 max-h-44 min-w-[9rem] overflow-auto rounded border py-0.5 shadow-lg ${panel}`}
        >
          <button
            type="button"
            className={`block w-full px-2 py-1 text-left text-[11px] ${!value ? itemActive : item}`}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            All
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`block w-full px-2 py-1 text-left text-[11px] ${
                value === opt ? itemActive : item
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
