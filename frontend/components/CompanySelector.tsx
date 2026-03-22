"use client";

import { useCompany } from "@/contexts/CompanyContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Building2, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function CompanySelector() {
  const { selectedCompanyId, companies, setSelectedCompanyId, loading } =
    useCompany();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>;
  }

  if (companies.length === 0) {
    return null;
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);

  // 1社のみの場合は選択不要なので名前だけ表示
  if (companies.length === 1) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
          isDark ? "text-slate-300" : "text-gray-600"
        }`}
      >
        <Building2 className="w-4 h-4 shrink-0" />
        <span>{selectedCompany?.company_name ?? companies[0].company_name}</span>
      </div>
    );
  }

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
        <Building2 className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium">
          {selectedCompany?.company_name ?? "Select Company"}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-56 rounded-lg shadow-lg z-50 ${
            isDark
              ? "bg-slate-800 border border-slate-700"
              : "bg-white border border-gray-200"
          }`}
        >
          <div className="py-1">
            {companies.map((company) => (
              <button
                key={company.id}
                onClick={() => {
                  setSelectedCompanyId(company.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  company.id === selectedCompanyId
                    ? isDark
                      ? "bg-blue-900 text-blue-200"
                      : "bg-blue-50 text-blue-700"
                    : isDark
                    ? "text-slate-300 hover:bg-slate-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {company.company_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
