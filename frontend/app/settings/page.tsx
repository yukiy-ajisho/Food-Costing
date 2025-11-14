"use client";

import { useState } from "react";
import { Edit, Save, Plus, Trash2 } from "lucide-react";
import {
  UnitConversion,
  initialUnitConversions,
  LaborRole,
  initialLaborRoles,
} from "@/lib/mockData";

type TabType = "units" | "labor";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("units");
  const [unitConversions, setUnitConversions] = useState<UnitConversion[]>(
    initialUnitConversions
  );
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>(initialLaborRoles);
  const [isEditMode, setIsEditMode] = useState(false);

  // Editモード切り替え
  const handleEditClick = () => {
    setIsEditMode(true);
  };

  // Save処理
  const handleSaveClick = () => {
    if (activeTab === "units") {
      // Unit Conversionsの保存
      const filteredConversions = unitConversions.filter((conv) => {
        if (conv.isMarkedForDeletion) {
          return false;
        }
        if (conv.from_unit.trim() === "" && conv.multiplier_to_grams === 0) {
          return false;
        }
        return true;
      });
      const cleanedConversions = filteredConversions.map(
        ({ isMarkedForDeletion, ...conv }) => conv
      );
      setUnitConversions(cleanedConversions);
    } else {
      // Labor Rolesの保存
      const filteredRoles = laborRoles.filter((role) => {
        if (role.isMarkedForDeletion) {
          return false;
        }
        if (role.name.trim() === "" && role.hourly_wage === 0) {
          return false;
        }
        return true;
      });
      const cleanedRoles = filteredRoles.map(
        ({ isMarkedForDeletion, ...role }) => role
      );
      setLaborRoles(cleanedRoles);
    }
    setIsEditMode(false);
  };

  // Unit Conversion更新
  const handleConversionChange = (
    id: string,
    field: keyof UnitConversion,
    value: string | number | boolean
  ) => {
    setUnitConversions(
      unitConversions.map((conv) =>
        conv.id === id ? { ...conv, [field]: value } : conv
      )
    );
  };

  // Labor Role更新
  const handleLaborRoleChange = (
    id: string,
    field: keyof LaborRole,
    value: string | number
  ) => {
    setLaborRoles(
      laborRoles.map((role) =>
        role.id === id ? { ...role, [field]: value } : role
      )
    );
  };

  // Unit Conversion削除クリック
  const handleUnitConversionDeleteClick = (id: string) => {
    setUnitConversions(
      unitConversions.map((conv) =>
        conv.id === id
          ? { ...conv, isMarkedForDeletion: !conv.isMarkedForDeletion }
          : conv
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

  // Unit Conversion追加
  const handleAddUnitConversion = () => {
    const newConversion: UnitConversion = {
      id: `new-${Date.now()}`,
      from_unit: "",
      multiplier_to_grams: 0,
      is_mass_unit: true,
    };
    setUnitConversions([...unitConversions, newConversion]);
  };

  // Labor Role追加
  const handleAddLaborRole = () => {
    const newRole: LaborRole = {
      id: `new-${Date.now()}`,
      name: "",
      hourly_wage: 0,
    };
    setLaborRoles([...laborRoles, newRole]);
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダーとEdit/Saveボタン */}
        <div className="flex justify-end items-center mb-6">
          {isEditMode ? (
            <button
              onClick={handleSaveClick}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="w-5 h-5" />
              Save
            </button>
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

        {/* タブ */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab("units")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "units"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Unit Conversions
            </button>
            <button
              onClick={() => setActiveTab("labor")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "labor"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Labor Roles
            </button>
          </nav>
        </div>

        {/* Unit Conversionsセクション */}
        {activeTab === "units" && (
          <div className="mb-8">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      From Unit
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Multiplier (to grams)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Is Mass Unit
                    </th>
                    {isEditMode && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                        {/* ゴミ箱列のヘッダー */}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {unitConversions.map((conv) => (
                    <tr
                      key={conv.id}
                      className={`${
                        conv.isMarkedForDeletion ? "bg-red-50" : ""
                      } hover:bg-gray-50`}
                    >
                      {/* From Unit */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditMode ? (
                          <input
                            type="text"
                            value={conv.from_unit}
                            onChange={(e) =>
                              handleConversionChange(
                                conv.id,
                                "from_unit",
                                e.target.value
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Unit name (e.g., kg, lb)"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {conv.from_unit}
                          </div>
                        )}
                      </td>

                      {/* Multiplier */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditMode ? (
                          <input
                            type="number"
                            value={conv.multiplier_to_grams}
                            onChange={(e) =>
                              handleConversionChange(
                                conv.id,
                                "multiplier_to_grams",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                            min="0"
                            step="0.0001"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {conv.multiplier_to_grams}
                          </div>
                        )}
                      </td>

                      {/* Is Mass Unit */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditMode ? (
                          <input
                            type="checkbox"
                            checked={conv.is_mass_unit}
                            onChange={(e) =>
                              handleConversionChange(
                                conv.id,
                                "is_mass_unit",
                                e.target.checked
                              )
                            }
                            className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {conv.is_mass_unit ? "✓" : "✗"}
                          </div>
                        )}
                      </td>

                      {/* ゴミ箱（Editモード時のみ） */}
                      {isEditMode && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() =>
                              handleUnitConversionDeleteClick(conv.id)
                            }
                            className={`p-2 rounded-md transition-colors ${
                              conv.isMarkedForDeletion
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
                      <td colSpan={isEditMode ? 4 : 3} className="px-6 py-4">
                        <button
                          onClick={handleAddUnitConversion}
                          className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <Plus className="w-5 h-5" />
                          <span>Add new unit conversion</span>
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Labor Rolesセクション */}
        {activeTab === "labor" && (
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
                          <div className="text-sm text-gray-900">
                            {role.name}
                          </div>
                        )}
                      </td>

                      {/* Hourly Wage */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditMode ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500">$</span>
                            <input
                              type="number"
                              value={role.hourly_wage}
                              onChange={(e) =>
                                handleLaborRoleChange(
                                  role.id,
                                  "hourly_wage",
                                  parseFloat(e.target.value) || 0
                                )
                              }
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
        )}
      </div>
    </div>
  );
}
