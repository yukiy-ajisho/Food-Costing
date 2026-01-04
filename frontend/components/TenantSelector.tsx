"use client";

import { useTenant } from "@/contexts/TenantContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function TenantSelector() {
  const { selectedTenantId, tenants, setSelectedTenantId, loading } =
    useTenant();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // クリックアウトサイドで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId);

  if (loading) {
    return <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>;
  }

  if (tenants.length === 0) {
    // デバッグ用: テナントが取得できていない場合
    console.warn("TenantSelector: No tenants found");
    return null;
  }

  // テナントが1つだけの場合でも表示する（ユーザー要求に基づく）
  // if (tenants.length === 1) {
  //   return null;
  // }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
          isDark
            ? "bg-slate-700 hover:bg-slate-600 text-slate-200"
            : "bg-gray-100 hover:bg-gray-200 text-gray-700"
        }`}
      >
        <span className="text-sm font-medium">
          {selectedTenant?.name || "Select Tenant"}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg z-50 ${
            isDark
              ? "bg-slate-800 border border-slate-700"
              : "bg-white border border-gray-200"
          }`}
        >
          <div className="py-1">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => {
                  setSelectedTenantId(tenant.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  tenant.id === selectedTenantId
                    ? isDark
                      ? "bg-blue-900 text-blue-200"
                      : "bg-blue-50 text-blue-700"
                    : isDark
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tenant.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
