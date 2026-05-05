"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

const SIDEBAR_ALERTS_ENABLED_KEY = "food_costing_sidebar_alerts_enabled";

export default function SettingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_ALERTS_ENABLED_KEY);
      setAlertsEnabled(raw !== "false");
    } catch {
      setAlertsEnabled(true);
    }
  }, []);

  const toggleAlerts = () => {
    const next = !alertsEnabled;
    setAlertsEnabled(next);
    try {
      localStorage.setItem(SIDEBAR_ALERTS_ENABLED_KEY, next ? "true" : "false");
      window.dispatchEvent(new Event("sidebar-alert-settings-changed"));
    } catch {
      // noop
    }
  };

  return (
    <div className="px-8 pt-8 pb-8 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-2xl space-y-6">
          <h1
            className={`text-2xl font-semibold ${isDark ? "text-slate-100" : "text-gray-900"}`}
          >
            Sidebar Settings
          </h1>
          <div
            className={`rounded-xl border p-5 ${
              isDark ? "border-slate-600 bg-slate-800" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p
                  className={`text-sm font-medium ${isDark ? "text-slate-100" : "text-gray-900"}`}
                >
                  Show alert badges on sidebar
                </p>
                <p
                  className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}
                >
                  Controls red dots/badges for Uploaded Document Box and License
                  sections.
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAlerts}
                className={`inline-flex h-7 w-14 items-center rounded-full p-1 transition-colors ${
                  alertsEnabled
                    ? "bg-green-500"
                    : isDark
                      ? "bg-slate-600"
                      : "bg-gray-300"
                }`}
                aria-pressed={alertsEnabled}
                aria-label="Toggle sidebar alert badges"
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    alertsEnabled ? "translate-x-7" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
