"use client";

import { useState, Fragment } from "react";
import {
  Edit,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";

// Recipe Lineの型定義
interface RecipeLine {
  id: string;
  line_type: "ingredient" | "labor";
  child_item_id?: string; // ingredient only
  quantity?: number; // ingredient only
  unit?: string; // ingredient only
  labor_role?: string; // labor only
  minutes?: number; // labor only
  isMarkedForDeletion?: boolean;
}

// Prepped/Menu Itemの型定義
interface PreppedItem {
  id: string;
  name: string;
  item_kind: "prepped";
  is_menu_item: boolean;
  yield_amount: number;
  yield_unit: string;
  recipe_lines: RecipeLine[];
  notes: string;
  isExpanded?: boolean;
  isMarkedForDeletion?: boolean;
}

// モックデータ（Itemsページで設定されたアイテム）
const availableItems = [
  { id: "1", name: "Soy Sauce" },
  { id: "2", name: "Sugar" },
  { id: "3", name: "Chicken Thigh" },
];

// モックデータ（Labor Roles - Settingsで設定される）
const laborRoles = [
  { id: "1", name: "Prep Cook", hourly_wage: 20 },
  { id: "2", name: "Line Cook", hourly_wage: 25 },
  { id: "3", name: "Chef", hourly_wage: 30 },
];

// 単位のオプション
const unitOptions = [
  "g",
  "kg",
  "lb",
  "oz",
  "gallon",
  "liter",
  "cup",
  "tablespoon",
  "each",
];

// 初期データ
const initialItems: PreppedItem[] = [
  {
    id: "1",
    name: "Teriyaki Sauce",
    item_kind: "prepped",
    is_menu_item: false,
    yield_amount: 8000,
    yield_unit: "g",
    recipe_lines: [
      {
        id: "rl1",
        line_type: "ingredient",
        child_item_id: "1",
        quantity: 5,
        unit: "kg",
      },
      {
        id: "rl2",
        line_type: "ingredient",
        child_item_id: "2",
        quantity: 1,
        unit: "kg",
      },
      {
        id: "rl3",
        line_type: "labor",
        labor_role: "1",
        minutes: 20,
      },
    ],
    notes: "",
    isExpanded: false,
  },
];

export default function CostPage() {
  const [items, setItems] = useState<PreppedItem[]>(initialItems);
  const [isEditMode, setIsEditMode] = useState(false);

  // Editモード切り替え
  const handleEditClick = () => {
    setIsEditMode(true);
  };

  // Save処理
  const handleSaveClick = () => {
    // 削除予定のアイテムと空の新規レコードを削除
    const filteredItems = items
      .filter((item) => {
        if (item.isMarkedForDeletion) return false;
        // 空の新規レコード（nameが空、yield_amountが0）も削除
        if (item.name.trim() === "" && item.yield_amount === 0) {
          return false;
        }
        return true;
      })
      .map((item) => {
        // レシピラインから削除予定と空のレコードを削除
        const filteredRecipeLines = item.recipe_lines.filter((line) => {
          if (line.isMarkedForDeletion) return false;
          if (line.line_type === "ingredient") {
            if (
              !line.child_item_id &&
              (!line.quantity || line.quantity === 0)
            ) {
              return false;
            }
          } else if (line.line_type === "labor") {
            if (!line.labor_role && (!line.minutes || line.minutes === 0)) {
              return false;
            }
          }
          return true;
        });

        return {
          ...item,
          recipe_lines: filteredRecipeLines.map(
            ({ isMarkedForDeletion, ...line }) => line
          ),
          isMarkedForDeletion: undefined,
        };
      });

    setItems(filteredItems);
    setIsEditMode(false);
  };

  // アイテムの展開/折りたたみ
  const toggleExpand = (id: string) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, isExpanded: !item.isExpanded } : item
      )
    );
  };

  // アイテム更新
  const handleItemChange = (
    id: string,
    field: keyof PreppedItem,
    value: string | number | boolean
  ) => {
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // ゴミ箱クリック（アイテム）
  const handleItemDeleteClick = (id: string) => {
    setItems(
      items.map((item) =>
        item.id === id
          ? { ...item, isMarkedForDeletion: !item.isMarkedForDeletion }
          : item
      )
    );
  };

  // レシピライン更新
  const handleRecipeLineChange = (
    itemId: string,
    lineId: string,
    field: keyof RecipeLine,
    value: string | number
  ) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: item.recipe_lines.map((line) =>
                line.id === lineId ? { ...line, [field]: value } : line
              ),
            }
          : item
      )
    );
  };

  // レシピライン削除クリック
  const handleRecipeLineDeleteClick = (itemId: string, lineId: string) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: item.recipe_lines.map((line) =>
                line.id === lineId
                  ? {
                      ...line,
                      isMarkedForDeletion: !line.isMarkedForDeletion,
                    }
                  : line
              ),
            }
          : item
      )
    );
  };

  // プラスマーククリック（新しいアイテム追加）
  const handleAddItemClick = () => {
    const newItem: PreppedItem = {
      id: `new-${Date.now()}`,
      name: "",
      item_kind: "prepped",
      is_menu_item: false,
      yield_amount: 0,
      yield_unit: "g",
      recipe_lines: [],
      notes: "",
      isExpanded: true,
    };
    setItems([...items, newItem]);
  };

  // レシピライン追加（Ingredient）
  const handleAddIngredientLine = (itemId: string) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: [
                ...item.recipe_lines,
                {
                  id: `rl-${Date.now()}`,
                  line_type: "ingredient",
                  child_item_id: "",
                  quantity: 0,
                  unit: "g",
                },
              ],
            }
          : item
      )
    );
  };

  // レシピライン追加（Labor）
  const handleAddLaborLine = (itemId: string) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: [
                ...item.recipe_lines,
                {
                  id: `rl-${Date.now()}`,
                  line_type: "labor",
                  labor_role: "",
                  minutes: 0,
                },
              ],
            }
          : item
      )
    );
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

        {/* アイテムリスト */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                  {/* 展開アイコン用 */}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Yield
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost/g
                </th>
                {isEditMode && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                    {/* ゴミ箱列のヘッダー */}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item) => (
                <Fragment key={item.id}>
                  <tr
                    className={`${
                      item.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50 cursor-pointer`}
                    onClick={() => !isEditMode && toggleExpand(item.id)}
                  >
                    {/* 展開アイコン */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(item.id);
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {item.isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )}
                      </button>
                    </td>

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

                    {/* Type */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <select
                          value={item.is_menu_item ? "menu" : "prepped"}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              "is_menu_item",
                              e.target.value === "menu"
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="prepped">Prepped</option>
                          <option value="menu">Menu Item</option>
                        </select>
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.is_menu_item ? "Menu Item" : "Prepped"}
                        </div>
                      )}
                    </td>

                    {/* Yield */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={item.yield_amount}
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                "yield_amount",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                            min="0"
                            step="0.01"
                          />
                          <select
                            value={item.yield_unit}
                            onChange={(e) =>
                              handleItemChange(
                                item.id,
                                "yield_unit",
                                e.target.value
                              )
                            }
                            className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {unitOptions.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.yield_amount} {item.yield_unit}
                        </div>
                      )}
                    </td>

                    {/* Cost/g */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        $0.005/g {/* Mock value */}
                      </div>
                    </td>

                    {/* ゴミ箱（Editモード時のみ） */}
                    {isEditMode && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleItemDeleteClick(item.id);
                          }}
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

                  {/* 展開されたレシピとLaborセクション */}
                  {item.isExpanded && (
                    <tr>
                      <td
                        colSpan={isEditMode ? 6 : 5}
                        className="px-6 py-4 bg-gray-50"
                      >
                        <div className="space-y-6">
                          {/* Recipeセクション */}
                          <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">
                              Recipe:
                            </h3>
                            <table className="w-full">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                                    Item
                                  </th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                                    Quantity
                                  </th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                                    Unit
                                  </th>
                                  {isEditMode && (
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 w-16">
                                      {/* ゴミ箱列 */}
                                    </th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {item.recipe_lines
                                  .filter(
                                    (line) => line.line_type === "ingredient"
                                  )
                                  .map((line) => (
                                    <tr
                                      key={line.id}
                                      className={
                                        line.isMarkedForDeletion
                                          ? "bg-red-50"
                                          : ""
                                      }
                                    >
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <SearchableSelect
                                            options={availableItems}
                                            value={line.child_item_id || ""}
                                            onChange={(value) =>
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "child_item_id",
                                                value
                                              )
                                            }
                                            placeholder="Select item..."
                                          />
                                        ) : (
                                          <div className="text-sm text-gray-900">
                                            {availableItems.find(
                                              (i) => i.id === line.child_item_id
                                            )?.name || "-"}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <input
                                            type="number"
                                            value={line.quantity || 0}
                                            onChange={(e) =>
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "quantity",
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
                                            {line.quantity || 0}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <select
                                            value={line.unit || "g"}
                                            onChange={(e) =>
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "unit",
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
                                            {line.unit || "-"}
                                          </div>
                                        )}
                                      </td>
                                      {isEditMode && (
                                        <td className="px-4 py-2">
                                          <button
                                            onClick={() =>
                                              handleRecipeLineDeleteClick(
                                                item.id,
                                                line.id
                                              )
                                            }
                                            className={`p-2 rounded-md transition-colors ${
                                              line.isMarkedForDeletion
                                                ? "bg-red-500 text-white hover:bg-red-600"
                                                : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                                            }`}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                {isEditMode && (
                                  <tr>
                                    <td
                                      colSpan={isEditMode ? 4 : 3}
                                      className="px-4 py-2"
                                    >
                                      <button
                                        onClick={() =>
                                          handleAddIngredientLine(item.id)
                                        }
                                        className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                                      >
                                        <Plus className="w-4 h-4" />
                                        <span className="text-sm">
                                          Add ingredient
                                        </span>
                                      </button>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          {/* Laborセクション */}
                          <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">
                              Labor:
                            </h3>
                            <table className="w-full">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                                    Role
                                  </th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">
                                    Minutes
                                  </th>
                                  {isEditMode && (
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 w-16">
                                      {/* ゴミ箱列 */}
                                    </th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {item.recipe_lines
                                  .filter((line) => line.line_type === "labor")
                                  .map((line) => (
                                    <tr
                                      key={line.id}
                                      className={
                                        line.isMarkedForDeletion
                                          ? "bg-red-50"
                                          : ""
                                      }
                                    >
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <select
                                            value={line.labor_role || ""}
                                            onChange={(e) =>
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "labor_role",
                                                e.target.value
                                              )
                                            }
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                          >
                                            <option value="">
                                              Select role...
                                            </option>
                                            {laborRoles.map((role) => (
                                              <option
                                                key={role.id}
                                                value={role.id}
                                              >
                                                {role.name}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <div className="text-sm text-gray-900">
                                            {laborRoles.find(
                                              (r) => r.id === line.labor_role
                                            )?.name || "-"}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <input
                                            type="number"
                                            value={line.minutes || 0}
                                            onChange={(e) =>
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "minutes",
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
                                            {line.minutes || 0} minutes
                                          </div>
                                        )}
                                      </td>
                                      {isEditMode && (
                                        <td className="px-4 py-2">
                                          <button
                                            onClick={() =>
                                              handleRecipeLineDeleteClick(
                                                item.id,
                                                line.id
                                              )
                                            }
                                            className={`p-2 rounded-md transition-colors ${
                                              line.isMarkedForDeletion
                                                ? "bg-red-500 text-white hover:bg-red-600"
                                                : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                                            }`}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                {isEditMode && (
                                  <tr>
                                    <td
                                      colSpan={isEditMode ? 3 : 2}
                                      className="px-4 py-2"
                                    >
                                      <button
                                        onClick={() =>
                                          handleAddLaborLine(item.id)
                                        }
                                        className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                                      >
                                        <Plus className="w-4 h-4" />
                                        <span className="text-sm">
                                          Add labor
                                        </span>
                                      </button>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
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
                      onClick={handleAddItemClick}
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
