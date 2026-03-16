"use client";

import { useTheme } from "@/contexts/ThemeContext";

export default function CompanyRequirementsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        <h2
          className={`text-xl font-semibold transition-colors ${
            isDark ? "text-slate-200" : "text-gray-900"
          }`}
        >
          Company Requirements
        </h2>
        <p
          className={`mt-2 text-sm ${isDark ? "text-slate-400" : "text-gray-600"}`}
        >
          (Coming soon)
        </p>
      </div>
    </div>
  );
}
