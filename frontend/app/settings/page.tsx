"use client";

import { useState } from "react";
import { Edit, Save, Plus, Trash2 } from "lucide-react";

// Unit Conversionの型定義
interface UnitConversion {
  id: string;
  from_unit: string;
  multiplier_to_grams: number;
  isMarkedForDeletion?: boolean;
}

// モックデータ
const initialUnitConversions: UnitConversion[] = [
  {
    id: "1",
    from_unit: "g",
    multiplier_to_grams: 1,
  },
  {
    id: "2",
    from_unit: "kg",
    multiplier_to_grams: 1000,
  },
  {
    id: "3",
    from_unit: "lb",
    multiplier_to_grams: 453.592,
  },
  {
    id: "4",
    from_unit: "oz",
    multiplier_to_grams: 28.3495,
  },
];

export default function SettingsPage() {
  const [unitConversions, setUnitConversions] = useState<UnitConversion[]>(
    initialUnitConversions
  );
  const [isEditMode, setIsEditMode] = useState(false);

  // Editモード切り替え
  const handleEditClick = () => {
    setIsEditMode(true);
  };

  // Save処理
  const handleSaveClick = () => {
    // 削除予定のアイテムと空の新規レコードを削除
    const filteredConversions = unitConversions.filter((conv) => {
      // 削除予定マークがある場合は削除
      if (conv.isMarkedForDeletion) {
        return false;
      }
      // 空の新規レコード（from_unitが空、multiplierが0）も削除
      if (conv.from_unit.trim() === "" && conv.multiplier_to_grams === 0) {
        return false;
      }
      return true;
    });
    // 削除予定フラグをクリア
    const cleanedConversions = filteredConversions.map(
      ({ isMarkedForDeletion, ...conv }) => conv
    );
    setUnitConversions(cleanedConversions);
    setIsEditMode(false);
  };

  // 変換ルール更新
  const handleConversionChange = (
    id: string,
    field: keyof UnitConversion,
    value: string | number
  ) => {
    setUnitConversions(
      unitConversions.map((conv) =>
        conv.id === id ? { ...conv, [field]: value } : conv
      )
    );
  };

  // ゴミ箱クリック（削除予定マーク）
  const handleDeleteClick = (id: string) => {
    setUnitConversions(
      unitConversions.map((conv) =>
        conv.id === id
          ? { ...conv, isMarkedForDeletion: !conv.isMarkedForDeletion }
          : conv
      )
    );
  };

  // プラスマーククリック（新しい空レコード追加）
  const handleAddClick = () => {
    const newConversion: UnitConversion = {
      id: `new-${Date.now()}`,
      from_unit: "",
      multiplier_to_grams: 0,
    };

    setUnitConversions([...unitConversions, newConversion]);
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダーとEdit/Saveボタン */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">Settings</h2>
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

        {/* Unit Conversionsセクション */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">
            Unit Conversions
          </h3>
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

                    {/* ゴミ箱（Editモード時のみ） */}
                    {isEditMode && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteClick(conv.id)}
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
                    <td colSpan={isEditMode ? 3 : 2} className="px-6 py-4">
                      <button
                        onClick={handleAddClick}
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
      </div>
    </div>
  );
}
