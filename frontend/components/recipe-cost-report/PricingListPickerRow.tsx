"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const inRow = !!rowRef.current?.contains(target);
      const inMenu = !!menuRef.current?.contains(target);
      if (!inRow && !inMenu) {
        onCloseMenu();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, onCloseMenu]);

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;

    const GAP_PX = 4;
    const SAFE_PX = 8;
    const getBodyCssZoom = () => {
      const raw = Number(window.getComputedStyle(document.body).zoom);
      return Number.isFinite(raw) && raw > 0 ? raw : 1;
    };

    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bodyZoom = getBodyCssZoom();
      const rect = trigger.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      const vv = window.visualViewport;
      const viewportH = (vv?.height ?? window.innerHeight) / bodyZoom;

      // Position values for a fixed element inside zoomed body.
      const triggerTop = rect.top / bodyZoom;
      const triggerBottom = rect.bottom / bodyZoom;
      const triggerRight = rect.right / bodyZoom;

      let top = triggerBottom + GAP_PX;
      if (menuHeight > 0 && top + menuHeight > viewportH - SAFE_PX) {
        top = Math.max(SAFE_PX, triggerTop - GAP_PX - menuHeight);
      }

      setMenuStyle({
        top: Math.max(SAFE_PX, top),
        left: Math.max(SAFE_PX, triggerRight),
        minWidth: rect.width,
      });
    };

    // Initial measurement and a post-paint measurement for menu height.
    updateMenuPosition();
    const raf = window.requestAnimationFrame(updateMenuPosition);

    window.addEventListener("resize", updateMenuPosition);
    // capture=true catches scroll from nested scroll containers.
    window.addEventListener("scroll", updateMenuPosition, true);
    window.visualViewport?.addEventListener("resize", updateMenuPosition);
    window.visualViewport?.addEventListener("scroll", updateMenuPosition);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", updateMenuPosition);
      window.visualViewport?.removeEventListener("scroll", updateMenuPosition);
    };
  }, [menuOpen]);

  const rowShell = `flex items-center rounded-lg border transition-colors ${
    active
      ? isDark
        ? "border-blue-500/50 bg-blue-600/20 text-blue-300"
        : "border-blue-200 bg-blue-50 text-blue-800"
      : isDark
        ? "border-transparent text-slate-300 hover:bg-slate-700/80"
        : "border-transparent text-gray-700 hover:bg-gray-100"
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
          ref={triggerRef}
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
      {menuOpen &&
        mounted &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className={`fixed z-[80] overflow-hidden rounded-lg border py-1 shadow-lg ${
              isDark
                ? "border-slate-600 bg-slate-800"
                : "border-gray-200 bg-white"
            }`}
            style={{
              top: `${menuStyle.top}px`,
              left: `${menuStyle.left}px`,
              transform: "translateX(-100%)",
              minWidth: `${Math.max(96, Math.round(menuStyle.minWidth))}px`,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={`block w-full px-3 text-left text-sm transition-colors ${
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
          </div>,
          document.body,
        )}
    </li>
  );
}
