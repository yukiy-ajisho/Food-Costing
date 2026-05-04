"use client";

import { useState, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import {
  laborRolesAPI,
  saveChangeHistory,
  type LaborRole,
} from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";

interface LaborRoleUI extends LaborRole {
  isMarkedForDeletion?: boolean;
}

/** 将来タブ追加用（現状は Labor のみ） */
type TabType = "labor";

export default function LaborPage() {
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState<TabType>("labor");
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [laborRoles, setLaborRoles] = useState<LaborRoleUI[]>([]);
  const [originalLaborRoles, setOriginalLaborRoles] = useState<LaborRoleUI[]>(
    [],
  );
  const [isEditModeLabor, setIsEditModeLabor] = useState(false);
  const [loadingLabor, setLoadingLabor] = useState(false);
  const [hasLoadedLaborOnce, setHasLoadedLaborOnce] = useState(false);
  const [hourlyWageInputs, setHourlyWageInputs] = useState<Map<string, string>>(
    new Map(),
  );

  useEffect(() => {
    if (!selectedTenantId) return;

    setLaborRoles([]);
    setOriginalLaborRoles([]);
    setHasLoadedLaborOnce(false);
    setPermissionDenied(false);
    setIsEditModeLabor(false);
    setHourlyWageInputs(new Map());

    let cancelled = false;
    setLoadingLabor(true);

    const fetchData = async () => {
      try {
        const roles = await laborRolesAPI.getAll();
        if (cancelled) return;
        setLaborRoles(roles);
        setOriginalLaborRoles(JSON.parse(JSON.stringify(roles)));
        setHasLoadedLaborOnce(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch data:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
        } else {
          alert("Failed to fetch data");
        }
      } finally {
        if (!cancelled) setLoadingLabor(false);
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  const handleEditClickLabor = () => {
    setOriginalLaborRoles(JSON.parse(JSON.stringify(laborRoles)));
    setIsEditModeLabor(true);
  };

  const handleCancelClickLabor = () => {
    setLaborRoles(JSON.parse(JSON.stringify(originalLaborRoles)));
    setIsEditModeLabor(false);
  };

  const handleSaveClickLabor = async () => {
    try {
      setLoadingLabor(true);

      const filteredRoles = laborRoles.filter((role) => {
        if (role.isMarkedForDeletion) return false;
        if (role.name.trim() === "" && role.hourly_wage === 0) return false;
        return true;
      });

      const changedLaborRoleNames: string[] = [];

      for (const role of filteredRoles) {
        if (role.id.startsWith("new-")) {
          const newRole = await laborRolesAPI.create({
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
          changedLaborRoleNames.push(newRole.name);
        } else {
          await laborRolesAPI.update(role.id, {
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
          changedLaborRoleNames.push(role.name);
        }
      }

      for (const role of laborRoles) {
        if (role.isMarkedForDeletion && !role.id.startsWith("new-")) {
          await laborRolesAPI.delete(role.id);
          const originalRole = originalLaborRoles.find((r) => r.id === role.id);
          if (originalRole) {
            changedLaborRoleNames.push(originalRole.name);
          }
        }
      }

      if (changedLaborRoleNames.length > 0) {
        saveChangeHistory({
          changed_labor_role_names: changedLaborRoleNames,
        });
      }

      const roles = await laborRolesAPI.getAll();
      setLaborRoles(roles);
      setOriginalLaborRoles(JSON.parse(JSON.stringify(roles)));
      setIsEditModeLabor(false);
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to save: ${message}`);
    } finally {
      setLoadingLabor(false);
    }
  };

  const handleLaborRoleChange = (
    id: string,
    field: keyof LaborRoleUI,
    value: string | number,
  ) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id ? { ...role, [field]: value } : role,
      ),
    );
  };

  const handleLaborRoleDeleteClick = (id: string) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id
          ? { ...role, isMarkedForDeletion: !role.isMarkedForDeletion }
          : role,
      ),
    );
  };

  const handleAddLaborRole = () => {
    const newRole: LaborRoleUI = {
      id: `new-${Date.now()}`,
      name: "",
      hourly_wage: 0,
      user_id: "",
    };
    setLaborRoles([...laborRoles, newRole]);
  };

  if (!selectedTenantId) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">Loading...</div>
      </div>
    );
  }

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

  if (loadingLabor && !hasLoadedLaborOnce) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* タブ（現状 Labor のみ。追加時は TabType とボタンを拡張） */}
        <div
          className={`mb-6 border-b transition-colors ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          <nav className="flex space-x-8">
            <button
              type="button"
              onClick={() => setActiveTab("labor")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "labor"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Labor
            </button>
          </nav>
        </div>

        <div className="flex justify-end items-center mb-6 gap-2">
          {isEditModeLabor ? (
            <>
              <button
                onClick={handleCancelClickLabor}
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
                onClick={() => void handleSaveClickLabor()}
                disabled={loadingLabor}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-5 h-5" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={handleEditClickLabor}
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

        {activeTab === "labor" && loadingLabor ? (
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200"
            }`}
          >
            Loading...
          </div>
        ) : activeTab === "labor" ? (
          <div
            className={`rounded-lg shadow-sm border overflow-hidden transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <table
              className="w-full"
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <thead
                className={`border-b transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <tr>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "60%" }}
                  >
                    Name
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "40%" }}
                  >
                    Hourly Wage ($)
                  </th>
                  {isEditModeLabor && (
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider w-16 ${
                        isDark ? "text-slate-300" : "text-gray-500"
                      }`}
                    />
                  )}
                </tr>
              </thead>
              <tbody
                className={`divide-y transition-colors ${
                  isDark ? "divide-slate-700" : "divide-gray-200"
                }`}
              >
                {laborRoles.map((role) => (
                  <tr
                    key={role.id}
                    className={`transition-colors ${
                      role.isMarkedForDeletion
                        ? isDark
                          ? "bg-red-900/30"
                          : "bg-red-50"
                        : ""
                    } ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"}`}
                    style={{
                      height: "52px",
                      minHeight: "52px",
                      maxHeight: "52px",
                    }}
                  >
                    <td
                      className="px-6 whitespace-nowrap"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        style={{
                          height: "20px",
                          minHeight: "20px",
                          maxHeight: "20px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {isEditModeLabor ? (
                          <input
                            type="text"
                            value={role.name}
                            onChange={(e) =>
                              handleLaborRoleChange(
                                role.id,
                                "name",
                                e.target.value,
                              )
                            }
                            className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                              isDark
                                ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                : "border-gray-300"
                            }`}
                            placeholder="Role name (e.g., Prep Cook)"
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
                          />
                        ) : (
                          <div
                            className={`text-sm ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                            style={{ height: "20px", lineHeight: "20px" }}
                          >
                            {role.name}
                          </div>
                        )}
                      </div>
                    </td>

                    <td
                      className="px-6 whitespace-nowrap"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        style={{
                          height: "20px",
                          minHeight: "20px",
                          maxHeight: "20px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {isEditModeLabor ? (
                          <div
                            className="flex items-center gap-1"
                            style={{ height: "20px" }}
                          >
                            <span
                              className="text-gray-500"
                              style={{ lineHeight: "20px" }}
                            >
                              $
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                hourlyWageInputs.has(role.id)
                                  ? hourlyWageInputs.get(role.id) || ""
                                  : role.hourly_wage === 0
                                    ? ""
                                    : String(role.hourly_wage)
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                const numericPattern =
                                  /^(\d+\.?\d*|\.\d+)?$/;
                                if (numericPattern.test(value)) {
                                  setHourlyWageInputs((prev) => {
                                    const newMap = new Map(prev);
                                    newMap.set(role.id, value);
                                    return newMap;
                                  });
                                }
                              }}
                              onBlur={(e) => {
                                const value = e.target.value;
                                const numValue =
                                  value === "" || value === "."
                                    ? 0
                                    : parseFloat(value) || 0;
                                handleLaborRoleChange(
                                  role.id,
                                  "hourly_wage",
                                  numValue,
                                );
                                setHourlyWageInputs((prev) => {
                                  const newMap = new Map(prev);
                                  newMap.delete(role.id);
                                  return newMap;
                                });
                              }}
                              className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                  : "border-gray-300"
                              }`}
                              placeholder="0.00"
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
                            />
                          </div>
                        ) : (
                          <div
                            className={`text-sm ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                            style={{ height: "20px", lineHeight: "20px" }}
                          >
                            ${role.hourly_wage.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </td>

                    <td
                      className="px-6 whitespace-nowrap"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      {isEditModeLabor && (
                        <button
                          type="button"
                          onClick={() =>
                            handleLaborRoleDeleteClick(role.id)
                          }
                          className={`p-2 rounded-md transition-colors ${
                            role.isMarkedForDeletion
                              ? "bg-red-500 text-white hover:bg-red-600"
                              : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                          }`}
                          style={{
                            height: "20px",
                            minHeight: "20px",
                            maxHeight: "20px",
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0",
                          }}
                          title="Mark for deletion"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {isEditModeLabor && (
                  <tr>
                    <td
                      colSpan={isEditModeLabor ? 3 : 2}
                      className="px-6"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleAddLaborRole}
                        className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        <span>Add new labor role</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
