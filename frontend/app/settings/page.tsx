"use client";

import { useState, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import {
  laborRolesAPI,
  proceedValidationSettingsAPI,
  saveChangeHistory,
  type LaborRole,
  type ProceedValidationSettings,
} from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

type TabType = "labor" | "overweight";

// UI用の型（isMarkedForDeletionを追加）
interface LaborRoleUI extends LaborRole {
  isMarkedForDeletion?: boolean;
}

export default function SettingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState<TabType>("labor");

  // Laborタブ用のstate
  const [laborRoles, setLaborRoles] = useState<LaborRoleUI[]>([]);
  const [originalLaborRoles, setOriginalLaborRoles] = useState<LaborRoleUI[]>(
    []
  );
  const [isEditModeLabor, setIsEditModeLabor] = useState(false);
  const [loadingLabor, setLoadingLabor] = useState(false);
  const [hasLoadedLaborOnce, setHasLoadedLaborOnce] = useState(false);
  // hourly_wage入力用の文字列状態を保持（role.idをキーとする）
  const [hourlyWageInputs, setHourlyWageInputs] = useState<Map<string, string>>(
    new Map()
  );

  // Overweightタブ用のstate
  const [proceedValidationSettings, setProceedValidationSettings] =
    useState<ProceedValidationSettings | null>(null);
  const [
    originalProceedValidationSettings,
    setOriginalProceedValidationSettings,
  ] = useState<ProceedValidationSettings | null>(null);
  const [isEditModeOverweight, setIsEditModeOverweight] = useState(false);
  const [loadingOverweight, setLoadingOverweight] = useState(false);
  const [hasLoadedOverweightOnce, setHasLoadedOverweightOnce] = useState(false);

  // =========================================================
  // Laborタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "labor") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (laborRoles.length > 0) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedLaborOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingLabor(true);
        }
        const roles = await laborRolesAPI.getAll();
        setLaborRoles(roles);
        setOriginalLaborRoles(JSON.parse(JSON.stringify(roles)));
        setHasLoadedLaborOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("Failed to fetch data");
      } finally {
        setLoadingLabor(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // =========================================================
  // Overweightタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "overweight") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (proceedValidationSettings !== null) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedOverweightOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingOverweight(true);
        }
        const settings = await proceedValidationSettingsAPI.get();
        setProceedValidationSettings(settings);
        setOriginalProceedValidationSettings(
          JSON.parse(JSON.stringify(settings))
        );
        setHasLoadedOverweightOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("Failed to fetch data");
      } finally {
        setLoadingOverweight(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // =========================================================
  // Laborタブのハンドラー
  // =========================================================
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

      // 削除予定のアイテムと空の新規レコードをフィルター
      const filteredRoles = laborRoles.filter((role) => {
        if (role.isMarkedForDeletion) return false;
        if (role.name.trim() === "" && role.hourly_wage === 0) return false;
        return true;
      });

      // 変更されたlabor_roleのnameを追跡
      const changedLaborRoleNames: string[] = [];

      // API呼び出し
      for (const role of filteredRoles) {
        if (role.id.startsWith("new-")) {
          // 新規作成
          const newRole = await laborRolesAPI.create({
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
          changedLaborRoleNames.push(newRole.name);
        } else {
          // 更新
          await laborRolesAPI.update(role.id, {
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
          changedLaborRoleNames.push(role.name);
        }
      }

      // 削除処理
      for (const role of laborRoles) {
        if (role.isMarkedForDeletion && !role.id.startsWith("new-")) {
          await laborRolesAPI.delete(role.id);
          // 削除されたroleのnameを取得（元のデータから）
          const originalRole = originalLaborRoles.find((r) => r.id === role.id);
          if (originalRole) {
            changedLaborRoleNames.push(originalRole.name);
          }
        }
      }

      // 変更履歴をlocalStorageに保存
      if (changedLaborRoleNames.length > 0) {
        saveChangeHistory({
          changed_labor_role_names: changedLaborRoleNames,
        });
      }

      // データを再取得
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
    value: string | number
  ) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id ? { ...role, [field]: value } : role
      )
    );
  };

  const handleLaborRoleDeleteClick = (id: string) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id
          ? { ...role, isMarkedForDeletion: !role.isMarkedForDeletion }
          : role
      )
    );
  };

  const handleAddLaborRole = () => {
    const newRole: LaborRoleUI = {
      id: `new-${Date.now()}`,
      name: "",
      hourly_wage: 0,
      user_id: "", // 一時的な値（保存時にバックエンドで自動設定される）
    };
    setLaborRoles([...laborRoles, newRole]);
  };

  // =========================================================
  // Overweightタブのハンドラー
  // =========================================================
  const handleEditClickOverweight = () => {
    if (proceedValidationSettings) {
      setOriginalProceedValidationSettings(
        JSON.parse(JSON.stringify(proceedValidationSettings))
      );
    }
    setIsEditModeOverweight(true);
  };

  const handleCancelClickOverweight = () => {
    if (originalProceedValidationSettings) {
      setProceedValidationSettings(
        JSON.parse(JSON.stringify(originalProceedValidationSettings))
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

      // データを再取得
      const settings = await proceedValidationSettingsAPI.get();
      setProceedValidationSettings(settings);
      setOriginalProceedValidationSettings(
        JSON.parse(JSON.stringify(settings))
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

  // =========================================================
  // レンダリング
  // =========================================================
  // 現在のタブのEditモード
  const isEditMode =
    (activeTab === "labor" && isEditModeLabor) ||
    (activeTab === "overweight" && isEditModeOverweight);

  // Edit/Save/Cancelボタンのハンドラー
  const handleEditClick = () => {
    if (activeTab === "labor") handleEditClickLabor();
    else if (activeTab === "overweight") handleEditClickOverweight();
  };

  const handleCancelClick = () => {
    if (activeTab === "labor") handleCancelClickLabor();
    else if (activeTab === "overweight") handleCancelClickOverweight();
  };

  const handleSaveClick = () => {
    if (activeTab === "labor") handleSaveClickLabor();
    else if (activeTab === "overweight") handleSaveClickOverweight();
  };

  // ローディング状態
  const loading =
    (activeTab === "labor" && loadingLabor) ||
    (activeTab === "overweight" && loadingOverweight);

  if (loading && !hasLoadedLaborOnce && !hasLoadedOverweightOnce) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* タブ */}
        <div
          className={`mb-6 border-b transition-colors ${
            isDark ? "border-slate-700" : "border-gray-200"
          }`}
        >
          <nav className="flex space-x-8">
            <button
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
            <button
              onClick={() => setActiveTab("overweight")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "overweight"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Recipe Settings
            </button>
          </nav>
        </div>

        {/* ヘッダーとEdit/Save/Cancelボタン */}
        <div className="flex justify-end items-center mb-6 gap-2">
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelClick}
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
                onClick={handleSaveClick}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Save className="w-5 h-5" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={handleEditClick}
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

        {/* Laborタブ */}
        {activeTab === "labor" && (
          <>
            {loadingLabor ? (
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
                        >
                          {/* ゴミ箱列のヘッダー */}
                        </th>
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
                        } ${
                          isDark ? "hover:bg-slate-700" : "hover:bg-gray-50"
                        }`}
                        style={{
                          height: "52px",
                          minHeight: "52px",
                          maxHeight: "52px",
                        }}
                      >
                        {/* Name */}
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
                                    e.target.value
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

                        {/* Hourly Wage */}
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
                                    // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                    if (numericPattern.test(value)) {
                                      setHourlyWageInputs((prev) => {
                                        const newMap = new Map(prev);
                                        newMap.set(role.id, value);
                                        return newMap;
                                      });
                                    }
                                    // マッチしない場合は何もしない（前の値を保持）
                                  }}
                                  onBlur={(e) => {
                                    const value = e.target.value;
                                    // フォーカスアウト時に数値に変換
                                    const numValue =
                                      value === "" || value === "."
                                        ? 0
                                        : parseFloat(value) || 0;
                                    handleLaborRoleChange(
                                      role.id,
                                      "hourly_wage",
                                      numValue
                                    );
                                    // 入力状態をクリア（次回表示時は実際の値から取得）
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

                        {/* ゴミ箱（Editモード時のみ） */}
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

                    {/* プラスマーク行（Editモード時のみ、最後の行の下） */}
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
            )}
          </>
        )}

        {/* Overweightタブ */}
        {activeTab === "overweight" && (
          <>
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
                    Allow <span className="font-bold">Final Amount</span> to
                    exceed{" "}
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
                          proceedValidationSettings?.validation_mode ===
                          "permit"
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
                          proceedValidationSettings?.validation_mode ===
                          "notify"
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
          </>
        )}
      </div>
    </div>
  );
}
