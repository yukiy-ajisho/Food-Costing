"use client";

import { useState, useEffect } from "react";
import { Edit, Save, X } from "lucide-react";
import {
  proceedValidationSettingsAPI,
  type ProceedValidationSettings,
} from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

export default function FoodCostingSettingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [proceedValidationSettings, setProceedValidationSettings] =
    useState<ProceedValidationSettings | null>(null);
  const [
    originalProceedValidationSettings,
    setOriginalProceedValidationSettings,
  ] = useState<ProceedValidationSettings | null>(null);
  const [isEditModeOverweight, setIsEditModeOverweight] = useState(false);
  const [loadingOverweight, setLoadingOverweight] = useState(false);
  const [hasLoadedOverweightOnce, setHasLoadedOverweightOnce] = useState(false);

  useEffect(() => {
    if (proceedValidationSettings !== null) {
      return;
    }

    const isFirstLoad = !hasLoadedOverweightOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingOverweight(true);
        }
        const settings = await proceedValidationSettingsAPI.get();
        setProceedValidationSettings(settings);
        setOriginalProceedValidationSettings(
          JSON.parse(JSON.stringify(settings)),
        );
        setHasLoadedOverweightOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
        } else {
          alert("Failed to fetch data");
        }
      } finally {
        setLoadingOverweight(false);
      }
    };

    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEditClickOverweight = () => {
    if (proceedValidationSettings) {
      setOriginalProceedValidationSettings(
        JSON.parse(JSON.stringify(proceedValidationSettings)),
      );
    }
    setIsEditModeOverweight(true);
  };

  const handleCancelClickOverweight = () => {
    if (originalProceedValidationSettings) {
      setProceedValidationSettings(
        JSON.parse(JSON.stringify(originalProceedValidationSettings)),
      );
    }
    setIsEditModeOverweight(false);
  };

  const handleSaveClickOverweight = async () => {
    try {
      setLoadingOverweight(true);

      if (!proceedValidationSettings) {
        alert("Settings not found");
        return;
      }

      await proceedValidationSettingsAPI.update({
        validation_mode: proceedValidationSettings.validation_mode,
      });

      const settings = await proceedValidationSettingsAPI.get();
      setProceedValidationSettings(settings);
      setOriginalProceedValidationSettings(
        JSON.parse(JSON.stringify(settings)),
      );
      setIsEditModeOverweight(false);
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to save: ${message}`);
    } finally {
      setLoadingOverweight(false);
    }
  };

  const handleValidationModeChange = (mode: "permit" | "block" | "notify") => {
    if (proceedValidationSettings) {
      setProceedValidationSettings({
        ...proceedValidationSettings,
        validation_mode: mode,
      });
    }
  };

  if (permissionDenied) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            You don&apos;t have permission.
          </div>
        </div>
      </div>
    );
  }

  if (loadingOverweight && !hasLoadedOverweightOnce) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="p-8 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_select:not(:disabled)]:cursor-pointer [&_[role=button]:not(:disabled)]:cursor-pointer"
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-end items-center mb-6 gap-2">
          {isEditModeOverweight ? (
            <>
              <button
                onClick={handleCancelClickOverweight}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  isDark
                    ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
              <button
                onClick={() => void handleSaveClickOverweight()}
                disabled={loadingOverweight}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-5 h-5" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={handleEditClickOverweight}
              className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors ${
                isDark
                  ? "bg-slate-600 hover:bg-slate-500"
                  : "bg-gray-600 hover:bg-gray-700"
              }`}
            >
              <Edit className="w-5 h-5" />
              Edit
            </button>
          )}
        </div>

        {loadingOverweight ? (
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200"
            }`}
          >
            Loading...
          </div>
        ) : (
          <div
            className={`rounded-lg shadow-sm border p-8 transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <h2
              className={`text-lg font-semibold mb-6 ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              Final Amount Validation Setting
            </h2>
            <div className="flex items-center justify-between">
              <p
                className={`text-sm ${
                  isDark ? "text-slate-400" : "text-gray-600"
                }`}
              >
                Allow <span className="font-bold">Final Amount</span> to exceed{" "}
                <span className="font-bold">total ingredient weight</span>
              </p>
              <div className="flex items-center gap-8 ml-8">
                <label
                  className={`flex items-center gap-2 cursor-pointer ${
                    isEditModeOverweight
                      ? ""
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="radio"
                    name="validation_mode"
                    value="permit"
                    checked={
                      proceedValidationSettings?.validation_mode === "permit"
                    }
                    onChange={() => handleValidationModeChange("permit")}
                    disabled={!isEditModeOverweight}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">Allow</span>
                </label>

                <label
                  className={`flex items-center gap-2 cursor-pointer ${
                    isEditModeOverweight
                      ? ""
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="radio"
                    name="validation_mode"
                    value="notify"
                    checked={
                      proceedValidationSettings?.validation_mode === "notify"
                    }
                    onChange={() => handleValidationModeChange("notify")}
                    disabled={!isEditModeOverweight}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">
                    Allowed with Notification
                  </span>
                </label>

                <label
                  className={`flex items-center gap-2 cursor-pointer ${
                    isEditModeOverweight
                      ? ""
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <input
                    type="radio"
                    name="validation_mode"
                    value="block"
                    checked={
                      proceedValidationSettings?.validation_mode === "block"
                    }
                    onChange={() => handleValidationModeChange("block")}
                    disabled={!isEditModeOverweight}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-medium">Not Allowed</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
