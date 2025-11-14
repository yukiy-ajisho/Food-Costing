"use client";

import { useState, Fragment } from "react";
import { Edit, Save, Plus, Trash2, AlertCircle } from "lucide-react";
import { initialUnitConversions } from "@/lib/mockData";

// Raw Itemの型定義
interface RawItem {
  id: string;
  name: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_cost: number;
  notes: string;
  grams_per_unit?: number; // item_unit_profiles用（非質量単位の場合）
  isMarkedForDeletion?: boolean;
}

// モックデータ
const initialItems: RawItem[] = [
  {
    id: "1",
    name: "Soy Sauce",
    purchase_unit: "kg",
    purchase_quantity: 10,
    purchase_cost: 40,
    notes: "",
  },
  {
    id: "2",
    name: "Sugar",
    purchase_unit: "kg",
    purchase_quantity: 5,
    purchase_cost: 10,
    notes: "",
  },
  {
    id: "3",
    name: "Chicken Thigh",
    purchase_unit: "kg",
    purchase_quantity: 20,
    purchase_cost: 60,
    notes: "",
  },
];

// Settingsの単位リストから単位オプションを取得
const unitOptions = initialUnitConversions.map((conv) => conv.from_unit);

// 非質量単位かどうかを判定（Settingsのis_mass_unitフラグを使用）
const isNonMassUnit = (unit: string): boolean => {
  const conversion = initialUnitConversions.find(
    (conv) => conv.from_unit === unit
  );
  return conversion ? !conversion.is_mass_unit : false;
};

export default function ItemsPage() {
  const [items, setItems] = useState<RawItem[]>(initialItems);
  const [isEditMode, setIsEditMode] = useState(false);

  // Editモード切り替え
  const handleEditClick = () => {
    setIsEditMode(true);
  };

  // Save処理
  const handleSaveClick = () => {
    // 削除予定のアイテムと空の新規レコードを削除
    const filteredItems = items.filter((item) => {
      // 削除予定マークがある場合は削除
      if (item.isMarkedForDeletion) {
        return false;
      }
      // 空の新規レコード（nameが空、quantityが0、costが0）も削除
      if (
        item.name.trim() === "" &&
        item.purchase_quantity === 0 &&
        item.purchase_cost === 0
      ) {
        return false;
      }
      return true;
    });
    // 削除予定フラグをクリア
    const cleanedItems = filteredItems.map(
      ({ isMarkedForDeletion, ...item }) => item
    );
    setItems(cleanedItems);
    setIsEditMode(false);
  };

  // アイテム更新
  const handleItemChange = (
    id: string,
    field: keyof RawItem,
    value: string | number
  ) => {
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // ゴミ箱クリック（削除予定マーク）
  const handleDeleteClick = (id: string) => {
    setItems(
      items.map((item) =>
        item.id === id
          ? { ...item, isMarkedForDeletion: !item.isMarkedForDeletion }
          : item
      )
    );
  };

  // プラスマーククリック（新しい空レコード追加）
  const handleAddClick = (insertAfterId: string) => {
    const newItem: RawItem = {
      id: `new-${Date.now()}`,
      name: "",
      purchase_unit: "kg",
      purchase_quantity: 0,
      purchase_cost: 0,
      notes: "",
    };

    const insertIndex = items.findIndex((item) => item.id === insertAfterId);
    const newItems = [...items];
    newItems.splice(insertIndex + 1, 0, newItem);
    setItems(newItems);
  };

  // 最後のアイテムのIDを取得（プラスマークの位置用）
  const getLastItemId = () => {
    return items.length > 0 ? items[items.length - 1].id : "";
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

        {/* テーブル */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Quantity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Notes
                </th>
                {isEditMode && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                    {/* ゴミ箱列のヘッダー */}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item, index) => (
                <Fragment key={item.id}>
                  <tr
                    className={`${
                      item.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50`}
                  >
                    {/* Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            handleItemChange(item.id, "name", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Item name"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">{item.name}</div>
                      )}
                    </td>

                    {/* Unit */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <select
                          value={item.purchase_unit}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              "purchase_unit",
                              e.target.value
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {unitOptions.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.purchase_unit}
                        </div>
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <input
                          type="number"
                          value={item.purchase_quantity}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              "purchase_quantity",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                          min="0"
                          step="0.01"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.purchase_quantity}
                        </div>
                      )}
                    </td>

                    {/* Cost */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500">$</span>
                          <input
                            type="number"
                            value={item.purchase_cost}
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                "purchase_cost",
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
                          ${item.purchase_cost.toFixed(2)}
                        </div>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-6 py-4">
                      {isEditMode ? (
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) =>
                            handleItemChange(item.id, "notes", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Optional notes"
                        />
                      ) : (
                        <div className="text-sm text-gray-500">
                          {item.notes || "-"}
                        </div>
                      )}
                    </td>

                    {/* ゴミ箱（Editモード時のみ） */}
                    {isEditMode && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteClick(item.id)}
                          className={`p-2 rounded-md transition-colors ${
                            item.isMarkedForDeletion
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

                  {/* 非質量単位の場合、変換入力行を表示（Editモード時のみ） */}
                  {isEditMode && isNonMassUnit(item.purchase_unit) && (
                    <tr className="bg-yellow-50">
                      <td colSpan={isEditMode ? 6 : 5} className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-yellow-600" />
                          <span className="text-sm text-gray-700">
                            {item.purchase_unit} →
                          </span>
                          <input
                            type="number"
                            value={item.grams_per_unit || ""}
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                "grams_per_unit",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="grams"
                            min="0"
                            step="0.01"
                          />
                          <span className="text-sm text-gray-700">g</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {/* プラスマーク行（Editモード時のみ、最後の行の下） */}
              {isEditMode && (
                <tr>
                  <td colSpan={isEditMode ? 6 : 5} className="px-6 py-4">
                    <button
                      onClick={() => handleAddClick(getLastItemId())}
                      className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      <span>Add new item</span>
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
