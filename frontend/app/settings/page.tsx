"use client";

import { useState, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import { laborRolesAPI, type LaborRole } from "@/lib/api";

// UI用の型（isMarkedForDeletionを追加）
interface LaborRoleUI extends LaborRole {
  isMarkedForDeletion?: boolean;
}

export default function SettingsPage() {
  // const [activeTab, setActiveTab] = useState<TabType>("labor"); // 未使用のためコメントアウト
  const [laborRoles, setLaborRoles] = useState<LaborRoleUI[]>([]);
  const [originalLaborRoles, setOriginalLaborRoles] = useState<LaborRoleUI[]>(
    []
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [loading, setLoading] = useState(true);

  // データ取得
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const roles = await laborRolesAPI.getAll();
        setLaborRoles(roles);
        setOriginalLaborRoles(JSON.parse(JSON.stringify(roles)));
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Editモード切り替え
  const handleEditClick = () => {
    // 現在の状態を保存
    setOriginalLaborRoles(JSON.parse(JSON.stringify(laborRoles)));
    setIsEditMode(true);
  };

  // Cancel処理
  const handleCancelClick = () => {
    // 元の状態に戻す
    setLaborRoles(JSON.parse(JSON.stringify(originalLaborRoles)));
    setIsEditMode(false);
  };

  // Save処理
  const handleSaveClick = async () => {
    try {
      setLoading(true);

      // 削除予定のアイテムと空の新規レコードをフィルター
      const filteredRoles = laborRoles.filter((role) => {
        if (role.isMarkedForDeletion) return false;
        if (role.name.trim() === "" && role.hourly_wage === 0) return false;
        return true;
      });

      // API呼び出し
      for (const role of filteredRoles) {
        if (role.id.startsWith("new-")) {
          // 新規作成
          await laborRolesAPI.create({
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
        } else {
          // 更新
          await laborRolesAPI.update(role.id, {
            name: role.name,
            hourly_wage: role.hourly_wage,
          });
        }
      }

      // 削除処理
      for (const role of laborRoles) {
        if (role.isMarkedForDeletion && !role.id.startsWith("new-")) {
          await laborRolesAPI.delete(role.id);
        }
      }

      // データを再取得
      const roles = await laborRolesAPI.getAll();
      setLaborRoles(roles);
      setOriginalLaborRoles(JSON.parse(JSON.stringify(roles)));
      setIsEditMode(false);
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message =
        error instanceof Error ? error.message : String(error);
      alert(`保存に失敗しました: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // Labor Role更新
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

  // Labor Role削除クリック
  const handleLaborRoleDeleteClick = (id: string) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id
          ? { ...role, isMarkedForDeletion: !role.isMarkedForDeletion }
          : role
      )
    );
  };

  // Labor Role追加
  const handleAddLaborRole = () => {
    const newRole: LaborRoleUI = {
      id: `new-${Date.now()}`,
      name: "",
      hourly_wage: 0,
    };
    setLaborRoles([...laborRoles, newRole]);
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダーとEdit/Save/Cancelボタン */}
        <div className="flex justify-end items-center mb-6 gap-2">
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelClick}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
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
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <Edit className="w-5 h-5" />
              Edit
            </button>
          )}
        </div>

        {/* Labor Rolesセクション */}
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Hourly Wage ($)
                  </th>
                  {isEditMode && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      {/* ゴミ箱列のヘッダー */}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {laborRoles.map((role) => (
                  <tr
                    key={role.id}
                    className={`${
                      role.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50`}
                  >
                    {/* Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Role name (e.g., Prep Cook)"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">{role.name}</div>
                      )}
                    </td>

                    {/* Hourly Wage */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500">$</span>
                          <input
                            type="number"
                            value={
                              role.hourly_wage === 0
                                ? ""
                                : role.hourly_wage || ""
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              // 空文字列の場合は0、それ以外は数値に変換
                              const numValue =
                                value === "" ? 0 : parseFloat(value) || 0;
                              handleLaborRoleChange(
                                role.id,
                                "hourly_wage",
                                numValue
                              );
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                          />
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          ${role.hourly_wage.toFixed(2)}
                        </div>
                      )}
                    </td>

                    {/* ゴミ箱（Editモード時のみ） */}
                    {isEditMode && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleLaborRoleDeleteClick(role.id)}
                          className={`p-2 rounded-md transition-colors ${
                            role.isMarkedForDeletion
                              ? "bg-red-500 text-white hover:bg-red-600"
                              : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                          }`}
                          title="Mark for deletion"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {/* プラスマーク行（Editモード時のみ、最後の行の下） */}
                {isEditMode && (
                  <tr>
                    <td colSpan={isEditMode ? 3 : 2} className="px-6 py-4">
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
        </div>
      </div>
    </div>
  );
}
