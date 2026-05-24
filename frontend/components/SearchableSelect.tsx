"use client";

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown } from "lucide-react";
import {
  useFloating,
  autoUpdate,
  offset,
  size,
} from "@floating-ui/react";
import { useTheme } from "@/contexts/ThemeContext";

/** `globals.css` の `body { zoom: var(--ui-scale) }` と `position: fixed` の整合用 */
function getBodyCssZoom(): number {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.getComputedStyle(document.body).zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Floating UI の座標はビューポート基準だが、メニューは zoom された body 配下に描画するため除算で合わせる（クラシック実装と同じ考え方） */
function bodyZoomFloatingCoords() {
  return {
    name: "bodyZoomFloatingCoords",
    fn(state: { x: number; y: number }) {
      const z = getBodyCssZoom();
      if (z === 1) return {};
      return { x: state.x / z, y: state.y / z };
    },
  };
}

/**
 * `size` 適用後の浮動要素矩形を visualViewport 基準で収める。
 * `shift` の縦補正は、body zoom や初回レイアウト前の高さと相性が悪く、余裕があるのに上へ寄せることがあるため使わない。
 */
function clampFloatingToViewport() {
  return {
    name: "clampFloatingToViewport",
    fn(state: {
      x: number;
      y: number;
      rects: { floating: { width: number; height: number } };
    }) {
      if (typeof window === "undefined") return {};
      let { x, y } = state;
      const fw = state.rects.floating.width;
      const fhRaw = state.rects.floating.height;
      if (!Number.isFinite(fhRaw) || fhRaw < 1) return {};
      // 初回レイアウトで inner の max-height が未反映のとき fh が過大になり、誤って大きく上へ寄せるのを防ぐ
      const MAX_MENU_PANEL_H = 520;
      const fh = Math.min(fhRaw, MAX_MENU_PANEL_H);

      const pad = 8;
      const vv = window.visualViewport;
      const vpLeft = vv?.offsetLeft ?? 0;
      const vpTop = vv?.offsetTop ?? 0;
      const vpW = vv?.width ?? window.innerWidth;
      const vpH = vv?.height ?? window.innerHeight;
      const innerLeft = vpLeft + pad;
      const innerTop = vpTop + pad;
      const innerRight = vpLeft + vpW - pad;
      const innerBottom = vpTop + vpH - pad;

      y = Math.min(y, innerBottom - fh);
      y = Math.max(y, innerTop);
      x = Math.min(x, innerRight - fw);
      x = Math.max(x, innerLeft);

      if (x === state.x && y === state.y) return {};
      return { x, y };
    },
  };
}

export interface SearchableSelectProps {
  options: {
    id: string;
    name: string;
    subLabel?: string;
    hoverLabel?: string;
    /** If set, the search box matches against this text instead of `name` (e.g. product_name only). */
    searchText?: string;
    /** Highlight row as a ranked match (e.g. invoice link candidate). */
    matchCandidate?: boolean;
    /** Red dot (e.g. base item incompatible with non-mass invoice line). */
    warningDot?: boolean;
    disabled?: boolean;
    deprecated?: boolean;
    isUnused?: boolean;
  }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  showSubLabel?: boolean;
  /**
   * When true: menu is portaled to `document.body`, positioned with Floating UI
   * (offset / size / viewport clamp + ancestor scroll via autoUpdate). No flip:
   * vertical position stays under the trigger when possible; clamp pulls up only
   * when the menu would extend past the visual viewport bottom.
   */
  useFloatingPortal?: boolean;
  /** Vendor Items グリッド矢印移動用（トリガー button に付与） */
  gridCell?: { row: number; col: string };
}

type SearchableSelectInnerProps = Omit<
  SearchableSelectProps,
  "useFloatingPortal"
>;

export function SearchableSelect({
  useFloatingPortal = false,
  ...rest
}: SearchableSelectProps) {
  if (useFloatingPortal) {
    return <SearchableSelectFloating {...rest} />;
  }
  return <SearchableSelectClassic {...rest} />;
}

function SearchableSelectClassic({
  options,
  value,
  onChange,
  placeholder = "Search and select...",
  disabled = false,
  showSubLabel = true,
  gridCell,
}: SearchableSelectInnerProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const bodyZoom = getBodyCssZoom();

    // body zoom 使用時でも fixed 座標とボタン位置を一致させる
    setMenuPosition({
      top: rect.bottom / bodyZoom + 4,
      left: rect.left / bodyZoom,
      width: rect.width / bodyZoom,
    });
  }, []);

  const selectedItem = options.find((opt) => opt.id === value);

  const filteredOptions = options.filter((option) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    const hay = (option.searchText ?? option.name).toLowerCase();
    return hay.includes(q);
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();

    const onViewportChange = () => updateMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);

    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <>
      <div className="group relative w-full" ref={dropdownRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          title={selectedItem?.hoverLabel}
          {...(gridCell
            ? {
                "data-vi-row": gridCell.row,
                "data-vi-col": gridCell.col,
              }
            : {})}
          className={`w-full text-left border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between transition-colors ${
            disabled
              ? isDark
                ? "bg-slate-800 cursor-not-allowed border-slate-600"
                : "bg-gray-100 cursor-not-allowed border-gray-300"
              : isDark
                ? "bg-slate-700 border-slate-600"
                : "bg-white border-gray-300"
          }`}
          style={{
            height: "20px",
            minHeight: "20px",
            maxHeight: "20px",
            lineHeight: "20px",
            padding: "0 4px",
            fontSize: "0.875rem",
            boxSizing: "border-box",
            margin: 0,
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {selectedItem?.warningDot && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isDark ? "bg-red-400" : "bg-red-600"
                }`}
                aria-hidden
              />
            )}
            {selectedItem ? (
              <>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    isDark ? "text-slate-100" : "text-gray-900"
                  }`}
                >
                  {selectedItem.name}
                </span>
                {showSubLabel && selectedItem.subLabel && (
                  <span
                    className={`shrink-0 whitespace-nowrap text-right text-xs ${
                      isDark ? "text-slate-400" : "text-gray-400"
                    }`}
                  >
                    {selectedItem.subLabel}
                  </span>
                )}
              </>
            ) : (
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                {placeholder}
              </span>
            )}
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              isDark ? "text-slate-400" : "text-gray-400"
            } ${isOpen ? "transform rotate-180" : ""}`}
          />
        </button>
        {selectedItem?.hoverLabel ? (
          <div
            className={`pointer-events-none absolute left-0 top-full z-60 mt-1 hidden max-w-[320px] rounded px-2 py-1 text-xs shadow-lg group-hover:block ${
              isDark
                ? "bg-slate-900 text-slate-100 border border-slate-700"
                : "bg-gray-900 text-white"
            }`}
          >
            {selectedItem.hoverLabel}
          </div>
        ) : null}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          data-searchable-select-dropdown
          className={`fixed z-50 border rounded-md shadow-lg transition-colors ${
            isDark
              ? "bg-slate-800 border-slate-600"
              : "bg-white border-gray-300"
          }`}
          style={{
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            width: menuPosition.width > 0 ? `${menuPosition.width}px` : "auto",
            minWidth: "250px",
          }}
        >
          <SearchableSelectMenuBody
            isDark={isDark}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredOptions={filteredOptions}
            showSubLabel={showSubLabel}
            value={value}
            handleSelect={handleSelect}
            listClassName="max-h-96 overflow-auto"
          />
        </div>
      )}
    </>
  );
}

function SearchableSelectFloating({
  options,
  value,
  onChange,
  placeholder = "Search and select...",
  disabled = false,
  showSubLabel = true,
  gridCell,
}: SearchableSelectInnerProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [mounted, setMounted] = useState(false);
  /** size の width（React style に同期。高さはクラシック同様 max-h-96 のみで viewport 連動させない） */
  const [floatingSizeStyle, setFloatingSizeStyle] = useState<CSSProperties>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setFloatingSizeStyle({});
    }
  }, [isOpen]);

  const { refs, floatingStyles, update } = useFloating({
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [
      offset(4),
      size({
        padding: 8,
        apply({ availableWidth, rects, elements }) {
          const z = getBodyCssZoom();
          const minW = 250;
          const refW = rects.reference.width / z;
          const availW = Number.isFinite(availableWidth)
            ? availableWidth
            : refW;
          const width = Math.min(Math.max(refW, minW), Math.max(availW, minW));
          const widthPx = `${width}px`;

          Object.assign(elements.floating.style, {
            width: widthPx,
          });
          queueMicrotask(() => {
            setFloatingSizeStyle((prev) =>
              prev.width === widthPx ? prev : { width: widthPx },
            );
          });
        },
      }),
      clampFloatingToViewport(),
      bodyZoomFloatingCoords(),
    ],
    whileElementsMounted: autoUpdate,
  });

  const selectedItem = options.find((opt) => opt.id === value);

  const filteredOptions = options.filter((option) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    const hay = (option.searchText ?? option.name).toLowerCase();
    return hay.includes(q);
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    void update();
  }, [isOpen, update, searchTerm, filteredOptions.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      const refEl = refs.reference.current;
      if (refEl instanceof Element && refEl.contains(t)) return;
      if (refs.floating.current?.contains(t)) return;
      setIsOpen(false);
      setSearchTerm("");
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
    // refs from useFloating are stable; listener must read latest .current
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs object identity is stable
  }, []);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearchTerm("");
  };

  const menu =
    isOpen && mounted ? (
      <div
        ref={refs.setFloating}
        data-searchable-select-dropdown
        className={`z-[100] border rounded-md shadow-lg transition-colors ${
          isDark
            ? "bg-slate-800 border-slate-600"
            : "bg-white border-gray-300"
        }`}
        style={{
          ...floatingStyles,
          minWidth: 250,
          ...floatingSizeStyle,
        }}
      >
        <SearchableSelectMenuBody
          isDark={isDark}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filteredOptions={filteredOptions}
          showSubLabel={showSubLabel}
          value={value}
          handleSelect={handleSelect}
          listClassName="max-h-96 overflow-auto"
        />
      </div>
    ) : null;

  return (
    <>
      <div className="group relative w-full">
        <button
          ref={refs.setReference}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          title={selectedItem?.hoverLabel}
          {...(gridCell
            ? {
                "data-vi-row": gridCell.row,
                "data-vi-col": gridCell.col,
              }
            : {})}
          className={`w-full text-left border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between transition-colors ${
            disabled
              ? isDark
                ? "bg-slate-800 cursor-not-allowed border-slate-600"
                : "bg-gray-100 cursor-not-allowed border-gray-300"
              : isDark
                ? "bg-slate-700 border-slate-600"
                : "bg-white border-gray-300"
          }`}
          style={{
            height: "20px",
            minHeight: "20px",
            maxHeight: "20px",
            lineHeight: "20px",
            padding: "0 4px",
            fontSize: "0.875rem",
            boxSizing: "border-box",
            margin: 0,
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {selectedItem?.warningDot && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isDark ? "bg-red-400" : "bg-red-600"
                }`}
                aria-hidden
              />
            )}
            {selectedItem ? (
              <>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    isDark ? "text-slate-100" : "text-gray-900"
                  }`}
                >
                  {selectedItem.name}
                </span>
                {showSubLabel && selectedItem.subLabel && (
                  <span
                    className={`shrink-0 whitespace-nowrap text-right text-xs ${
                      isDark ? "text-slate-400" : "text-gray-400"
                    }`}
                  >
                    {selectedItem.subLabel}
                  </span>
                )}
              </>
            ) : (
              <span className={isDark ? "text-slate-400" : "text-gray-500"}>
                {placeholder}
              </span>
            )}
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              isDark ? "text-slate-400" : "text-gray-400"
            } ${isOpen ? "transform rotate-180" : ""}`}
          />
        </button>
        {selectedItem?.hoverLabel ? (
          <div
            className={`pointer-events-none absolute left-0 top-full z-60 mt-1 hidden max-w-[320px] rounded px-2 py-1 text-xs shadow-lg group-hover:block ${
              isDark
                ? "bg-slate-900 text-slate-100 border border-slate-700"
                : "bg-gray-900 text-white"
            }`}
          >
            {selectedItem.hoverLabel}
          </div>
        ) : null}
      </div>

      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}

