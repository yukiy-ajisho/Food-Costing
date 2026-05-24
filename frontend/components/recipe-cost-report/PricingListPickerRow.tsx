"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal } from "lucide-react";

type Props = {
  name: string;
  active: boolean;
  isDark: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onDelete: () => void;
};

export function PricingListPickerRow({
  name,
  active,
  isDark,
  menuOpen,
  onSelect,
  onToggleMenu,
  onCloseMenu,
  onDelete,
}: Props) {
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        onCloseMenu();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, onCloseMenu]);

  const rowShell = `flex items-center rounded-lg transition-colors ${
    active
      ? isDark
        ? "bg-blue-600/20 text-blue-300 ring-1 ring-blue-500/50"
        : "bg-blue-50 text-blue-800 ring-1 ring-blue-200"
      : isDark
        ? "text-slate-300 hover:bg-slate-700/80"
        : "text-gray-700 hover:bg-gray-100"
  }`;

  return (
    <li ref={rowRef} className="relative">
      <div className={rowShell}>
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 rounded-l-lg px-3 py-2.5 text-left text-sm font-medium"
        >
          <span className="line-clamp-2">{name}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          aria-label={`Actions for ${name}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={`inline-flex shrink-0 items-center justify-center self-stretch rounded-r-lg px-2 transition-colors ${
            isDark
              ? "text-slate-400 hover:text-slate-200"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          <MoreHorizontal className="h-4 w-4 -translate-y-px" strokeWidth={2} />
        </button>
      </div>
      {menuOpen && (
        <div
          role="menu"
          className={`absolute right-0 top-full z-30 mt-1 min-w-[7.5rem] overflow-hidden rounded-lg border py-1 shadow-lg ${
            isDark
              ? "border-slate-600 bg-slate-800"
              : "border-gray-200 bg-white"
          }`}
        >
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
              isDark
                ? "text-red-400 hover:bg-slate-700"
                : "text-red-600 hover:bg-red-50"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onCloseMenu();
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
