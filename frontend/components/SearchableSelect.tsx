"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface SearchableSelectProps {
  options: {
    id: string;
    name: string;
    subLabel?: string;
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
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search and select...",
  disabled = false,
}: SearchableSelectProps) {
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

  // 選択されたアイテムの名前を取得
  const selectedItem = options.find((opt) => opt.id === value);

  const filteredOptions = options.filter((option) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    const hay = (option.searchText ?? option.name).toLowerCase();
    return hay.includes(q);
  });

  // メニューの位置を計算
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // 外側クリックで閉じる
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
      <div className="relative w-full" ref={dropdownRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
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
          <span className="flex items-center gap-1 overflow-hidden">
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
                <span className={isDark ? "text-slate-100" : "text-gray-900"}>
                  {selectedItem.name}
                </span>
                {selectedItem.subLabel && (
                  <span
                    className={`text-xs ${isDark ? "text-slate-400" : "text-gray-400"}`}
                    style={{ flexShrink: 0 }}
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
      </div>

      {isOpen && (
        <div
          ref={menuRef}
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
          <div
            className={`p-2 border-b transition-colors ${
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
          <div className="max-h-96 overflow-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => !option.disabled && handleSelect(option.id)}
                  disabled={option.disabled}
                  className={`w-full px-2 py-2 text-left transition-colors flex justify-between items-center ${
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
                    {option.subLabel && (
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
                    />
                  )}
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
        </div>
      )}
    </>
  );
}