function SearchableSelectMenuBody({
  isDark,
  searchTerm,
  setSearchTerm,
  filteredOptions,
  showSubLabel,
  value,
  handleSelect,
  listClassName,
}: {
  isDark: boolean;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  filteredOptions: SearchableSelectInnerProps["options"];
  showSubLabel: boolean;
  value: string;
  handleSelect: (id: string) => void;
  listClassName: string;
}) {
  return (
    <>
      <div
        className={`shrink-0 p-2 border-b transition-colors ${
          isDark ? "border-slate-600" : "border-gray-200"
        }`}
      >
        <div className="relative">
          <Search
            className={`absolute left-2 top-2.5 w-4 h-4 ${
              isDark ? "text-slate-400" : "text-gray-400"
            }`}
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items..."
            className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
              isDark
                ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                : "border-gray-300"
            }`}
            autoFocus
          />
        </div>
      </div>
      <div className={listClassName}>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => !option.disabled && handleSelect(option.id)}
              disabled={option.disabled}
              title={option.hoverLabel}
              className={`group relative w-full px-2 py-2 text-left transition-colors flex justify-between items-center ${
                option.disabled || option.deprecated
                  ? isDark
                    ? "opacity-50 cursor-not-allowed text-slate-500"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                  : isDark
                    ? "hover:bg-slate-700 text-slate-100"
                    : "hover:bg-blue-50"
              } ${
                option.matchCandidate ? "border-l-2 border-amber-500" : ""
              } ${
                option.matchCandidate && value !== option.id
                  ? isDark
                    ? "bg-amber-900/25"
                    : "bg-amber-50"
                  : ""
              } ${
                value === option.id
                  ? isDark
                    ? "bg-slate-700"
                    : "bg-blue-100"
                  : ""
              }`}
            >
              <span className="flex items-center gap-1 min-w-0">
                {option.warningDot && (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isDark ? "bg-red-400" : "bg-red-600"
                    }`}
                    title="Needs specific weight for non-mass units"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 truncate">
                  {option.deprecated && "[Deprecated] "}
                  {option.name}
                </span>
                {showSubLabel && option.subLabel && (
                  <span
                    className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}
                  >
                    {option.subLabel}
                  </span>
                )}
              </span>
              {option.isUnused && (
                <span
                  className={`w-2 h-2 rounded-full ml-2 flex-shrink-0 ${
                    isDark ? "bg-red-500" : "bg-red-600"
                  }`}
                  title="No active vendor item is mapped to this base item"
                  aria-hidden
                />
              )}
              {option.hoverLabel ? (
                <span
                  className={`pointer-events-none absolute left-2 top-full z-60 mt-1 hidden max-w-[320px] rounded px-2 py-1 text-xs shadow-lg group-hover:block ${
                    isDark
                      ? "bg-slate-900 text-slate-100 border border-slate-700"
                      : "bg-gray-900 text-white"
                  }`}
                >
                  {option.hoverLabel}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <div
            className={`px-4 py-2 text-sm ${
              isDark ? "text-slate-400" : "text-gray-500"
            }`}
          >
            No items found
          </div>
        )}
      </div>
    </>
  );
}
