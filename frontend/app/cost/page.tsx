"use client";

import { useState, Fragment, useEffect, useRef } from "react";
import {
  Edit,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Share2,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  itemsAPI,
  recipeLinesAPI,
  laborRolesAPI,
  costAPI,
  baseItemsAPI,
  vendorProductsAPI,
  vendorsAPI,
  productMappingsAPI,
  proceedValidationSettingsAPI,
  resourceSharesAPI,
  apiRequest,
  saveChangeHistory,
  // getAndClearChangeHistory, // フル計算に統一するため、不要
  type Item,
  type RecipeLine as APIRecipeLine,
  type LaborRole,
  type BaseItem,
  type VendorProduct,
  type Vendor,
  type ResourceShare,
} from "@/lib/api";
import {
  MASS_UNIT_CONVERSIONS,
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  VOLUME_UNIT_TO_LITERS,
  isNonMassUnit,
  isMassUnit,
} from "@/lib/constants";
import { useTheme } from "@/contexts/ThemeContext";
import { useUser } from "@/hooks/useUser";
import { useTenant } from "@/contexts/TenantContext";

// Recipe Lineの型定義（UI用）
interface RecipeLine {
  id: string;
  line_type: "ingredient" | "labor";
  child_item_id?: string; // ingredient only
  quantity?: number; // ingredient only
  unit?: string; // ingredient only
  specific_child?: string | null; // "lowest" or vendor_product.id (only for raw items)
  labor_role?: string; // labor only
  minutes?: number; // labor only
  last_change?: string | null; // vendor product change history
  isMarkedForDeletion?: boolean;
  isNew?: boolean; // 新規作成フラグ
}

// UI用の型定義
interface VendorProductUI extends VendorProduct {
  base_item_id: string; // product_mappingsから取得した表示用のbase_item_id
}

// Prepped/Menu Itemの型定義（UI用）
interface PreppedItem {
  id: string;
  name: string;
  item_kind: "prepped";
  is_menu_item: boolean;
  proceed_yield_amount: number;
  proceed_yield_unit: string;
  recipe_lines: RecipeLine[];
  notes: string;
  isExpanded?: boolean;
  isMarkedForDeletion?: boolean;
  isNew?: boolean; // 新規作成フラグ
  cost_per_gram?: number; // コスト計算結果
  each_grams?: number | null; // 1個あたりの重量（g）（Yield Unit = "each"の場合）
  deprecated?: string | null; // timestamp when deprecated
  deprecation_reason?: "direct" | "indirect" | null; // reason for deprecation
  wholesale?: number | null; // wholesale price
  retail?: number | null; // retail price
  user_id?: string; // 作成者のユーザーID
  responsible_user_id?: string | null; // 責任者のユーザーID（アクセス権を変更できるManager）
}

// 単位のオプション（順番を制御）
// const unitOptions = [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED]; // 未使用のためコメントアウト

// Yieldの単位オプション（g、kg、each）
const yieldUnitOptions = ["g", "kg", "each"];

// Add Item Modal Component
function AddItemModal({
  onSave,
  onCancel,
  isDark,
  availableItems,
  vendorProducts,
  baseItems,
  laborRoles,
  vendors,
  getAvailableItemsForSelect,
  getAvailableVendorProducts,
  getAvailableUnitsForItem,
  calculateCostPerKg,
}: {
  onSave: (item: PreppedItem) => void;
  onCancel: () => void;
  isDark: boolean;
  availableItems: Item[];
  vendorProducts: VendorProduct[];
  baseItems: BaseItem[];
  laborRoles: LaborRole[];
  vendors: Vendor[];
  getAvailableItemsForSelect: (currentChildItemId?: string) => Array<{
    id: string;
    name: string;
    disabled?: boolean;
    deprecated?: boolean;
  }>;
  getAvailableVendorProducts: (
    childItemId: string,
    currentSpecificChild?: string | null
  ) => VendorProduct[];
  getAvailableUnitsForItem: (itemId: string) => string[];
  calculateCostPerKg: (
    vendorProduct: VendorProduct,
    childItem: Item
  ) => number | null;
}) {
  const [name, setName] = useState("");
  const [isMenuItem, setIsMenuItem] = useState(false);
  const [proceedYieldAmount, setProceedYieldAmount] = useState(0);
  const [proceedYieldAmountInput, setProceedYieldAmountInput] = useState<
    string | null
  >(null); // 入力中の文字列を保持
  const [proceedYieldUnit, setProceedYieldUnit] = useState<"g" | "kg" | "each">(
    "g"
  );
  const [eachGrams, setEachGrams] = useState<number | null>(null);
  const [eachGramsInput, setEachGramsInput] = useState<string | null>(null); // 入力中の文字列を保持
  const [notes, setNotes] = useState("");
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  // 入力中のquantityを文字列として保持（line.id -> 入力中の文字列）
  const [modalQuantityInputs, setModalQuantityInputs] = useState<
    Map<string, string>
  >(new Map());
  // 入力中のminutesを文字列として保持（line.id -> 入力中の文字列）
  const [modalMinutesInputs, setModalMinutesInputs] = useState<
    Map<string, string>
  >(new Map());

  // モーダル内でレシピラインを管理する関数
  const handleModalRecipeLineChange = (
    lineId: string,
    field: keyof RecipeLine,
    value: string | number | null
  ) => {
    setRecipeLines(
      recipeLines.map((line) => {
        if (line.id === lineId) {
          const updatedLine = { ...line, [field]: value };

          // child_item_idが変更された場合、unitとspecific_childをリセット
          if (field === "child_item_id") {
            const availableUnits = getAvailableUnitsForItem(value as string);
            updatedLine.unit =
              availableUnits.length > 0 ? availableUnits[0] : "g";
            const selectedItem = availableItems.find((i) => i.id === value);
            updatedLine.specific_child =
              selectedItem?.item_kind === "raw" ? "lowest" : null;
          }

          return updatedLine;
        }
        return line;
      })
    );
  };

  const handleModalAddIngredientLine = () => {
    setRecipeLines([
      ...recipeLines,
      {
        id: `rl-${Date.now()}`,
        line_type: "ingredient",
        child_item_id: "",
        quantity: 0,
        unit: "g",
        specific_child: null,
        isNew: true,
      },
    ]);
  };

  const handleModalAddLaborLine = () => {
    setRecipeLines([
      ...recipeLines,
      {
        id: `rl-${Date.now()}`,
        line_type: "labor",
        labor_role: "",
        minutes: 0,
        isNew: true,
      },
    ]);
  };

  const handleModalRecipeLineDelete = (lineId: string) => {
    setRecipeLines(
      recipeLines.map((line) =>
        line.id === lineId
          ? { ...line, isMarkedForDeletion: !line.isMarkedForDeletion }
          : line
      )
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert("Name is required");
      return;
    }

    // レシピラインが少なくとも1つ必要
    const activeRecipeLines = recipeLines.filter(
      (line) => !line.isMarkedForDeletion
    );
    if (activeRecipeLines.length === 0) {
      alert("At least one recipe line (ingredient or labor) is required");
      return;
    }

    const newItem: PreppedItem = {
      id: `new-${Date.now()}`,
      name: name.trim(),
      item_kind: "prepped",
      is_menu_item: isMenuItem,
      proceed_yield_amount: proceedYieldAmount,
      proceed_yield_unit: proceedYieldUnit,
      recipe_lines: recipeLines,
      notes: notes,
      isExpanded: true,
      isNew: true,
      each_grams: proceedYieldUnit === "each" ? eachGrams : null,
    };

    onSave(newItem);
  };

  return (
    <div
      className={`fixed inset-0 z-60 flex items-center justify-center ${
        isDark ? "bg-black/70" : "bg-black/50"
      }`}
    >
      <div
        className={`w-full max-w-6xl rounded-lg shadow-xl p-6 transition-colors ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <div className="flex justify-between items-center mb-6">
          <h2
            className={`text-xl font-bold ${
              isDark ? "text-slate-100" : "text-gray-900"
            }`}
          >
            Add New Item
          </h2>
          <button
            onClick={onCancel}
            className={`p-2 rounded-lg transition-colors ${
              isDark
                ? "hover:bg-slate-700 text-slate-300"
                : "hover:bg-gray-100 text-gray-600"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                isDark
                  ? "bg-slate-700 border-slate-600 text-slate-100"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
              placeholder="Enter item name"
            />
          </div>

          {/* Type */}
          <div>
            <label
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!isMenuItem}
                  onChange={() => setIsMenuItem(false)}
                  className="w-4 h-4"
                />
                <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                  Prepped
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={isMenuItem}
                  onChange={() => setIsMenuItem(true)}
                  className="w-4 h-4"
                />
                <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                  Menu Item
                </span>
              </label>
            </div>
          </div>

          {/* Proceed Yield */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Proceed Yield Amount
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={
                  proceedYieldAmountInput !== null
                    ? proceedYieldAmountInput
                    : proceedYieldAmount === 0
                    ? ""
                    : String(proceedYieldAmount)
                }
                onChange={(e) => {
                  const value = e.target.value;
                  // 数字と小数点のみを許可（空文字列も許可）
                  const numericPattern = /^(\d+\.?\d*|\.\d+)?$/;
                  if (numericPattern.test(value)) {
                    setProceedYieldAmountInput(value);
                  }
                  // マッチしない場合は何もしない（前の値を保持）
                }}
                onBlur={(e) => {
                  const value = e.target.value;
                  // フォーカスアウト時に数値に変換
                  const numValue =
                    value === "" || value === "." ? 0 : parseFloat(value) || 0;
                  setProceedYieldAmount(numValue);
                  // 入力中の文字列をクリア
                  setProceedYieldAmountInput(null);
                }}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
              />
            </div>
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Proceed Yield Unit
              </label>
              <select
                value={proceedYieldUnit}
                onChange={(e) =>
                  setProceedYieldUnit(e.target.value as "g" | "kg" | "each")
                }
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
              >
                {yieldUnitOptions.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Each Grams (if yield unit is "each") */}
          {proceedYieldUnit === "each" && (
            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Each Grams
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={
                  eachGramsInput !== null ? eachGramsInput : eachGrams || ""
                }
                onChange={(e) => {
                  const value = e.target.value;
                  // 数字と小数点のみを許可（空文字列も許可）
                  const numericPattern = /^(\d+\.?\d*|\.\d+)?$/;
                  if (numericPattern.test(value)) {
                    setEachGramsInput(value);
                  }
                  // マッチしない場合は何もしない（前の値を保持）
                }}
                onBlur={(e) => {
                  const value = e.target.value;
                  // フォーカスアウト時に数値に変換
                  const numValue =
                    value === "" || value === "."
                      ? null
                      : parseFloat(value) || null;
                  setEachGrams(numValue);
                  // 入力中の文字列をクリア
                  setEachGramsInput(null);
                }}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
                placeholder="Enter grams per each"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label
              className={`block text-sm font-medium mb-2 ${
                isDark ? "text-slate-300" : "text-gray-700"
              }`}
            >
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                isDark
                  ? "bg-slate-700 border-slate-600 text-slate-100"
                  : "bg-white border-gray-300 text-gray-900"
              }`}
              rows={3}
              placeholder="Enter notes (optional)"
            />
          </div>

          {/* Recipe Lines */}
          <div className="mt-6">
            <h3
              className={`text-lg font-semibold mb-4 ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              Recipe Lines
            </h3>

            {/* Ingredients Section */}
            <div className="mb-6">
              <h4
                className={`text-sm font-semibold mb-3 ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Ingredients:
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead
                    className={`${
                      isDark ? "bg-slate-700" : "bg-gray-100"
                    } transition-colors`}
                  >
                    <tr>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Item
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Vendor Selection
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Quantity
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Unit
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium w-16 ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        {/* Delete column */}
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    className={`divide-y ${
                      isDark
                        ? "bg-slate-800 divide-slate-700"
                        : "bg-white divide-gray-200"
                    } transition-colors`}
                  >
                    {recipeLines
                      .filter((line) => line.line_type === "ingredient")
                      .map((line) => (
                        <tr
                          key={line.id}
                          className={
                            line.isMarkedForDeletion
                              ? isDark
                                ? "bg-red-900/30"
                                : "bg-red-50"
                              : ""
                          }
                        >
                          <td className="px-4 py-2">
                            <SearchableSelect
                              options={getAvailableItemsForSelect(
                                line.child_item_id
                              )}
                              value={line.child_item_id || ""}
                              onChange={(value) =>
                                handleModalRecipeLineChange(
                                  line.id,
                                  "child_item_id",
                                  value
                                )
                              }
                              placeholder="Select item..."
                            />
                          </td>
                          {/* Vendor Selection */}
                          <td className="px-4 py-2">
                            {(() => {
                              const childItem = availableItems.find(
                                (i) => i.id === line.child_item_id
                              );
                              const isRawItem = childItem?.item_kind === "raw";
                              const availableVendorProducts =
                                getAvailableVendorProducts(
                                  line.child_item_id || "",
                                  line.specific_child
                                );

                              if (!isRawItem) {
                                return (
                                  <div
                                    className={`text-sm ${
                                      isDark
                                        ? "text-slate-400"
                                        : "text-gray-400"
                                    }`}
                                  >
                                    -
                                  </div>
                                );
                              }

                              return (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name={`vendor-${line.id}`}
                                        checked={
                                          line.specific_child === null ||
                                          line.specific_child === "lowest"
                                        }
                                        onChange={() =>
                                          handleModalRecipeLineChange(
                                            line.id,
                                            "specific_child",
                                            "lowest"
                                          )
                                        }
                                        className="w-4 h-4"
                                      />
                                      <span
                                        className={`text-sm ${
                                          isDark
                                            ? "text-slate-300"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Lowest
                                      </span>
                                    </label>
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name={`vendor-${line.id}`}
                                        checked={
                                          line.specific_child !== null &&
                                          line.specific_child !== "lowest"
                                        }
                                        onChange={() => {
                                          if (
                                            availableVendorProducts.length > 0
                                          ) {
                                            handleModalRecipeLineChange(
                                              line.id,
                                              "specific_child",
                                              availableVendorProducts[0].id
                                            );
                                          }
                                        }}
                                        className="w-4 h-4"
                                      />
                                      <span
                                        className={`text-sm ${
                                          isDark
                                            ? "text-slate-300"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Specific
                                      </span>
                                    </label>
                                  </div>
                                  {line.specific_child !== null &&
                                    line.specific_child !== "lowest" && (
                                      <select
                                        value={line.specific_child}
                                        onChange={(e) =>
                                          handleModalRecipeLineChange(
                                            line.id,
                                            "specific_child",
                                            e.target.value
                                          )
                                        }
                                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                          isDark
                                            ? "bg-slate-700 border-slate-600 text-slate-100"
                                            : "bg-white border-gray-300 text-gray-900"
                                        }`}
                                      >
                                        {availableVendorProducts.map((vp) => {
                                          const vendor = vendors.find(
                                            (v) => v.id === vp.vendor_id
                                          );
                                          const vendorName = vendor?.name || "";
                                          const productName =
                                            vp.product_name ||
                                            vp.brand_name ||
                                            "";
                                          const childItem = availableItems.find(
                                            (i) => i.id === line.child_item_id
                                          );
                                          const costPerKg = childItem
                                            ? calculateCostPerKg(vp, childItem)
                                            : null;
                                          const costDisplay =
                                            costPerKg !== null
                                              ? `    $${costPerKg.toFixed(
                                                  2
                                                )}/kg`
                                              : "";
                                          const isDeprecated = !!vp.deprecated;
                                          return (
                                            <option
                                              key={vp.id}
                                              value={vp.id}
                                              disabled={isDeprecated}
                                              style={{
                                                opacity: isDeprecated ? 0.5 : 1,
                                                color: isDeprecated
                                                  ? "#9ca3af"
                                                  : undefined,
                                              }}
                                            >
                                              {isDeprecated
                                                ? "[Deprecated] "
                                                : ""}
                                              {vendorName} - {productName}
                                              {costDisplay}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                modalQuantityInputs.has(line.id)
                                  ? modalQuantityInputs.get(line.id)!
                                  : line.quantity === 0 || !line.quantity
                                  ? ""
                                  : String(line.quantity)
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                // 数字と小数点のみを許可（空文字列も許可）
                                const numericPattern = /^(\d+\.?\d*|\.\d+)?$/;
                                if (numericPattern.test(value)) {
                                  setModalQuantityInputs((prev) => {
                                    const newMap = new Map(prev);
                                    newMap.set(line.id, value);
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
                                handleModalRecipeLineChange(
                                  line.id,
                                  "quantity",
                                  numValue
                                );
                                // 入力中の文字列をクリア
                                setModalQuantityInputs((prev) => {
                                  const newMap = new Map(prev);
                                  newMap.delete(line.id);
                                  return newMap;
                                });
                              }}
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={line.unit || "g"}
                              onChange={(e) =>
                                handleModalRecipeLineChange(
                                  line.id,
                                  "unit",
                                  e.target.value
                                )
                              }
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                              disabled={!line.child_item_id}
                            >
                              {(() => {
                                const availableUnits = getAvailableUnitsForItem(
                                  line.child_item_id || ""
                                );
                                if (availableUnits.length === 0) {
                                  return (
                                    <option value="">Select item first</option>
                                  );
                                }
                                return availableUnits.map((unit) => {
                                  let isEachDisabled = false;
                                  if (unit === "each" && line.child_item_id) {
                                    const selectedItem = availableItems.find(
                                      (i) => i.id === line.child_item_id
                                    );
                                    isEachDisabled =
                                      !selectedItem?.each_grams ||
                                      selectedItem.each_grams === 0;
                                  }
                                  return (
                                    <option
                                      key={unit}
                                      value={unit}
                                      disabled={isEachDisabled}
                                      title={
                                        isEachDisabled
                                          ? "Please set each_grams in the Base Items tab"
                                          : ""
                                      }
                                    >
                                      {unit}
                                      {isEachDisabled && " (setup required)"}
                                    </option>
                                  );
                                });
                              })()}
                            </select>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={() =>
                                handleModalRecipeLineDelete(line.id)
                              }
                              className={`p-2 rounded-md transition-colors ${
                                line.isMarkedForDeletion
                                  ? "bg-red-500 text-white hover:bg-red-600"
                                  : isDark
                                  ? "text-slate-400 hover:text-red-500 hover:bg-red-50"
                                  : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                              }`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    <tr>
                      <td colSpan={5} className="px-4 py-2">
                        <button
                          onClick={handleModalAddIngredientLine}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                            isDark
                              ? "text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
                              : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm">Add ingredient</span>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Labor Section */}
            <div>
              <h4
                className={`text-sm font-semibold mb-3 ${
                  isDark ? "text-slate-300" : "text-gray-700"
                }`}
              >
                Labor:
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead
                    className={`${
                      isDark ? "bg-slate-700" : "bg-gray-100"
                    } transition-colors`}
                  >
                    <tr>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Role
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        Minutes
                      </th>
                      <th
                        className={`px-4 py-2 text-left text-xs font-medium w-16 ${
                          isDark ? "text-slate-300" : "text-gray-600"
                        }`}
                      >
                        {/* Delete column */}
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    className={`divide-y ${
                      isDark
                        ? "bg-slate-800 divide-slate-700"
                        : "bg-white divide-gray-200"
                    } transition-colors`}
                  >
                    {recipeLines
                      .filter((line) => line.line_type === "labor")
                      .map((line) => (
                        <tr
                          key={line.id}
                          className={
                            line.isMarkedForDeletion
                              ? isDark
                                ? "bg-red-900/30"
                                : "bg-red-50"
                              : ""
                          }
                        >
                          <td className="px-4 py-2">
                            <select
                              value={line.labor_role || ""}
                              onChange={(e) =>
                                handleModalRecipeLineChange(
                                  line.id,
                                  "labor_role",
                                  e.target.value
                                )
                              }
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                            >
                              <option value="">Select role...</option>
                              {laborRoles.map((role) => (
                                <option key={role.id} value={role.name}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={
                                modalMinutesInputs.has(line.id)
                                  ? modalMinutesInputs.get(line.id)!
                                  : line.minutes === 0 || !line.minutes
                                  ? ""
                                  : String(line.minutes)
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                // 整数のみを許可（空文字列も許可）
                                const integerPattern = /^\d*$/;
                                if (integerPattern.test(value)) {
                                  setModalMinutesInputs((prev) => {
                                    const newMap = new Map(prev);
                                    newMap.set(line.id, value);
                                    return newMap;
                                  });
                                }
                                // マッチしない場合は何もしない（前の値を保持）
                              }}
                              onBlur={(e) => {
                                const value = e.target.value;
                                // フォーカスアウト時に整数に変換
                                const numValue =
                                  value === "" ? 0 : parseInt(value, 10) || 0;
                                handleModalRecipeLineChange(
                                  line.id,
                                  "minutes",
                                  numValue
                                );
                                // 入力中の文字列をクリア
                                setModalMinutesInputs((prev) => {
                                  const newMap = new Map(prev);
                                  newMap.delete(line.id);
                                  return newMap;
                                });
                              }}
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                isDark
                                  ? "bg-slate-700 border-slate-600 text-slate-100"
                                  : "bg-white border-gray-300 text-gray-900"
                              }`}
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={() =>
                                handleModalRecipeLineDelete(line.id)
                              }
                              className={`p-2 rounded-md transition-colors ${
                                line.isMarkedForDeletion
                                  ? "bg-red-500 text-white hover:bg-red-600"
                                  : isDark
                                  ? "text-slate-400 hover:text-red-500 hover:bg-red-50"
                                  : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                              }`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    <tr>
                      <td colSpan={3} className="px-4 py-2">
                        <button
                          onClick={handleModalAddLaborLine}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                            isDark
                              ? "text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
                              : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm">Add labor</span>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
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
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="w-5 h-5" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CostPage() {
  const { theme } = useTheme();
  const { user, loading: userLoading } = useUser();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";
  const [items, setItems] = useState<PreppedItem[]>([]);
  const [availableItems, setAvailableItems] = useState<Item[]>([]);
  const [baseItems, setBaseItems] = useState<BaseItem[]>([]);
  const [vendorProducts, setVendorProducts] = useState<VendorProductUI[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  // モード管理
  const [activeMode, setActiveMode] = useState<"costing" | "access-control">(
    "costing"
  );
  // Costingモードの編集状態（既存のisEditModeをリネーム）
  const [isEditModeCosting, setIsEditModeCosting] = useState(false);
  // Access Controlモードの編集状態
  const [isEditModeAccessControl, setIsEditModeAccessControl] = useState(false);
  const [originalItems, setOriginalItems] = useState<PreppedItem[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  // 共有設定の一時的な変更（Editモード用）
  const [pendingShareChanges, setPendingShareChanges] = useState<
    Map<string, "hide" | "view-only" | "editable">
  >(new Map());
  // 責任者変更（Adminのみ、item.id -> responsible_user_id）
  const [pendingResponsibleUserChanges, setPendingResponsibleUserChanges] =
    useState<Map<string, string>>(new Map());
  // 共有設定の元の状態（Cancel用）
  const [originalItemShares, setOriginalItemShares] = useState<
    Map<string, ResourceShare | null>
  >(new Map());
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearchTerm, setAppliedSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [costUnit, setCostUnit] = useState<"g" | "kg">("kg"); // Cost表示単位
  const [eachMode, setEachMode] = useState(false); // eachモード選択状態
  const [loading, setLoading] = useState(true);
  // 展開されたアイテムの色を管理（item.id -> 色のインデックス 0-3）
  const [expandedItemColors, setExpandedItemColors] = useState<
    Map<string, number>
  >(new Map());
  // 展開されたアイテムの順番を追跡（新規追加を除く）
  const [expandedOrder, setExpandedOrder] = useState<string[]>([]);
  // コスト内訳データ（Food Cost / Labor Cost）
  const [costBreakdown, setCostBreakdown] = useState<
    Record<
      string,
      {
        food_cost_per_gram: number;
        labor_cost_per_gram: number;
        total_cost_per_gram: number;
      }
    >
  >({});
  // 入力中のproceed_yield_amountを文字列として保持（item.id -> 入力中の文字列）
  const [yieldAmountInputs, setYieldAmountInputs] = useState<
    Map<string, string>
  >(new Map());
  // 入力中のeach_gramsを文字列として保持（item.id -> 入力中の文字列）
  const [eachGramsInputs, setEachGramsInputs] = useState<Map<string, string>>(
    new Map()
  );
  // 入力中のwholesaleを文字列として保持（item.id -> 入力中の文字列）
  const [wholesaleInputs, setWholesaleInputs] = useState<Map<string, string>>(
    new Map()
  );
  // 入力中のretailを文字列として保持（item.id -> 入力中の文字列）
  const [retailInputs, setRetailInputs] = useState<Map<string, string>>(
    new Map()
  );
  // 入力中のquantityを文字列として保持（line.id -> 入力中の文字列）
  const [quantityInputs, setQuantityInputs] = useState<Map<string, string>>(
    new Map()
  );
  // 入力中のminutesを文字列として保持（line.id -> 入力中の文字列）
  const [minutesInputs, setMinutesInputs] = useState<Map<string, string>>(
    new Map()
  );
  // 固定ヘッダーセクションの高さを取得するためのref
  const fixedHeaderRef = useRef<HTMLDivElement>(null);
  const [fixedHeaderHeight, setFixedHeaderHeight] = useState(0);
  // ユーザーのロール（現在のテナントでのロール）
  const [userRole, setUserRole] = useState<
    "admin" | "manager" | "staff" | null
  >(null);
  // 現在のユーザーID
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // 各アイテムの共有設定（item.id -> ResourceShare | null）
  const [itemShares, setItemShares] = useState<
    Map<string, ResourceShare | null>
  >(new Map());
  // マネージャーのリスト（責任者選択用）
  const [managers, setManagers] = useState<
    Array<{
      user_id: string;
      role: string;
      name?: string;
      email?: string;
    }>
  >([]);

  // データ取得
  useEffect(() => {
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) {
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);

        // 並列実行可能なAPI呼び出しを同時に実行（パフォーマンス最適化）
        // 注意: 変更履歴は使用せず、常にフル計算を行います
        const [
          preppedItems,
          allItems,
          baseItemsData,
          vendorProductsData,
          vendorsData,
          roles,
          mappingsData,
          breakdownData,
        ] = await Promise.all([
          itemsAPI.getAll({ item_kind: "prepped" }),
          itemsAPI.getAll(),
          baseItemsAPI.getAll(),
          vendorProductsAPI.getAll(),
          vendorsAPI.getAll(),
          laborRolesAPI.getAll(),
          productMappingsAPI.getAll(),
          costAPI.getCostsBreakdown().catch((error) => {
            console.error("Failed to fetch cost breakdown:", error);
            return { costs: {} };
          }),
        ]);

        // product_mappingsからbase_item_idを取得するマップを作成
        const virtualProductToBaseItemMap = new Map<string, string>();
        mappingsData?.forEach((mapping) => {
          virtualProductToBaseItemMap.set(
            mapping.virtual_product_id,
            mapping.base_item_id
          );
        });

        // vendorProductsにbase_item_idを追加（表示用）
        const vendorProductsWithBaseItemId = vendorProductsData.map((vp) => ({
          ...vp,
          base_item_id: virtualProductToBaseItemMap.get(vp.id) || "",
        }));

        // 状態を更新
        setAvailableItems(allItems);
        setBaseItems(baseItemsData);
        setVendorProducts(vendorProductsWithBaseItemId);
        setVendors(vendorsData);
        setLaborRoles(roles);
        setCostBreakdown(breakdownData.costs);

        // ユーザーのロールを取得
        try {
          const tenantsData = await apiRequest<{
            tenants: Array<{
              id: string;
              name: string;
              type: string;
              created_at: string;
              role: string;
            }>;
          }>("/tenants");
          
          if (tenantsData.tenants && tenantsData.tenants.length > 0) {
            // 最初のテナントのロールを使用
            const role = tenantsData.tenants[0].role as
              | "admin"
              | "manager"
              | "staff";
            setUserRole(role);
            
            // Adminの場合、Prepped Itemsの共有設定を取得
            if (role === "admin") {
              const preppedItemIds = preppedItems.map((item) => item.id);
              if (preppedItemIds.length > 0) {
                  try {
                  // 一括取得（パフォーマンス最適化）
                  const allShares = await resourceSharesAPI.getAll({
                      resource_type: "item",
                    // resource_idを指定しない → 全件取得
                      target_type: "role",
                      target_id: "manager",
                    });

                  // フロントエンドでitemIdでフィルタリングしてMapに保存
                  const sharesMap = new Map<string, ResourceShare | null>();
                  preppedItemIds.forEach((itemId) => {
                    const share =
                      allShares
                        .filter((s) => s.resource_id === itemId)
                        .find((s) => s.is_exclusion === false) || null;
                  sharesMap.set(itemId, share);
                });
                setItemShares(sharesMap);
                } catch (error) {
                  console.error("Failed to fetch shares:", error);
                  // エラー時は空のMapを設定
                  setItemShares(new Map());
                }

                // マネージャーのリストを取得（責任者選択用）
                try {
                  const currentTenantId =
                    selectedTenantId || tenantsData.tenants[0]?.id;
                  if (currentTenantId) {
                    const membersData = await apiRequest<{
                      members: Array<{
                        user_id: string;
                        role: string;
                        member_since: string;
                        name?: string;
                        email?: string;
                      }>;
                    }>(`/tenants/${currentTenantId}/members`);

                    // Managerロールのユーザーのみをフィルタリング
                    const managerList = (membersData.members || []).filter(
                      (member) => member.role === "manager"
                    );
                    setManagers(managerList);
                  }
                } catch (error) {
                  console.error("Failed to fetch managers:", error);
                  setManagers([]);
                }
              }
            }
          }
        } catch (error) {
          console.error("Failed to fetch user role:", error);
        }

        // 全アイテムのIDを取得
        const itemIds = preppedItems.map((item) => item.id);

        // 全アイテムのレシピを一度に取得（itemIdsに依存）
        let recipesMap: Record<string, APIRecipeLine[]> = {};
        try {
          if (itemIds.length > 0) {
            const recipesData = await recipeLinesAPI.getByItemIds(itemIds);
            recipesMap = recipesData.recipes;
          }
        } catch (error) {
          console.error("Failed to fetch recipes:", error);
        }

        // 全アイテムのコストを計算（フル計算）
        // 注意: 差分更新は使用せず、常に全アイテムのコストを計算します
        let costsMap: Record<string, number> = {};
        try {
          if (itemIds.length > 0) {
            const costsData = await costAPI.getCosts(itemIds);
            costsMap = costsData.costs;
          }
        } catch (error) {
          console.error("Failed to calculate costs:", error);
        }

        // 各アイテムのデータを構築
        const itemsWithRecipes: PreppedItem[] = preppedItems
          .filter((item) => {
            // 直接deprecatedアイテムは除外
            return item.deprecation_reason !== "direct";
          })
          .map((item) => {
            const recipeLines = recipesMap[item.id] || [];
            const costPerGram = costsMap[item.id];

            return {
              id: item.id,
              name: item.name,
              item_kind: "prepped",
              is_menu_item: item.is_menu_item,
              proceed_yield_amount: item.proceed_yield_amount || 0,
              proceed_yield_unit: item.proceed_yield_unit || "g",
              user_id: item.user_id,
              responsible_user_id: item.responsible_user_id,
              recipe_lines: recipeLines.map((line) => {
                // specific_childの処理: Raw Itemの場合、nullを"lowest"に変換
                let specificChild = line.specific_child || null;
                if (line.line_type === "ingredient" && line.child_item_id) {
                  const childItem = allItems.find(
                    (i) => i.id === line.child_item_id
                  );
                  if (childItem?.item_kind === "raw" && !specificChild) {
                    specificChild = "lowest";
                  }
                }

                return {
                  id: line.id,
                  line_type: line.line_type,
                  child_item_id: line.child_item_id || undefined,
                  quantity: line.quantity || undefined,
                  unit: line.unit || undefined,
                  specific_child: specificChild,
                  labor_role: line.labor_role || undefined,
                  minutes: line.minutes || undefined,
                  last_change: line.last_change || null,
                };
              }),
              notes: item.notes || "",
              isExpanded: false,
              cost_per_gram: costPerGram,
              each_grams: item.each_grams || null,
              deprecated: item.deprecated || null,
              deprecation_reason: item.deprecation_reason || null,
              wholesale: item.wholesale || null,
              retail: item.retail || null,
            };
          });

        setItems(itemsWithRecipes);
        setOriginalItems(JSON.parse(JSON.stringify(itemsWithRecipes)));
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedTenantId]); // テナント切り替え時にデータを再取得

  // 現在のユーザーIDを設定（userが取得できた後に設定）
  useEffect(() => {
    if (user?.id) {
      setCurrentUserId(user.id);
    } else {
      setCurrentUserId(null);
    }
  }, [user]);

  // モード切り替えハンドラー
  const handleModeChange = async (newMode: "costing" | "access-control") => {
    if (activeMode !== newMode) {
      // 編集中の場合はリセット（警告なし、後で追加可能）
      setIsEditModeCosting(false);
      setIsEditModeAccessControl(false);
      setPendingShareChanges(new Map());
      setActiveMode(newMode);

      // Access Controlモードに切り替える場合のみ、共有設定を再取得
      if (newMode === "access-control") {
        await refreshItemShares();
      }
    }
  };

  // 共有設定の再取得（Access Controlモード用）
  const refreshItemShares = async () => {
    try {
      const preppedItemIds = items
        .filter((item) => item.item_kind === "prepped")
        .map((item) => item.id);

      if (preppedItemIds.length > 0) {
        // 一括取得（パフォーマンス最適化）
        const allShares = await resourceSharesAPI.getAll({
          resource_type: "item",
          // resource_idを指定しない → 全件取得
          target_type: "role",
          target_id: "manager",
        });

        // フロントエンドでitemIdでフィルタリングしてMapに保存
        const sharesMap = new Map<string, ResourceShare | null>();
        preppedItemIds.forEach((itemId) => {
          const share =
            allShares
              .filter((s) => s.resource_id === itemId)
              .find((s) => s.is_exclusion === false) || null;
          sharesMap.set(itemId, share);
        });
        setItemShares(sharesMap);
      }
    } catch (error) {
      console.error("Failed to refresh item shares:", error);
      // エラー時は空のMapを設定
      setItemShares(new Map());
    }
  };

  // CostingモードのEditモード切り替え
  const handleEditClick = () => {
    // 現在の状態を保存
    setOriginalItems(JSON.parse(JSON.stringify(items)));
    setIsEditModeCosting(true);
  };

  // CostingモードのCancel処理
  const handleCancelClick = () => {
    // 元の状態に戻す
    setItems(JSON.parse(JSON.stringify(originalItems)));
    setIsEditModeCosting(false);
  };

  // Access ControlモードのEditモード切り替え
  const handleAccessControlEditClick = () => {
    // 現在の共有設定を保存
    setOriginalItemShares(new Map(itemShares));
    setPendingShareChanges(new Map());
    setPendingResponsibleUserChanges(new Map());
    setIsEditModeAccessControl(true);
  };

  // Access ControlモードのCancel処理
  const handleAccessControlCancelClick = () => {
    // 元の共有設定に戻す
    setItemShares(new Map(originalItemShares));
    setPendingShareChanges(new Map());
    setPendingResponsibleUserChanges(new Map());
    setIsEditModeAccessControl(false);
  };

  // Access ControlモードのSave処理
  const handleAccessControlSaveClick = async () => {
    setLoading(true);
    try {
      // pendingShareChangesを順次保存
      for (const [itemId, shareType] of pendingShareChanges.entries()) {
        const item = items.find((i) => i.id === itemId);
        if (!item || !canChangeAccessControl(item)) continue;

        const existingShare = itemShares.get(itemId);

        if (shareType === "hide") {
          // Hideを選択した場合 → allowed_actionsを空にする（レコードは残す）
          if (existingShare) {
            // 既存の共有設定を更新して、allowed_actionsを空にする
            await resourceSharesAPI.update(existingShare.id, {
              allowed_actions: [],
            });
            setItemShares((prev) => {
              const next = new Map(prev);
              next.set(itemId, {
                ...existingShare,
                allowed_actions: [],
              });
              return next;
            });
          } else {
            // レコードが存在しない場合は作成（hide状態 = allowed_actionsが空）
            const newShare = await resourceSharesAPI.create({
              resource_type: "item",
              resource_id: itemId,
              target_type: "role",
              target_id: "manager",
              allowed_actions: [],
              is_exclusion: false,
              show_history_to_shared: false,
            });
            setItemShares((prev) => {
              const next = new Map(prev);
              next.set(itemId, newShare);
              return next;
            });
          }
        } else {
          // ViewまたはEditを選択した場合
          const allowedActions =
            shareType === "view-only" ? ["read"] : ["read", "update"];

          if (existingShare) {
            // 既存の共有設定を更新
            await resourceSharesAPI.update(existingShare.id, {
              allowed_actions: allowedActions,
            });
            setItemShares((prev) => {
              const next = new Map(prev);
              next.set(itemId, {
                ...existingShare,
                allowed_actions: allowedActions,
              });
              return next;
            });
          } else {
            // 新規作成
            const newShare = await resourceSharesAPI.create({
              resource_type: "item",
              resource_id: itemId,
              target_type: "role",
              target_id: "manager",
              allowed_actions: allowedActions,
              is_exclusion: false,
              show_history_to_shared: false,
            });

            setItemShares((prev) => {
              const next = new Map(prev);
              next.set(itemId, newShare);
              return next;
            });
          }
        }
      }

      // 責任者変更を処理（Adminのみ）
      if (userRole === "admin") {
        for (const [
          itemId,
          responsibleUserId,
        ] of pendingResponsibleUserChanges.entries()) {
          const item = items.find((i) => i.id === itemId);
          if (!item) continue;

          // responsibleUserIdが空文字列の場合は、既存の値を維持
          const finalResponsibleUserId =
            responsibleUserId || item.responsible_user_id;

          // itemsテーブルのresponsible_user_idを更新
          await itemsAPI.update(itemId, {
            responsible_user_id: finalResponsibleUserId,
          });

          // ローカル状態も更新
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? { ...i, responsible_user_id: finalResponsibleUserId }
                : i
            )
          );
        }
      }

      // 保存完了後、pendingShareChangesとpendingResponsibleUserChangesをクリア
      setPendingShareChanges(new Map());
      setPendingResponsibleUserChanges(new Map());
      setIsEditModeAccessControl(false);
    } catch (error) {
      console.error("Failed to save share settings:", error);
      alert("共有設定の保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // アイテムのコントロール権を変更できるかチェック
  const canChangeAccessControl = (item: PreppedItem): boolean => {
    if (!currentUserId) return false;
    if (userRole === "admin") return true;
    if (userRole !== "manager") return false;
    // 作成者かつresponsible_user_idが自分、またはresponsible_user_idが自分
    const isCreatorAndResponsible =
      item.user_id === currentUserId &&
      item.responsible_user_id === currentUserId;
    const isResponsibleUser = item.responsible_user_id === currentUserId;
    return isCreatorAndResponsible || isResponsibleUser;
  };

  // 共有設定の一時的な変更（Editモード用）
  const handleShareChangePending = (
    itemId: string,
    shareType: "hide" | "view-only" | "editable"
  ) => {
    if (!isEditModeAccessControl) return;
    const item = items.find((i) => i.id === itemId);
    if (!item || !canChangeAccessControl(item)) return;

    setPendingShareChanges((prev) => {
      const next = new Map(prev);
      next.set(itemId, shareType);
      return next;
    });
  };

  // 単位と数量をグラムに変換（フロントエンド用）
  const convertToGrams = (
    unit: string,
    quantity: number,
    itemId: string
  ): number => {
    if (!itemId || !quantity) return 0;

    // 質量単位の場合
    if (isMassUnit(unit)) {
      const multiplier = MASS_UNIT_CONVERSIONS[unit];
      return quantity * multiplier;
    }

    // Itemを取得
    const item = availableItems.find((i) => i.id === itemId);
    if (!item) {
      return 0; // エラーではなく0を返す（バリデーションで処理）
    }

    if (unit === "each") {
      // eachの場合、items.each_gramsを使用
      if (!item.each_grams) {
        return 0; // エラーではなく0を返す（バリデーションで処理）
      }
      return quantity * item.each_grams;
    }

    // その他の非質量単位（gallon, liter, floz）
    if (!isNonMassUnit(unit)) {
      return 0; // エラーではなく0を返す（バリデーションで処理）
    }

    // Raw Itemの場合、base_item → specific_weight
    if (item.item_kind === "raw") {
      if (!item.base_item_id) {
        return 0; // エラーではなく0を返す（バリデーションで処理）
      }

      const baseItem = baseItems.find((b) => b.id === item.base_item_id);
      if (!baseItem || !baseItem.specific_weight) {
        return 0; // エラーではなく0を返す（バリデーションで処理）
      }

      // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
      const litersPerUnit = VOLUME_UNIT_TO_LITERS[unit];
      if (!litersPerUnit) {
        return 0; // エラーではなく0を返す（バリデーションで処理）
      }
      const gramsPerSourceUnit =
        baseItem.specific_weight * 1000 * litersPerUnit;
      return quantity * gramsPerSourceUnit;
    }

    // Prepped Itemの場合、非質量単位は使用できない
    return 0; // エラーではなく0を返す（バリデーションで処理）
  };

  // Yieldをグラムに変換
  const convertYieldToGrams = (
    yieldAmount: number,
    yieldUnit: string
  ): number => {
    if (yieldUnit === "each") {
      // Yieldが"each"の場合、グラムに変換できない
      // バリデーションでは、材料の総合計と比較できないため、エラーを返す
      return -1; // エラーを示す値
    }

    // Yieldが質量単位（"g"または"kg"など）の場合
    const multiplier = MASS_UNIT_CONVERSIONS[yieldUnit];
    if (!multiplier) {
      return -1; // エラーを示す値
    }
    return yieldAmount * multiplier;
  };

  // 材料の総合計をグラムで計算
  // リアルタイム計算: パーセンテージを計算
  const calculatePercentages = (
    price: number | null | undefined,
    item: PreppedItem
  ) => {
    if (!price || price <= 0) {
      return { laborPercent: null, cogPercent: null, lcogPercent: null };
    }

    const breakdown = costBreakdown[item.id];
    if (!breakdown) {
      return { laborPercent: null, cogPercent: null, lcogPercent: null };
    }

    // eachモード選択時、proceed_yield_unit === "each"のアイテムは$/eachで入力されているため、$/gに変換
    // それ以外は$/kgで入力されているため、$/gに変換
    const pricePerGram =
      eachMode && item.proceed_yield_unit === "each" && item.each_grams
        ? price / item.each_grams // $/each → $/g
        : price / 1000; // $/kg → $/g
    const laborPercent =
      pricePerGram > 0
        ? (breakdown.labor_cost_per_gram / pricePerGram) * 100
        : null;
    const cogPercent =
      pricePerGram > 0
        ? (breakdown.food_cost_per_gram / pricePerGram) * 100
        : null;
    const lcogPercent =
      pricePerGram > 0
        ? ((breakdown.food_cost_per_gram + breakdown.labor_cost_per_gram) /
            pricePerGram) *
          100
        : null;

    return { laborPercent, cogPercent, lcogPercent };
  };

  const calculateTotalIngredientsGrams = (
    recipeLines: RecipeLine[]
  ): number => {
    let totalGrams = 0;

    for (const line of recipeLines) {
      if (line.line_type !== "ingredient") continue;
      if (line.isMarkedForDeletion) continue; // 削除マークが付いた材料を除外
      if (!line.child_item_id || !line.quantity || !line.unit) continue;

      const grams = convertToGrams(
        line.unit,
        line.quantity,
        line.child_item_id
      );
      totalGrams += grams;
    }

    return totalGrams;
  };

  // Save処理（内部実装用）
  const performSave = async (itemsToSave: PreppedItem[]) => {
    console.log("[DEBUG] performSave開始", {
      itemsToSaveCount: itemsToSave.length,
      timestamp: new Date().toISOString(),
    });
    try {
      setLoading(true);

      // itemsToSaveを使用
      const currentItems = itemsToSave;

      // 削除予定のアイテムと空の新規レコードをフィルター
      const filteredItems = currentItems.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (item.name.trim() === "" && item.proceed_yield_amount === 0) {
          return false;
        }
        return true;
      });

      // バリデーション設定を取得
      const validationSettings = await proceedValidationSettingsAPI.get();
      const validationMode = validationSettings.validation_mode || "block";

      // デバッグログ: バリデーション開始
      console.log("[DEBUG] バリデーション開始", {
        filteredItemsCount: filteredItems.length,
        validationMode,
        filteredItems: filteredItems.map((item) => ({
          id: item.id,
          name: item.name,
          proceed_yield_amount: item.proceed_yield_amount,
          proceed_yield_unit: item.proceed_yield_unit,
        })),
      });

      // バリデーション: Yieldが材料の総合計を超えないかチェック
      for (const item of filteredItems) {
        console.log("[DEBUG] アイテムをチェック中:", {
          id: item.id,
          name: item.name,
          proceed_yield_unit: item.proceed_yield_unit,
        });
        const totalIngredientsGrams = calculateTotalIngredientsGrams(
          item.recipe_lines
        );

        if (item.proceed_yield_unit === "each") {
          // Yieldが"each"の場合、each_grams × proceed_yield_amount ≤ 材料の総合計
          const yieldAmount = item.proceed_yield_amount || 1;
          let eachGrams: number;

          if (item.each_grams && item.each_grams > 0) {
            // 手動入力された値を使用
            eachGrams = item.each_grams;
          } else {
            // 未入力の場合、自動計算値を使用
            eachGrams = totalIngredientsGrams / yieldAmount;
          }

          const totalYieldGrams = eachGrams * yieldAmount;

          if (totalYieldGrams > totalIngredientsGrams) {
            const errorMessage = `"${
              item.name
            }"のeach_grams (${eachGrams.toFixed(
              2
            )}g) × yield_amount (${yieldAmount}) = ${totalYieldGrams.toFixed(
              2
            )}g が材料の総合計（${totalIngredientsGrams.toFixed(
              2
            )}g）を超えています。each_grams × yield_amountは材料の総合計以下である必要があります。`;

            if (validationMode === "block") {
              alert(errorMessage);
              setLoading(false);
              return;
            } else if (validationMode === "notify") {
              console.log("[DEBUG] notifyモード: ポップアップ表示（each）", {
                itemId: item.id,
                itemName: item.name,
              });
              const confirmed = window.confirm(
                `${errorMessage}\n\nContinue saving anyway?`
              );
              console.log("[DEBUG] notifyモード: ユーザー応答（each）", {
                itemId: item.id,
                itemName: item.name,
                confirmed,
              });
              if (!confirmed) {
                setLoading(false);
                return;
              }
            }
            // validationMode === "permit" の場合は何もしない（保存を続行）
          }
        } else {
          // Yieldが質量単位（"g"または"kg"など）の場合
          const yieldGrams = convertYieldToGrams(
            item.proceed_yield_amount,
            item.proceed_yield_unit
          );

          if (yieldGrams < 0) {
            alert(
              `"${item.name}"のProceed単位が無効です。バリデーションをスキップします。`
            );
            continue;
          }

          if (yieldGrams > totalIngredientsGrams) {
            const errorMessage = `"${item.name}"のProceed（${
              item.proceed_yield_amount
            } ${item.proceed_yield_unit} = ${yieldGrams.toFixed(
              2
            )}g）が材料の総合計（${totalIngredientsGrams.toFixed(
              2
            )}g）を超えています。Proceedは材料の総合計以下である必要があります。`;

            if (validationMode === "block") {
              alert(errorMessage);
              setLoading(false);
              return;
            } else if (validationMode === "notify") {
              console.log(
                "[DEBUG] notifyモード: ポップアップ表示（質量単位）",
                {
                  itemId: item.id,
                  itemName: item.name,
                }
              );
              const confirmed = window.confirm(
                `${errorMessage}\n\nContinue saving anyway?`
              );
              console.log("[DEBUG] notifyモード: ユーザー応答（質量単位）", {
                itemId: item.id,
                itemName: item.name,
                confirmed,
              });
              if (!confirmed) {
                setLoading(false);
                return;
              }
            }
            // validationMode === "permit" の場合は何もしない（保存を続行）
          }
        }
      }

      console.log("[DEBUG] バリデーション完了");

      // 循環参照チェック（保存前）
      // フロントエンドのcycle detectionを停止 - バックエンドのcycle detectionに依存
      // try {
      //   // すべてのアイテムを取得
      //   const allItems = await itemsAPI.getAll();
      //   const itemsMap = new Map<string, Item>();
      //   allItems.forEach((item) => itemsMap.set(item.id, item));

      //   // すべてのレシピラインを一度に取得（最適化）
      //   const preppedItemIds = allItems
      //     .filter((item) => item.item_kind === "prepped")
      //     .map((item) => item.id);
      //   let recipesMap: Record<string, APIRecipeLine[]> = {};
      //   try {
      //     if (preppedItemIds.length > 0) {
      //       const recipesData = await recipeLinesAPI.getByItemIds(
      //         preppedItemIds
      //       );
      //       recipesMap = recipesData.recipes;
      //     }
      //   } catch (error) {
      //     console.error("Failed to fetch recipes for cycle check:", error);
      //   }

      //   // すべてのレシピラインを配列に変換
      //   const allRecipeLines: APIRecipeLine[] = [];
      //   for (const itemId of preppedItemIds) {
      //     const lines = recipesMap[itemId] || [];
      //     allRecipeLines.push(...lines);
      //   }

      //   // レシピラインのマップを作成
      //   const recipeLinesMap = new Map<string, APIRecipeLine[]>();
      //   allRecipeLines.forEach((line) => {
      //     if (line.line_type === "ingredient") {
      //       const existing = recipeLinesMap.get(line.parent_item_id) || [];
      //       existing.push(line);
      //       recipeLinesMap.set(line.parent_item_id, existing);
      //     }
      //   });

      //   // 更新されるアイテムのレシピラインを反映
      //   for (const item of filteredItems) {
      //     if (!item.isNew) {
      //       // 既存アイテムの更新の場合、新しいレシピラインを反映
      //       const updatedLines: APIRecipeLine[] = [];
      //       for (const line of item.recipe_lines) {
      //         if (line.isMarkedForDeletion) continue;
      //         if (line.line_type === "ingredient") {
      //           if (!line.child_item_id || !line.quantity || !line.unit)
      //             continue;
      //           if (line.isNew) {
      //             // 新規レシピライン（一時的なIDを使用）
      //             updatedLines.push({
      //               id: `temp-${item.id}-${line.id}`,
      //               parent_item_id: item.id,
      //               line_type: "ingredient",
      //               child_item_id: line.child_item_id,
      //               quantity: line.quantity,
      //               unit: line.unit,
      //               labor_role: null,
      //               minutes: null,
      //             } as APIRecipeLine);
      //           } else {
      //             // 既存レシピラインの更新
      //             updatedLines.push({
      //               id: line.id,
      //               parent_item_id: item.id,
      //               line_type: "ingredient",
      //               child_item_id: line.child_item_id || null,
      //               quantity: line.quantity || null,
      //               unit: line.unit || null,
      //               labor_role: null,
      //               minutes: null,
      //             } as APIRecipeLine);
      //           }
      //         }
      //       }
      //       recipeLinesMap.set(item.id, updatedLines);
      //     } else {
      //       // 新規アイテムの場合、一時的なIDを使用（一意性を確保するため、インデックスを使用）
      //       const itemIndex = filteredItems.findIndex((i) => i === item);
      //       const tempId = `temp-new-${itemIndex}`;
      //       itemsMap.set(tempId, {
      //         id: tempId,
      //         name: item.name,
      //         item_kind: "prepped",
      //         is_menu_item: item.is_menu_item,
      //         proceed_yield_amount: item.proceed_yield_amount,
      //         proceed_yield_unit: item.proceed_yield_unit,
      //         notes: item.notes || null,
      //         base_item_id: null,
      //         each_grams: null,
      //       } as Item);

      //       const newLines: APIRecipeLine[] = [];
      //       for (const line of item.recipe_lines) {
      //         if (line.isMarkedForDeletion) continue;
      //         if (line.line_type === "ingredient") {
      //           if (!line.child_item_id || !line.quantity || !line.unit)
      //             continue;
      //           newLines.push({
      //             id: `temp-${tempId}-${line.id}`,
      //             parent_item_id: tempId,
      //             line_type: "ingredient",
      //             child_item_id: line.child_item_id,
      //             quantity: line.quantity,
      //             unit: line.unit,
      //             labor_role: null,
      //             minutes: null,
      //           } as APIRecipeLine);
      //         }
      //       }
      //       recipeLinesMap.set(tempId, newLines);
      //     }
      //   }

      //   // チェックするアイテムIDのリストを作成
      //   const itemIdsToCheck: string[] = [];
      //   for (let i = 0; i < filteredItems.length; i++) {
      //     const item = filteredItems[i];
      //     if (item.isNew) {
      //       itemIdsToCheck.push(`temp-new-${i}`);
      //     } else {
      //       itemIdsToCheck.push(item.id);
      //     }
      //   }

      //   // 循環参照をチェック
      //   checkCyclesForItems(itemIdsToCheck, itemsMap, recipeLinesMap);
      // } catch (cycleError: unknown) {
      //   const message =
      //     cycleError instanceof Error ? cycleError.message : String(cycleError);
      //   alert(message);
      //   setLoading(false);
      //   return;
      // }

      // バッチ処理用の配列を準備
      const batchCreates: Partial<APIRecipeLine>[] = [];
      const batchUpdates: (Partial<APIRecipeLine> & { id: string })[] = [];
      const batchDeletes: string[] = [];

      // 変更されたアイテムIDを追跡（差分更新用）
      const changedItemIds = new Set<string>();

      // 新規作成されたアイテムIDを記録（エラー時のロールバック用）
      const newlyCreatedItemIds: string[] = [];

      // アイテム更新用の配列（レシピライン更新後に実行）
      const itemsToUpdate: Array<{
        id: string;
        data: {
          name: string;
          is_menu_item: boolean;
          proceed_yield_amount: number;
          proceed_yield_unit: string;
          notes: string | null;
          each_grams: number | null;
          wholesale: number | null;
          retail: number | null;
        };
      }> = [];

      // API呼び出し
      for (const item of filteredItems) {
        if (item.isNew) {
          // 新規作成
          const newItem = await itemsAPI.create({
            name: item.name,
            item_kind: "prepped",
            is_menu_item: item.is_menu_item,
            proceed_yield_amount: item.proceed_yield_amount,
            proceed_yield_unit: item.proceed_yield_unit,
            notes: item.notes || null,
            each_grams:
              item.proceed_yield_unit === "each"
                ? item.each_grams || null
                : null,
            wholesale: item.wholesale || null,
            retail: item.retail || null,
          });

          // レシピラインを作成用に追加
          for (const line of item.recipe_lines) {
            if (line.isMarkedForDeletion) continue;
            if (line.line_type === "ingredient") {
              if (!line.child_item_id || !line.quantity || !line.unit) continue;
              batchCreates.push({
                parent_item_id: newItem.id,
                line_type: "ingredient",
                child_item_id: line.child_item_id,
                quantity: line.quantity,
                unit: line.unit,
                specific_child: line.specific_child || null,
              });
            } else if (line.line_type === "labor") {
              if (!line.minutes) continue;
              batchCreates.push({
                parent_item_id: newItem.id,
                line_type: "labor",
                labor_role: line.labor_role || null,
                minutes: line.minutes,
              });
            }
          }
          // 新規作成されたアイテムIDを記録
          changedItemIds.add(newItem.id);
          newlyCreatedItemIds.push(newItem.id);
        } else {
          // 更新
          // 元のアイテムを取得（変更検出用）
          const originalItem = originalItems.find((oi) => oi.id === item.id);

          // アイテムのフィールドが変更されたかチェック
          const itemFieldsChanged =
            !originalItem ||
            originalItem.name !== item.name ||
            originalItem.is_menu_item !== item.is_menu_item ||
            originalItem.proceed_yield_amount !== item.proceed_yield_amount ||
            originalItem.proceed_yield_unit !== item.proceed_yield_unit ||
            originalItem.wholesale !== item.wholesale ||
            originalItem.retail !== item.retail ||
            (originalItem.notes || null) !== (item.notes || null) ||
            (originalItem.proceed_yield_unit === "each"
              ? (originalItem.each_grams || null) !==
                (item.proceed_yield_unit === "each"
                  ? item.each_grams || null
                  : null)
              : false);

          // レシピラインの変更をバッチ配列に追加
          let recipeLinesChanged = false;
          for (const line of item.recipe_lines) {
            if (line.isMarkedForDeletion && !line.isNew) {
              // IDが存在する場合のみ削除
              if (line.id) {
                batchDeletes.push(line.id);
                recipeLinesChanged = true;
              }
            } else if (line.isNew) {
              recipeLinesChanged = true;
              if (line.line_type === "ingredient") {
                if (!line.child_item_id || !line.quantity || !line.unit)
                  continue;
                batchCreates.push({
                  parent_item_id: item.id,
                  line_type: "ingredient",
                  child_item_id: line.child_item_id,
                  quantity: line.quantity,
                  unit: line.unit,
                  specific_child: line.specific_child || null,
                });
              } else if (line.line_type === "labor") {
                if (!line.minutes) continue;
                batchCreates.push({
                  parent_item_id: item.id,
                  line_type: "labor",
                  labor_role: line.labor_role || null,
                  minutes: line.minutes,
                });
              }
            } else {
              // 既存のレシピラインを更新（IDが存在する場合のみ）
              if (!line.id) continue; // IDが存在しない場合はスキップ
              // 元のレシピラインと比較して変更があるかチェック
              const originalLine = originalItem?.recipe_lines.find(
                (ol) => ol.id === line.id
              );
              if (originalLine) {
                const lineChanged =
                  originalLine.child_item_id !== line.child_item_id ||
                  originalLine.quantity !== line.quantity ||
                  originalLine.unit !== line.unit ||
                  (originalLine.specific_child || null) !==
                    (line.specific_child || null) ||
                  originalLine.labor_role !== line.labor_role ||
                  originalLine.minutes !== line.minutes;
                if (lineChanged) {
                  recipeLinesChanged = true;
                  if (line.line_type === "ingredient") {
                    batchUpdates.push({
                      id: line.id,
                      child_item_id: line.child_item_id || null,
                      quantity: line.quantity || null,
                      unit: line.unit || null,
                      specific_child: line.specific_child || null,
                    });
                  } else if (line.line_type === "labor") {
                    batchUpdates.push({
                      id: line.id,
                      labor_role: line.labor_role || null,
                      minutes: line.minutes || null,
                    });
                  }
                }
              } else {
                // 元のレシピラインが見つからない場合（新規追加された可能性があるが、isNewフラグがない場合）
                recipeLinesChanged = true;
                if (line.line_type === "ingredient") {
                  batchUpdates.push({
                    id: line.id,
                    child_item_id: line.child_item_id || null,
                    quantity: line.quantity || null,
                    unit: line.unit || null,
                    specific_child: line.specific_child || null,
                  });
                } else if (line.line_type === "labor") {
                  batchUpdates.push({
                    id: line.id,
                    labor_role: line.labor_role || null,
                    minutes: line.minutes || null,
                  });
                }
              }
            }
          }
          // レシピラインが変更された場合、親アイテムIDを記録
          if (recipeLinesChanged) {
            changedItemIds.add(item.id);
          }

          // アイテムのフィールドが変更された、またはレシピラインが変更された場合のみ更新
          // （レシピラインが変更された場合、cycle detectionを実行するために更新が必要）
          if (itemFieldsChanged || recipeLinesChanged) {
            // アイテム更新を配列に追加（レシピライン更新後に実行）
            itemsToUpdate.push({
              id: item.id,
              data: {
                name: item.name,
                is_menu_item: item.is_menu_item,
                proceed_yield_amount: item.proceed_yield_amount,
                proceed_yield_unit: item.proceed_yield_unit,
                notes: item.notes || null,
                each_grams:
                  item.proceed_yield_unit === "each"
                    ? item.each_grams || null
                    : null,
                wholesale: item.wholesale || null,
                retail: item.retail || null,
              },
            });
            // 変更されたアイテムIDを記録
            changedItemIds.add(item.id);
          }
        }
      }

      // レシピラインのバッチ処理を実行（アイテム更新の前に実行することで、バリデーションが正しい値を使用）
      try {
        if (
          batchCreates.length > 0 ||
          batchUpdates.length > 0 ||
          batchDeletes.length > 0
        ) {
          await recipeLinesAPI.batch({
            creates: batchCreates,
            updates: batchUpdates,
            deletes: batchDeletes,
          });
        }
      } catch (error) {
        // エラー時に新規作成されたアイテムを削除（ロールバック）
        for (const itemId of newlyCreatedItemIds) {
          try {
            await itemsAPI.delete(itemId);
          } catch (deleteError) {
            console.error(
              `Failed to delete newly created item ${itemId}:`,
              deleteError
            );
            // 削除失敗はログに記録するが、エラーは再スローしない
          }
        }

        // エラー時にデータを再取得してフロントエンドの状態を更新
        try {
          const preppedItems = await itemsAPI.getAll({ item_kind: "prepped" });
          const allItems = await itemsAPI.getAll();
          setAvailableItems(allItems);

          // レシピを取得
          const itemIds = preppedItems.map((item) => item.id);
          let recipesMap: Record<string, APIRecipeLine[]> = {};
          if (itemIds.length > 0) {
            try {
              const recipesData = await recipeLinesAPI.getByItemIds(itemIds);
              recipesMap = recipesData.recipes;
            } catch (recipeError) {
              console.error(
                "Failed to fetch recipes after error:",
                recipeError
              );
            }
          }

          // コストを取得
          let costsMap: Record<string, number> = {};
          if (itemIds.length > 0) {
            try {
              const costsData = await costAPI.getCosts(itemIds);
              costsMap = costsData.costs;
            } catch (costError) {
              console.error("Failed to fetch costs after error:", costError);
            }
          }

          // アイテムデータを構築
          const itemsWithRecipes: PreppedItem[] = preppedItems
            .filter((item) => {
              // 直接deprecatedアイテムは除外
              return item.deprecation_reason !== "direct";
            })
            .map((item) => {
              const recipeLines = recipesMap[item.id] || [];
              const costPerGram = costsMap[item.id];

              return {
                id: item.id,
                name: item.name,
                item_kind: "prepped",
                is_menu_item: item.is_menu_item,
                proceed_yield_amount: item.proceed_yield_amount || 0,
                proceed_yield_unit: item.proceed_yield_unit || "g",
                recipe_lines: recipeLines.map((line) => ({
                  id: line.id,
                  line_type: line.line_type,
                  child_item_id: line.child_item_id || undefined,
                  quantity: line.quantity || undefined,
                  unit: line.unit || undefined,
                  specific_child: line.specific_child || null,
                  labor_role: line.labor_role || undefined,
                  minutes: line.minutes || undefined,
                })),
                notes: item.notes || "",
                isExpanded: false,
                cost_per_gram: costPerGram,
                each_grams: item.each_grams || null,
              };
            });

          setItems(itemsWithRecipes);
          setOriginalItems(JSON.parse(JSON.stringify(itemsWithRecipes)));
        } catch (refreshError) {
          console.error("Failed to refresh data after error:", refreshError);
          // データ再取得失敗はログに記録するが、エラーは再スローしない
        }

        // エラーを再スローして、既存のエラーハンドリングを維持
        throw error;
      }

      // アイテムの更新を実行（レシピライン更新後）
      for (const itemUpdate of itemsToUpdate) {
        await itemsAPI.update(itemUpdate.id, itemUpdate.data);
      }

      // Deprecate処理
      const deprecatedItemIds: string[] = [];
      for (const item of items) {
        if (item.isMarkedForDeletion && !item.isNew) {
          // 削除ではなくdeprecateを使用
          await itemsAPI.deprecate(item.id);
          deprecatedItemIds.push(item.id);
        }
      }

      // 変更履歴をlocalStorageに保存（Itemsがdeprecateされた場合）
      if (deprecatedItemIds.length > 0) {
        saveChangeHistory({ changed_item_ids: deprecatedItemIds });
      }

      // データを再取得
      const preppedItems = await itemsAPI.getAll({ item_kind: "prepped" });
      // 全アイテムを再取得（ingredient選択用）
      const allItems = await itemsAPI.getAll();
      setAvailableItems(allItems);

      // 全アイテムのコストを計算（フル計算）
      // 注意: 差分更新は使用せず、常に全アイテムのコストを計算します
      let costsMap: Record<string, number> = {};
      let affectedItemIds: string[] = [];
      try {
        const itemIds = preppedItems.map((item) => item.id);
        if (itemIds.length > 0) {
          const costsData = await costAPI.getCosts(itemIds);
          costsMap = costsData.costs;
          affectedItemIds = itemIds; // 全アイテム
        }
      } catch (error) {
        console.error("Failed to calculate costs:", error);
      }

      // 影響を受けるアイテムのレシピのみを取得（最適化）
      let recipesMap: Record<string, APIRecipeLine[]> = {};
      try {
        if (affectedItemIds.length > 0) {
          const recipesData = await recipeLinesAPI.getByItemIds(
            affectedItemIds
          );
          recipesMap = recipesData.recipes;
        }
      } catch (error) {
        console.error("Failed to fetch recipes:", error);
        // フォールバック: 全アイテムのレシピを取得
        try {
          const itemIds = preppedItems.map((item) => item.id);
          if (itemIds.length > 0) {
            const recipesData = await recipeLinesAPI.getByItemIds(itemIds);
            recipesMap = recipesData.recipes;
          }
        } catch (fallbackError) {
          console.error("Failed to fetch recipes (fallback):", fallbackError);
        }
      }

      // 各アイテムのデータを構築
      const itemsWithRecipes: PreppedItem[] = preppedItems
        .filter((item) => {
          // 直接deprecatedアイテムは除外
          return item.deprecation_reason !== "direct";
        })
        .map((item) => {
          // 影響を受けるアイテムのレシピは新しく取得したもの、影響を受けていないアイテムのレシピは既存のitemsステートから取得
          let recipeLines: APIRecipeLine[] = [];
          if (recipesMap[item.id]) {
            // 新しく取得したレシピを使用
            recipeLines = recipesMap[item.id];
          } else {
            // 既存のcurrentItemsから取得（影響を受けていないアイテムのレシピは変更されていない）
            const existingItem = currentItems.find((i) => i.id === item.id);
            if (existingItem) {
              recipeLines = existingItem.recipe_lines.map((line) => ({
                id: line.id,
                line_type: line.line_type,
                child_item_id: line.child_item_id || undefined,
                quantity: line.quantity || undefined,
                unit: line.unit || undefined,
                specific_child: line.specific_child || null,
                labor_role: line.labor_role || undefined,
                minutes: line.minutes || undefined,
              })) as APIRecipeLine[];
            }
          }
          // 影響を受けるアイテムのコストは新しく計算したもの、影響を受けていないアイテムのコストは既存のcurrentItemsから取得
          let costPerGram: number | undefined = costsMap[item.id];
          if (costPerGram === undefined) {
            // 既存のcurrentItemsから取得（影響を受けていないアイテムのコストは変更されていない）
            const existingItem = currentItems.find((i) => i.id === item.id);
            if (existingItem) {
              costPerGram = existingItem.cost_per_gram;
            }
          }

          return {
            id: item.id,
            name: item.name,
            item_kind: "prepped",
            is_menu_item: item.is_menu_item,
            proceed_yield_amount: item.proceed_yield_amount || 0,
            proceed_yield_unit: item.proceed_yield_unit || "g",
            recipe_lines: recipeLines.map((line) => ({
              id: line.id,
              line_type: line.line_type,
              child_item_id: line.child_item_id || undefined,
              quantity: line.quantity || undefined,
              unit: line.unit || undefined,
              specific_child: line.specific_child || null,
              labor_role: line.labor_role || undefined,
              minutes: line.minutes || undefined,
            })),
            notes: item.notes || "",
            isExpanded: false,
            cost_per_gram: costPerGram,
            each_grams: item.each_grams || null,
            wholesale: item.wholesale || null,
            retail: item.retail || null,
            deprecated: item.deprecated || null,
            deprecation_reason: item.deprecation_reason || null,
          };
        });

      setItems(itemsWithRecipes);
      setOriginalItems(JSON.parse(JSON.stringify(itemsWithRecipes)));

      // costBreakdownを更新（Labor%、COG%、LCOG%の計算に必要）
      try {
        const breakdownData = await costAPI.getCostsBreakdown();
        setCostBreakdown(breakdownData.costs);
      } catch (breakdownError) {
        console.error(
          "Failed to fetch cost breakdown after save:",
          breakdownError
        );
        // costBreakdownの更新失敗は警告のみ（コスト表示には影響しないが、パーセンテージ計算に影響する）
      }

      setIsEditModeCosting(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // サイクル検出エラーはユーザーに既に通知済みのため、コンソール出力をスキップ
      if (
        !message.includes("Cycle detected") &&
        !message.includes("circular dependency")
      ) {
        console.error("Failed to save:", error);
      }
      alert(`保存に失敗しました: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // Save処理（ボタン用）
  const handleSaveClick = async () => {
    console.log("[DEBUG] handleSaveClick呼び出し", {
      itemsCount: items.length,
      timestamp: new Date().toISOString(),
    });
    await performSave(items);
  };

  // アイテムの展開/折りたたみ
  const toggleExpand = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const isExpanding = !item.isExpanded;
    setItems(
      items.map((i) => (i.id === id ? { ...i, isExpanded: !i.isExpanded } : i))
    );

    if (isExpanding && !item.isNew) {
      // 展開時に色を割り当て（新規追加アイテムは除外）
      // 既に色が割り当てられている場合は再計算しない
      setExpandedItemColors((prevColors) => {
        if (prevColors.has(id)) {
          // 既に色が割り当てられている場合は何もしない
          return prevColors;
        }
        // 展開順に基づいて色を割り当て
        const currentExpandedCount = Array.from(prevColors.values()).length;
        const colorIndex = currentExpandedCount % 4; // 0-3を循環
        const newMap = new Map(prevColors);
        newMap.set(id, colorIndex);
        setExpandedOrder((prev) => [...prev, id]);
        return newMap;
      });
    } else if (!isExpanding) {
      // 閉じる時は色を削除して元の背景色に戻す
      setExpandedItemColors((prevColors) => {
        const newMap = new Map(prevColors);
        newMap.delete(id);
        return newMap;
      });
      setExpandedOrder((prev) => prev.filter((itemId) => itemId !== id));
    }
  };

  // アイテム更新
  const handleItemChange = (
    id: string,
    field: keyof PreppedItem,
    value: string | number | boolean | null
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

  // 選択されたItemに基づいて利用可能な単位を取得
  const getAvailableUnitsForItem = (itemId: string): string[] => {
    if (!itemId) {
      return []; // Itemが選択されていない場合は空配列
    }

    const selectedItem = availableItems.find((i) => i.id === itemId);
    if (!selectedItem) {
      return []; // Itemが見つからない場合は空配列
    }

    // Prepped Itemの場合
    if (selectedItem.item_kind === "prepped") {
      // Yieldが"each"の場合
      if (selectedItem.proceed_yield_unit === "each") {
        // 質量単位 + "each"が選択可能（順番を制御）
        // each_gramsがあるので、質量単位でも問題なく計算できる
        return [...MASS_UNITS_ORDERED, "each"];
      }
      // Yieldが"g"の場合
      return MASS_UNITS_ORDERED; // 質量単位のみ選択可能
    }

    // Raw Itemの場合
    if (selectedItem.item_kind === "raw") {
      if (!selectedItem.base_item_id) {
        return MASS_UNITS_ORDERED; // デフォルトは質量単位のみ
      }

      // base_itemを取得
      const baseItem = baseItems.find(
        (b) => b.id === selectedItem.base_item_id
      );
      if (!baseItem) {
        return MASS_UNITS_ORDERED; // デフォルトは質量単位のみ
      }

      // vendor_productを取得（purchase_unitを取得するため）
      const vendorProduct = vendorProducts.find(
        (vp) => vp.base_item_id === selectedItem.base_item_id
      );
      if (!vendorProduct) {
        return MASS_UNITS_ORDERED; // デフォルトは質量単位のみ
      }

      const purchaseUnit = vendorProduct.purchase_unit;

      // 非質量単位（gallon, liter, floz, ml）で登録されている場合
      if (
        purchaseUnit &&
        isNonMassUnit(purchaseUnit) &&
        purchaseUnit !== "each"
      ) {
        // すべての単位が選択可能（順番を制御）
        return [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED];
      }

      // eachで登録されている場合
      if (purchaseUnit === "each") {
        // 質量単位 + "each"が選択可能（順番を制御）
        return [...MASS_UNITS_ORDERED, "each"];
      }

      // 質量単位で登録されている場合
      // 質量単位のみ選択可能
      return MASS_UNITS_ORDERED;
    }

    return [];
  };

  // レシピライン更新
  const handleRecipeLineChange = (
    itemId: string,
    lineId: string,
    field: keyof RecipeLine,
    value: string | number | null
  ) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: item.recipe_lines.map((line) => {
                if (line.id === lineId) {
                  const updatedLine = { ...line, [field]: value };

                  // child_item_idが変更された場合、unitとspecific_childをリセット
                  if (field === "child_item_id") {
                    const availableUnits = getAvailableUnitsForItem(
                      value as string
                    );
                    // 利用可能な単位の最初のものをデフォルトとして設定
                    updatedLine.unit =
                      availableUnits.length > 0 ? availableUnits[0] : "g";
                    // specific_childを設定: Raw Itemなら"lowest"、Prepped Itemならnull
                    const selectedItem = availableItems.find(
                      (i) => i.id === value
                    );
                    updatedLine.specific_child =
                      selectedItem?.item_kind === "raw" ? "lowest" : null;
                  }

                  return updatedLine;
                }
                return line;
              }),
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
      proceed_yield_amount: 0,
      proceed_yield_unit: "g",
      recipe_lines: [],
      notes: "",
      isExpanded: true,
      isNew: true,
      each_grams: null,
    };
    setItems([...items, newItem]);
  };

  // Addボタンクリック（モーダルを開く）
  const handleAddButtonClick = () => {
    setIsAddModalOpen(true);
  };

  // モーダルで新規アイテムを作成
  const handleAddModalSave = async (newItem: PreppedItem) => {
    // アイテムをstateに追加
    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    setIsAddModalOpen(false);

    // Editモードを有効化（performSaveが正常に動作するため）
    if (!isEditModeCosting && activeMode === "costing") {
      setIsEditModeCosting(true);
      // originalItemsを更新（新規アイテムを含む）
      setOriginalItems(JSON.parse(JSON.stringify(updatedItems)));
    }

    // performSaveを実行してAPIに保存し、コスト計算も行う
    // 更新されたitemsを引数として渡す
    await performSave(updatedItems);
  };

  // 利用可能なvendor_productsを取得（child_item_idがrawの場合）
  const getAvailableVendorProducts = (
    childItemId: string,
    currentSpecificChild?: string | null
  ): VendorProduct[] => {
    if (!childItemId) return [];

    const childItem = availableItems.find((i) => i.id === childItemId);
    if (
      !childItem ||
      childItem.item_kind !== "raw" ||
      !childItem.base_item_id
    ) {
      return [];
    }

    const matchingVendorProducts = vendorProducts.filter((vp) => {
      // Base itemが一致するものだけ
      if (vp.base_item_id !== childItem.base_item_id) {
        return false;
      }

      // Deprecatedでないものは常に表示
      if (!vp.deprecated) {
        return true;
      }

      // Deprecatedだが、現在選択されているものは表示
      if (
        currentSpecificChild &&
        currentSpecificChild !== "lowest" &&
        currentSpecificChild !== null &&
        vp.id === currentSpecificChild
      ) {
        return true;
      }

      // その他のdeprecatedは表示しない
      return false;
    });

    // vendor名（アルファベット順）→ product_name（アルファベット順）でソート
    return matchingVendorProducts.sort((a, b) => {
      const vendorA = vendors.find((v) => v.id === a.vendor_id);
      const vendorB = vendors.find((v) => v.id === b.vendor_id);
      const vendorNameA = vendorA?.name || "";
      const vendorNameB = vendorB?.name || "";

      // まずvendor名で比較
      if (vendorNameA !== vendorNameB) {
        return vendorNameA.localeCompare(vendorNameB);
      }

      // 同じvendorの場合、product_nameで比較
      const productNameA = a.product_name || a.brand_name || "";
      const productNameB = b.product_name || b.brand_name || "";
      return productNameA.localeCompare(productNameB);
    });
  };

  // vendor_productの1kgあたりのコストを計算（gあたりのコスト × 1000）
  const calculateCostPerKg = (
    vendorProduct: VendorProduct,
    childItem: Item
  ): number | null => {
    try {
      if (
        !vendorProduct.purchase_unit ||
        !vendorProduct.purchase_quantity ||
        !vendorProduct.purchase_cost
      ) {
        return null;
      }

      // 質量単位の場合
      const multiplier = MASS_UNIT_CONVERSIONS[vendorProduct.purchase_unit];
      if (multiplier) {
        const grams = vendorProduct.purchase_quantity * multiplier;
        const costPerGram = vendorProduct.purchase_cost / grams;
        return costPerGram * 1000; // kgあたりのコスト
      }

      // 非質量単位の場合
      if (!childItem.base_item_id) {
        return null;
      }

      const baseItem = baseItems.find((b) => b.id === childItem.base_item_id);
      if (!baseItem) {
        return null;
      }

      let grams: number;

      if (vendorProduct.purchase_unit === "each") {
        // eachの場合、items.each_gramsを使用
        if (!childItem.each_grams) {
          return null;
        }
        grams = vendorProduct.purchase_quantity * childItem.each_grams;
      } else if (isNonMassUnit(vendorProduct.purchase_unit)) {
        // その他の非質量単位（gallon, liter, floz, ml）
        if (!baseItem.specific_weight) {
          return null;
        }
        // g/ml × 1000 (ml/L) × リットルへの変換係数 = 購入単位あたりのグラム数
        const litersPerUnit =
          VOLUME_UNIT_TO_LITERS[vendorProduct.purchase_unit];
        if (!litersPerUnit) {
          return null;
        }
        const gramsPerSourceUnit =
          baseItem.specific_weight * 1000 * litersPerUnit;
        grams = vendorProduct.purchase_quantity * gramsPerSourceUnit;
      } else {
        return null;
      }

      const costPerGram = vendorProduct.purchase_cost / grams;
      return costPerGram * 1000; // kgあたりのコスト
    } catch {
      return null;
    }
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
                  specific_child: null,
                  isNew: true,
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
                  isNew: true,
                },
              ],
            }
          : item
      )
    );
  };

  // 検索実行
  const handleSearch = () => {
    setAppliedSearchTerm(searchTerm);
  };

  // 固定ヘッダーセクションの高さを取得
  useEffect(() => {
    // loadingが終わってから実行
    if (loading) {
      return;
    }

    const updateFixedHeaderHeight = () => {
      if (fixedHeaderRef.current) {
        const height = fixedHeaderRef.current.offsetHeight;
        setFixedHeaderHeight(height);
      } else {
        // 少し遅延させて再試行
        setTimeout(() => {
          if (fixedHeaderRef.current) {
            const height = fixedHeaderRef.current.offsetHeight;
            setFixedHeaderHeight(height);
          }
        }, 100);
      }
    };

    // 初回実行（DOM更新後に実行）
    updateFixedHeaderHeight();

    // リサイズ時に更新
    const handleResize = () => {
      updateFixedHeaderHeight();
    };
    window.addEventListener("resize", handleResize);

    // レイアウト変更を監視（ResizeObserverを使用）
    let resizeObserver: ResizeObserver | null = null;
    if (fixedHeaderRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateFixedHeaderHeight();
      });
      resizeObserver.observe(fixedHeaderRef.current);
    }

    // レイアウト変更を監視（MutationObserver）
    const mutationObserver = new MutationObserver(() => {
      updateFixedHeaderHeight();
    });
    if (fixedHeaderRef.current) {
      mutationObserver.observe(fixedHeaderRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      mutationObserver.disconnect();
    };
  }, [loading, isEditModeCosting, activeMode, searchTerm, typeFilter]);

  // availableItemsをSearchableSelect用の形式に変換
  // Ingredient選択用のフィルタリング関数
  const getAvailableItemsForSelect = (currentChildItemId?: string) => {
    return availableItems
      .filter((item) => {
        // Raw itemの場合、vendor productが存在するかチェック
        if (item.item_kind === "raw" && item.base_item_id) {
          const hasActiveVendorProduct = vendorProducts.some(
            (vp) => vp.base_item_id === item.base_item_id && !vp.deprecated
          );

          // アクティブなvendor productがない場合
          if (!hasActiveVendorProduct) {
            // 現在選択中のitemの場合のみ表示
            return item.id === currentChildItemId;
          }
        }

        // Deprecatedなitemのフィルタリング
        if (item.deprecated) {
          // 直接deprecatedは表示しない（現在選択中でも）
          if (item.deprecation_reason === "direct") {
            return item.id === currentChildItemId;
          }
          // 間接deprecatedは常に表示
          if (item.deprecation_reason === "indirect") {
            return true;
          }
        }

        // それ以外は表示
        return true;
      })
      .map((item) => ({
        id: item.id,
        name: item.name,
        disabled: !!(
          item.deprecated &&
          item.deprecation_reason === "direct" &&
          item.id === currentChildItemId
        ),
        deprecated: !!item.deprecated,
      }));
  };

  // laborRolesをSearchableSelect用の形式に変換
  // const laborRolesForSelect = laborRoles.map((role) => ({
  //   id: role.name,
  //   name: role.name,
  // })); // 未使用のためコメントアウト

  // 検索・フィルター処理
  const filteredItems = items.filter((item) => {
    // Access ControlモードではPrepped Itemsのみ表示
    if (activeMode === "access-control" && item.item_kind !== "prepped") {
      return false;
    }
    // 検索（Name）
    if (appliedSearchTerm.trim() !== "") {
      if (
        !item.name
          .toLowerCase()
          .includes(appliedSearchTerm.toLowerCase().trim())
      ) {
        return false;
      }
    }

    // フィルター（Type）
    if (typeFilter !== "all") {
      if (typeFilter === "prepped" && item.is_menu_item) {
        return false;
      }
      if (typeFilter === "menu" && !item.is_menu_item) {
        return false;
      }
    }

    return true;
  });

  // 検索クリア
  const handleClearSearch = () => {
    setSearchTerm("");
    setAppliedSearchTerm("");
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
      <div className="w-full">
        {/* 固定ヘッダーセクション（Add、Edit、Filter） */}
        <div
          ref={fixedHeaderRef}
          className={`sticky top-0 z-50 -mx-8 px-8 py-4 ${
            isDark ? "bg-slate-900" : "bg-gray-50"
          }`}
        >
          {/* タブ */}
          <div
            className={`mb-6 border-b transition-colors ${
              isDark ? "border-slate-700" : "border-gray-200"
            }`}
          >
            <nav className="flex space-x-8">
              <button
                onClick={() => handleModeChange("costing")}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeMode === "costing"
                    ? "border-blue-500 text-blue-600"
                    : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Costing
              </button>
              <button
                onClick={() => handleModeChange("access-control")}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeMode === "access-control"
                    ? "border-blue-500 text-blue-600"
                    : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Access Control
              </button>
            </nav>
          </div>

          {/* ヘッダーとEdit/Save/Cancelボタン */}
          <div className="flex justify-between items-center mb-6 gap-2">
            {/* 左側: Addボタン（Costingモードのみ）または空のdiv（Access Controlモード） */}
            {activeMode === "costing" ? (
            <button
              onClick={handleAddButtonClick}
                disabled={isEditModeCosting}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-w-[100px] ${
                  !isEditModeCosting
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : isDark
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : "bg-gray-300 text-gray-400 cursor-not-allowed"
              }`}
            >
              <Plus className="w-5 h-5" />
              Add
            </button>
            ) : (
              <div className="min-w-[100px]"></div>
            )}

            {/* Edit/Save/Cancelボタン（右側） */}
            <div className="flex items-center gap-2">
              {activeMode === "costing" ? (
                // CostingモードのEdit/Save/Cancel
                isEditModeCosting ? (
                <>
                  <button
                    onClick={handleSaveClick}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors min-w-[100px]"
                  >
                    <Save className="w-5 h-5" />
                    Save
                  </button>
                  <button
                    onClick={handleCancelClick}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-w-[100px] ${
                      isDark
                        ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    <X className="w-5 h-5" />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleEditClick}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors min-w-[100px]"
                  >
                    <Edit className="w-5 h-5" />
                    Edit
                  </button>
                )
              ) : // Access ControlモードのEdit/Save/Cancel
              isEditModeAccessControl ? (
                <>
                  <button
                    onClick={handleAccessControlSaveClick}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors min-w-[100px]"
                  >
                    <Save className="w-5 h-5" />
                    Save
                  </button>
                  <button
                    onClick={handleAccessControlCancelClick}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors min-w-[100px] ${
                      isDark
                        ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    <X className="w-5 h-5" />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleAccessControlEditClick}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors min-w-[100px]"
                >
                  <Edit className="w-5 h-5" />
                  Edit
                </button>
              )}
            </div>
          </div>

          {/* 検索・フィルターセクション */}
          <div
            className={`mb-6 rounded-lg shadow-sm border p-4 transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700"
                : "bg-white border-gray-200"
            }`}
          >
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
              {/* 検索 */}
              <div className="flex-1 w-full md:w-auto">
                <label
                  className={`block text-xs mb-1 ${
                    isDark ? "text-slate-300" : "text-gray-600"
                  }`}
                >
                  Name:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSearch();
                      }
                    }}
                    className={`flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      isDark
                        ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                    placeholder="Search by name..."
                  />
                  <button
                    onClick={handleSearch}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    title="Search"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                  {(searchTerm || appliedSearchTerm) && (
                    <button
                      onClick={handleClearSearch}
                      className={`px-4 py-2 rounded-md transition-colors ${
                        isDark
                          ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                      }`}
                      title="Clear search"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* フィルター */}
              <div className="flex-1 w-full md:w-auto">
                <div>
                  {/* Typeフィルター */}
                  <div>
                    <label
                      className={`block text-xs mb-1 ${
                        isDark ? "text-slate-300" : "text-gray-600"
                      }`}
                    >
                      Type:
                    </label>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                        isDark
                          ? "bg-slate-700 border-slate-600 text-slate-100"
                          : "bg-white border-gray-300 text-gray-900"
                      }`}
                    >
                      <option value="all">All</option>
                      <option value="prepped">Prepped</option>
                      <option value="menu">Menu Item</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* 固定ヘッダーセクション終了 */}

        {/* Add Modal */}
        {isAddModalOpen && (
          <AddItemModal
            onSave={handleAddModalSave}
            onCancel={() => setIsAddModalOpen(false)}
            isDark={isDark}
            availableItems={availableItems}
            vendorProducts={vendorProducts}
            baseItems={baseItems}
            laborRoles={laborRoles}
            vendors={vendors}
            getAvailableItemsForSelect={getAvailableItemsForSelect}
            getAvailableVendorProducts={getAvailableVendorProducts}
            getAvailableUnitsForItem={getAvailableUnitsForItem}
            calculateCostPerKg={calculateCostPerKg}
          />
        )}

        {/* アイテムリスト */}
        <div
          className={`rounded-lg shadow-sm border transition-colors ${
            isDark
              ? "bg-slate-800 border-slate-700"
              : "bg-white border-gray-200"
          }`}
        >
          <div className="w-full">
            <table
              className="w-full"
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <thead
                className={`border-b transition-colors sticky z-50 ${
                  isDark
                    ? "bg-slate-700 border-slate-600"
                    : "bg-gray-50 border-gray-200"
                }`}
                style={{
                  top: `${fixedHeaderHeight}px`,
                }}
              >
                <tr>
                  {activeMode === "access-control" ? (
                    // Access Controlモード: Name, Type, Access Control
                    <>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider sticky left-0 z-30 ${
                          isDark
                            ? "bg-slate-700 text-slate-300"
                            : "bg-gray-50 text-gray-500"
                        }`}
                        style={{ width: "300px" }}
                      >
                        Name
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "150px" }}
                      >
                        Type
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "250px" }}
                      >
                        Access Control
                      </th>
                    </>
                  ) : (
                    // Costingモード: 既存のヘッダー
                    <>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "48px" }}
                  >
                    {/* 展開アイコン用 */}
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider sticky left-0 z-30 ${
                      isDark
                        ? "bg-slate-700 text-slate-300"
                        : "bg-gray-50 text-gray-500"
                    }`}
                    style={{ width: "180px" }}
                  >
                    Name
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "120px" }}
                  >
                    Type
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "250px" }}
                  >
                    Finish Amount
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "230px" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="min-w-[70px]">Cost</span>
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-xs normal-case ${
                            costUnit === "g"
                              ? "font-semibold"
                              : isDark
                              ? "text-slate-500"
                              : "text-gray-400"
                          }`}
                        >
                          g
                        </span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={costUnit === "kg"}
                            onChange={(e) =>
                              setCostUnit(e.target.checked ? "kg" : "g")
                            }
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                        </label>
                        <span
                          className={`text-xs normal-case ${
                            costUnit === "kg"
                              ? "font-semibold"
                              : "text-gray-400"
                          }`}
                        >
                          kg
                        </span>
                      </div>
                      <button
                        onClick={() => setEachMode(!eachMode)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          eachMode
                            ? "bg-blue-500 text-white font-semibold"
                            : isDark
                            ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        }`}
                      >
                        each
                      </button>
                    </div>
                  </th>
                  {/* Wholesale */}
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider whitespace-nowrap ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "140px" }}
                  >
                    WHOLESALE ($/kg)
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    LABOR%
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    COG%
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    LCOG%
                  </th>
                  {/* Retail */}
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "120px" }}
                  >
                    RETAIL ($/kg)
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    LABOR%
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    COG%
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "100px" }}
                  >
                    LCOG%
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-gray-500"
                    }`}
                    style={{ width: "64px" }}
                  >
                    {/* ゴミ箱列のヘッダー */}
                  </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody
                className={`divide-y transition-colors ${
                  isDark
                    ? "bg-slate-800 divide-slate-600"
                    : "bg-white divide-gray-300"
                }`}
              >
                {filteredItems.map((item) => {
                  // 新規アイテムのインデックスを計算（isNew: trueのアイテムのみをカウント）
                  const newItemIndex =
                    filteredItems
                      .slice(0, filteredItems.indexOf(item) + 1)
                      .filter((i) => i.isNew).length - 1;
                  const isNewItem = item.isNew && !item.isMarkedForDeletion;
                  const newItemBgClass =
                    isNewItem && newItemIndex >= 0
                      ? newItemIndex % 2 === 0
                        ? isDark
                          ? "bg-blue-900"
                          : "bg-blue-100"
                        : isDark
                        ? "bg-blue-800"
                        : "bg-blue-50"
                      : "";

                  // 展開色を取得（新規追加アイテムは除外）
                  const expandedColorIndex = !isNewItem
                    ? expandedItemColors.get(item.id)
                    : undefined;
                  const expandedBgClass =
                    expandedColorIndex !== undefined
                      ? (() => {
                          const colors = [
                            // 色1: 緑
                            isDark ? "bg-green-900" : "bg-green-100",
                            // 色2: 黄
                            isDark ? "bg-yellow-900" : "bg-yellow-100",
                            // 色3: 紫
                            isDark ? "bg-purple-900" : "bg-purple-100",
                            // 色4: オレンジ
                            isDark ? "bg-orange-900" : "bg-orange-100",
                          ];
                          return colors[expandedColorIndex] || "";
                        })()
                      : "";

                  return (
                    <Fragment key={item.id}>
                      {activeMode === "access-control" ? (
                        // Access Controlモード: シンプルなテーブル行
                        <tr
                          className={`${
                            item.isMarkedForDeletion
                              ? isDark
                                ? "bg-red-900"
                                : "bg-red-50"
                              : isDark
                              ? hoveredItemId === item.id
                                ? "bg-slate-700"
                                : "hover:bg-slate-700"
                              : hoveredItemId === item.id
                              ? "bg-gray-50"
                              : "hover:bg-gray-50"
                          } transition-colors`}
                          onMouseEnter={() => setHoveredItemId(item.id)}
                          onMouseLeave={() => setHoveredItemId(null)}
                          style={{
                            height: "51px",
                            minHeight: "51px",
                            maxHeight: "51px",
                          }}
                        >
                          {/* Name */}
                          <td
                            className={`px-6 whitespace-nowrap sticky left-0 z-30 transition-colors ${
                              item.isMarkedForDeletion
                                ? isDark
                                  ? "bg-red-900/30"
                                  : "bg-red-50"
                                : isDark
                                ? hoveredItemId === item.id
                                  ? "bg-slate-700"
                                  : "bg-slate-800 group-hover:bg-slate-700"
                                : hoveredItemId === item.id
                                ? "bg-gray-50"
                                : "bg-white group-hover:bg-gray-50"
                            } ${isDark ? "text-slate-100" : "text-gray-900"}`}
                            style={{
                              width: "300px",
                              paddingTop: "16px",
                              paddingBottom: "16px",
                              boxSizing: "border-box",
                            }}
                          >
                            <div className="text-sm">{item.name}</div>
                          </td>

                          {/* Type */}
                          <td
                            className={`px-6 whitespace-nowrap text-left ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                            style={{
                              width: "150px",
                              paddingTop: "16px",
                              paddingBottom: "16px",
                              boxSizing: "border-box",
                            }}
                          >
                            <div className="text-sm">
                              {item.is_menu_item ? "Menu Item" : "Prepped"}
                            </div>
                          </td>

                          {/* Access Control */}
                          <td
                            className={`px-6 whitespace-nowrap text-left ${
                              isDark ? "text-slate-100" : "text-gray-900"
                            }`}
                            style={{
                              width: "250px",
                              paddingTop: "16px",
                              paddingBottom: "16px",
                              boxSizing: "border-box",
                            }}
                          >
                            {canChangeAccessControl(item) && (
                              <div
                                className="flex flex-col gap-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center gap-2">
                                  <label
                                    className={`flex items-center gap-1 cursor-pointer ${
                                      isDark
                                        ? "text-slate-300"
                                        : "text-gray-700"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`share-${item.id}`}
                                      checked={(() => {
                                        const pendingChange =
                                          pendingShareChanges.get(item.id);
                                        if (pendingChange !== undefined) {
                                          return pendingChange === "hide";
                                        }
                                        const share = itemShares.get(item.id);
                                        // hide = レコードがない、またはallowed_actionsが空
                                        return (
                                          share === null ||
                                          share === undefined ||
                                          (share.allowed_actions &&
                                            share.allowed_actions.length === 0)
                                        );
                                      })()}
                                      onChange={() =>
                                        handleShareChangePending(
                                          item.id,
                                          "hide"
                                        )
                                      }
                                      disabled={!isEditModeAccessControl}
                                      className="w-3 h-3 accent-blue-500"
                                      style={{ accentColor: "#3b82f6" }}
                                    />
                                    <span className="text-xs">Hide</span>
                                  </label>
                                  <label
                                    className={`flex items-center gap-1 cursor-pointer ${
                                      isDark
                                        ? "text-slate-300"
                                        : "text-gray-700"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`share-${item.id}`}
                                      checked={(() => {
                                        const pendingChange =
                                          pendingShareChanges.get(item.id);
                                        if (pendingChange !== undefined) {
                                          return pendingChange === "view-only";
                                        }
                                        const share = itemShares.get(item.id);
                                        return (
                                          share !== null &&
                                          share !== undefined &&
                                          share.allowed_actions.length === 1 &&
                                          share.allowed_actions[0] === "read"
                                        );
                                      })()}
                                      onChange={() =>
                                        handleShareChangePending(
                                          item.id,
                                          "view-only"
                                        )
                                      }
                                      disabled={!isEditModeAccessControl}
                                      className="w-3 h-3 accent-blue-500"
                                      style={{ accentColor: "#3b82f6" }}
                                    />
                                    <span className="text-xs">View</span>
                                  </label>
                                  <label
                                    className={`flex items-center gap-1 cursor-pointer ${
                                      isDark
                                        ? "text-slate-300"
                                        : "text-gray-700"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`share-${item.id}`}
                                      checked={(() => {
                                        const pendingChange =
                                          pendingShareChanges.get(item.id);
                                        if (pendingChange !== undefined) {
                                          return pendingChange === "editable";
                                        }
                                        const share = itemShares.get(item.id);
                                        return (
                                          share !== null &&
                                          share !== undefined &&
                                          share.allowed_actions.length === 2 &&
                                          share.allowed_actions.includes(
                                            "read"
                                          ) &&
                                          share.allowed_actions.includes(
                                            "update"
                                          )
                                        );
                                      })()}
                                      onChange={() =>
                                        handleShareChangePending(
                                          item.id,
                                          "editable"
                                        )
                                      }
                                      disabled={!isEditModeAccessControl}
                                      className="w-3 h-3 accent-blue-500"
                                      style={{ accentColor: "#3b82f6" }}
                                    />
                                    <span className="text-xs">Edit</span>
                                  </label>
                                </div>
                                {/* 責任者選択ドロップダウン（Adminのみ、常に表示） */}
                                {userRole === "admin" && (
                                  <div className="ml-2">
                                    <select
                                      value={
                                        pendingResponsibleUserChanges.get(
                                          item.id
                                        ) ||
                                        item.responsible_user_id ||
                                        ""
                                      }
                                      onChange={(e) => {
                                        setPendingResponsibleUserChanges(
                                          (prev) => {
                                            const next = new Map(prev);
                                            next.set(item.id, e.target.value);
                                            return next;
                                          }
                                        );
                                      }}
                                      disabled={!isEditModeAccessControl}
                                      className={`text-xs px-2 py-1 rounded ${
                                        isDark
                                          ? "bg-slate-700 text-slate-200 border-slate-600"
                                          : "bg-white text-gray-700 border-gray-300"
                                      } border ${
                                        !isEditModeAccessControl
                                          ? "opacity-50 cursor-not-allowed"
                                          : ""
                                      }`}
                                    >
                                      <option value="">Select Manager</option>
                                      {managers.map((manager) => {
                                        // 表示用のテキストを生成
                                        let displayText = "";
                                        if (manager.name) {
                                          displayText = manager.name;
                                          if (manager.email) {
                                            displayText += ` (${manager.email})`;
                                          }
                                        } else if (manager.email) {
                                          displayText = manager.email;
                                        } else {
                                          displayText = manager.user_id;
                                        }

                                        return (
                                          <option
                                            key={manager.user_id}
                                            value={manager.user_id}
                                          >
                                            {displayText}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        // Costingモード: 既存のテーブル行
                      <tr
                        className={`${item.isExpanded ? "peer" : ""} ${
                          item.isMarkedForDeletion
                            ? isDark
                              ? "bg-red-900"
                              : "bg-red-50"
                            : isNewItem
                            ? newItemBgClass
                            : expandedBgClass
                            ? expandedBgClass
                            : ""
                        } ${
                          !isNewItem && !expandedBgClass
                            ? isDark
                              ? hoveredItemId === item.id
                                ? "bg-slate-700"
                                : "hover:bg-slate-700"
                              : hoveredItemId === item.id
                              ? "bg-gray-50"
                              : "hover:bg-gray-50"
                            : ""
                        } cursor-pointer transition-colors group ${
                          item.isExpanded ? "!border-b-0" : ""
                        }`}
                        onMouseEnter={() => setHoveredItemId(item.id)}
                        onMouseLeave={() => setHoveredItemId(null)}
                          onClick={() =>
                            !(isEditModeCosting && activeMode === "costing") &&
                            toggleExpand(item.id)
                          }
                        style={{
                          height: "51px",
                          minHeight: "51px",
                          maxHeight: "51px",
                          ...(item.isExpanded
                            ? {
                                borderBottomWidth: 0,
                                borderBottomStyle: "none",
                              }
                            : {}),
                        }}
                      >
                        {/* 展開アイコン */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "48px",
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(item.id);
                            }}
                            className={`transition-colors ${
                              isDark
                                ? "text-slate-500 hover:text-slate-300"
                                : "text-gray-400 hover:text-gray-600"
                            }`}
                          >
                            {item.isExpanded ? (
                              <ChevronDown className="w-5 h-5" />
                            ) : (
                              <ChevronRight className="w-5 h-5" />
                            )}
                          </button>
                        </td>

                        {/* Name */}
                        <td
                          className={`px-6 whitespace-nowrap sticky left-0 z-30 transition-colors ${
                            item.isMarkedForDeletion
                              ? isDark
                                ? "bg-red-900/30"
                                : "bg-red-50"
                              : isNewItem
                              ? newItemBgClass
                              : expandedBgClass
                              ? expandedBgClass
                              : isDark
                              ? hoveredItemId === item.id
                                ? "bg-slate-700"
                                : "bg-slate-800 group-hover:bg-slate-700 peer-hover:bg-slate-700"
                              : hoveredItemId === item.id
                              ? "bg-gray-50"
                              : "bg-white group-hover:bg-gray-50 peer-hover:bg-gray-50"
                          } ${isDark ? "text-slate-100" : "text-gray-900"}`}
                          style={{
                            width: "180px",
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
                              {isEditModeCosting && activeMode === "costing" ? (
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) =>
                                  handleItemChange(
                                    item.id,
                                    "name",
                                    e.target.value
                                  )
                                }
                                className={`w-full text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                    : "bg-white border-gray-300 text-gray-900"
                                }`}
                                placeholder="Item name"
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
                                className="flex items-center gap-2"
                                style={{
                                  height: "20px",
                                  minHeight: "20px",
                                  maxHeight: "20px",
                                }}
                              >
                                <div
                                  className={`text-sm ${
                                      isDark
                                        ? "text-slate-100"
                                        : "text-gray-900"
                                  }`}
                                    style={{
                                      lineHeight: "20px",
                                      height: "20px",
                                    }}
                                >
                                  {item.name}
                                </div>
                                {/* Deprecated marker (間接deprecatedのみ) */}
                                {item.deprecation_reason === "indirect" && (
                                  <span
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300"
                                    title={`Affected by deprecated ingredient${
                                      item.deprecated
                                        ? ` (since ${new Date(
                                            item.deprecated
                                          ).toLocaleDateString()})`
                                        : ""
                                    }`}
                                  >
                                    ⚠ Affected
                                  </span>
                                )}
                                {/* 共有アイコン（Manager向け） */}
                                {userRole === "manager" &&
                                  item.item_kind === "prepped" &&
                                  currentUserId &&
                                  item.user_id !== currentUserId && (
                                    <Share2
                                      className={`w-4 h-4 ${
                                          isDark
                                            ? "text-blue-400"
                                            : "text-blue-600"
                                      }`}
                                    />
                                  )}
                                  {/* 共有設定ラジオボタン（Admin向け、Prepped Itemsのみ、Costingモードでは非表示） */}
                                  {userRole === "admin" &&
                                    item.item_kind === "prepped" &&
                                    activeMode === "costing" && (
                                  <div
                                    className="flex items-center gap-1 ml-2"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                        {/* Costingモードでは非表示 */}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Type */}
                        <td
                          className="px-6 whitespace-nowrap text-left"
                          style={{
                            width: "120px",
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
                              {isEditModeCosting && activeMode === "costing" ? (
                              <select
                                value={item.is_menu_item ? "menu" : "prepped"}
                                onChange={(e) =>
                                  handleItemChange(
                                    item.id,
                                    "is_menu_item",
                                    e.target.value === "menu"
                                  )
                                }
                                className={`w-full text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                    : "bg-white border-gray-300 text-gray-900"
                                }`}
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
                              >
                                <option value="prepped">Prepped</option>
                                <option value="menu">Menu Item</option>
                              </select>
                            ) : (
                              <div
                                className={`text-sm ${
                                  isDark ? "text-slate-100" : "text-gray-900"
                                }`}
                                style={{
                                  lineHeight: "20px",
                                  height: "20px",
                                  minHeight: "20px",
                                  maxHeight: "20px",
                                }}
                              >
                                {item.is_menu_item ? "Menu Item" : "Prepped"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Proceed */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "250px",
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
                              {isEditModeCosting && activeMode === "costing" ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    yieldAmountInputs.has(item.id)
                                      ? yieldAmountInputs.get(item.id)!
                                      : item.proceed_yield_amount === 0
                                      ? ""
                                      : String(item.proceed_yield_amount)
                                  }
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                    if (numericPattern.test(value)) {
                                      setYieldAmountInputs((prev) => {
                                        const newMap = new Map(prev);
                                        newMap.set(item.id, value);
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
                                    handleItemChange(
                                      item.id,
                                      "proceed_yield_amount",
                                      numValue
                                    );
                                    // 入力中の文字列をクリア
                                    setYieldAmountInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(item.id);
                                      return newMap;
                                    });
                                  }}
                                  className={`text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100"
                                      : "bg-white border-gray-300 text-gray-900"
                                  }`}
                                  placeholder="0"
                                  style={{
                                    width: "70px",
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
                                <select
                                  value={item.proceed_yield_unit}
                                  onChange={(e) =>
                                    handleItemChange(
                                      item.id,
                                      "proceed_yield_unit",
                                      e.target.value
                                    )
                                  }
                                  className={`text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100"
                                      : "bg-white border-gray-300 text-gray-900"
                                  }`}
                                  style={{
                                    width: "60px",
                                    height: "20px",
                                    minHeight: "20px",
                                    maxHeight: "20px",
                                    lineHeight: "20px",
                                    padding: "0 4px",
                                    fontSize: "0.875rem",
                                    boxSizing: "border-box",
                                    margin: 0,
                                  }}
                                >
                                  {yieldUnitOptions.map((unit) => (
                                    <option key={unit} value={unit}>
                                      {unit}
                                    </option>
                                  ))}
                                </select>
                                {/* Yield Unitが"each"の場合、右側に入力ボックスを表示 */}
                                {item.proceed_yield_unit === "each" && (
                                  <>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={
                                        eachGramsInputs.has(item.id)
                                          ? eachGramsInputs.get(item.id)!
                                          : item.each_grams === null ||
                                            item.each_grams === undefined ||
                                            item.each_grams === 0
                                          ? ""
                                          : String(item.each_grams)
                                      }
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        // 数字と小数点のみを許可（空文字列も許可）
                                        const numericPattern =
                                          /^(\d+\.?\d*|\.\d+)?$/;
                                        if (numericPattern.test(value)) {
                                          setEachGramsInputs((prev) => {
                                            const newMap = new Map(prev);
                                            newMap.set(item.id, value);
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
                                            ? null
                                            : parseFloat(value) || null;
                                        handleItemChange(
                                          item.id,
                                          "each_grams",
                                          numValue
                                        );
                                        // 入力中の文字列をクリア
                                        setEachGramsInputs((prev) => {
                                          const newMap = new Map(prev);
                                          newMap.delete(item.id);
                                          return newMap;
                                        });
                                      }}
                                      placeholder={(() => {
                                        const totalIngredientsGrams =
                                          calculateTotalIngredientsGrams(
                                            item.recipe_lines
                                          );
                                        const yieldAmount =
                                          item.proceed_yield_amount || 1;
                                        const defaultEachGrams =
                                          totalIngredientsGrams / yieldAmount;
                                        return `Auto (${defaultEachGrams.toFixed(
                                          2
                                        )}g)`;
                                      })()}
                                      className={`text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                        isDark
                                          ? "bg-slate-700 border-slate-600 text-slate-100"
                                          : "bg-white border-gray-300 text-gray-900"
                                      }`}
                                      style={{
                                        width: "70px",
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
                                    <span
                                      className={`text-sm ${
                                        isDark
                                          ? "text-slate-300"
                                          : "text-gray-600"
                                      }`}
                                    >
                                      g/each
                                    </span>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-2"
                                style={{ height: "20px" }}
                              >
                                <span
                                  className={`text-sm ${
                                      isDark
                                        ? "text-slate-100"
                                        : "text-gray-900"
                                  }`}
                                  style={{ lineHeight: "20px" }}
                                >
                                  {item.proceed_yield_amount}{" "}
                                  {item.proceed_yield_unit}
                                </span>
                                {/* Yield Unitが"each"の場合、each_gramsを表示 */}
                                {item.proceed_yield_unit === "each" && (
                                  <span
                                    className="text-xs text-gray-500"
                                    style={{ lineHeight: "20px" }}
                                  >
                                    {(() => {
                                      const eachGrams =
                                        item.each_grams ||
                                        (() => {
                                          const totalIngredientsGrams =
                                            calculateTotalIngredientsGrams(
                                              item.recipe_lines
                                            );
                                          const yieldAmount =
                                            item.proceed_yield_amount || 1;
                                          return (
                                              totalIngredientsGrams /
                                              yieldAmount
                                          );
                                        })();
                                      return `(${eachGrams.toFixed(
                                        2
                                      )}g / each)`;
                                    })()}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Cost/g or Cost/kg */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "230px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {item.cost_per_gram !== undefined
                                ? eachMode &&
                                  item.proceed_yield_unit === "each" &&
                                  item.each_grams
                                  ? `$${(
                                      item.cost_per_gram * item.each_grams
                                    ).toFixed(2)}/each`
                                  : costUnit === "g"
                                  ? `$${item.cost_per_gram.toFixed(6)}/g`
                                  : `$${(item.cost_per_gram * 1000).toFixed(
                                      2
                                    )}/kg`
                                : "-"}
                            </div>
                          </div>
                        </td>

                        {/* Wholesale */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "140px",
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
                              {isEditModeCosting && activeMode === "costing" ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={
                                  wholesaleInputs.has(item.id)
                                    ? wholesaleInputs.get(item.id)!
                                    : item.wholesale === null ||
                                      item.wholesale === undefined
                                    ? ""
                                    : eachMode &&
                                      item.proceed_yield_unit === "each" &&
                                      item.each_grams
                                    ? String(
                                        (item.wholesale / 1000) *
                                          item.each_grams
                                      ) // $/kg → $/each
                                    : String(item.wholesale)
                                }
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                  if (numericPattern.test(value)) {
                                    setWholesaleInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.set(item.id, value);
                                      return newMap;
                                    });
                                  }
                                  // マッチしない場合は何もしない（前の値を保持）
                                }}
                                onBlur={(e) => {
                                  const value = e.target.value;
                                  // フォーカスアウト時に数値に変換
                                  let numValue =
                                    value === "" || value === "."
                                      ? null
                                      : parseFloat(value) || null;
                                  // eachモード選択時、proceed_yield_unit === "each"のアイテムは$/eachで入力されているため、$/kgに変換
                                  if (
                                    numValue !== null &&
                                    eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.each_grams > 0
                                  ) {
                                    numValue =
                                      (numValue / item.each_grams) * 1000; // $/each → $/kg
                                  }
                                  handleItemChange(
                                    item.id,
                                    "wholesale",
                                    numValue
                                  );
                                  // 入力中の文字列をクリア
                                  setWholesaleInputs((prev) => {
                                    const newMap = new Map(prev);
                                    newMap.delete(item.id);
                                    return newMap;
                                  });
                                }}
                                className={`w-full text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                    : "bg-white border-gray-300 text-gray-900"
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
                            ) : (
                              <div
                                className={`text-sm ${
                                  isDark ? "text-slate-100" : "text-gray-900"
                                }`}
                                style={{
                                  lineHeight: "20px",
                                  height: "20px",
                                  minHeight: "20px",
                                  maxHeight: "20px",
                                }}
                              >
                                {item.wholesale !== null &&
                                item.wholesale !== undefined
                                  ? eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams
                                    ? `$${(
                                        (item.wholesale / 1000) *
                                        item.each_grams
                                      ).toFixed(2)}/each`
                                    : `$${item.wholesale.toFixed(2)}/kg`
                                  : "-"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Wholesale Labor% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                const currentWholesale = wholesaleInputs.has(
                                  item.id
                                )
                                  ? (() => {
                                      const value = wholesaleInputs.get(
                                        item.id
                                      )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.wholesale !== null &&
                                    item.wholesale !== undefined
                                  ? (item.wholesale / 1000) * item.each_grams // $/kg → $/each
                                  : item.wholesale;
                                const { laborPercent } = calculatePercentages(
                                  currentWholesale,
                                  item
                                );
                                return laborPercent !== null
                                  ? `${laborPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* Wholesale COG% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                const currentWholesale = wholesaleInputs.has(
                                  item.id
                                )
                                  ? (() => {
                                      const value = wholesaleInputs.get(
                                        item.id
                                      )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.wholesale !== null &&
                                    item.wholesale !== undefined
                                  ? (item.wholesale / 1000) * item.each_grams // $/kg → $/each
                                  : item.wholesale;
                                const { cogPercent } = calculatePercentages(
                                  currentWholesale,
                                  item
                                );
                                return cogPercent !== null
                                  ? `${cogPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* Wholesale LCOG% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                const currentWholesale = wholesaleInputs.has(
                                  item.id
                                )
                                  ? (() => {
                                      const value = wholesaleInputs.get(
                                        item.id
                                      )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.wholesale !== null &&
                                    item.wholesale !== undefined
                                  ? (item.wholesale / 1000) * item.each_grams // $/kg → $/each
                                  : item.wholesale;
                                const { lcogPercent } = calculatePercentages(
                                  currentWholesale,
                                  item
                                );
                                return lcogPercent !== null
                                  ? `${lcogPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* Retail */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "120px",
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
                              {isEditModeCosting && activeMode === "costing" ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={
                                  retailInputs.has(item.id)
                                    ? retailInputs.get(item.id)!
                                    : item.retail === null ||
                                      item.retail === undefined
                                    ? ""
                                    : eachMode &&
                                      item.proceed_yield_unit === "each" &&
                                      item.each_grams
                                    ? String(
                                        (item.retail / 1000) * item.each_grams
                                      ) // $/kg → $/each
                                    : String(item.retail)
                                }
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                  if (numericPattern.test(value)) {
                                    setRetailInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.set(item.id, value);
                                      return newMap;
                                    });
                                  }
                                  // マッチしない場合は何もしない（前の値を保持）
                                }}
                                onBlur={(e) => {
                                  const value = e.target.value;
                                  // フォーカスアウト時に数値に変換
                                  let numValue =
                                    value === "" || value === "."
                                      ? null
                                      : parseFloat(value) || null;
                                  // eachモード選択時、proceed_yield_unit === "each"のアイテムは$/eachで入力されているため、$/kgに変換
                                  if (
                                    numValue !== null &&
                                    eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.each_grams > 0
                                  ) {
                                    numValue =
                                      (numValue / item.each_grams) * 1000; // $/each → $/kg
                                  }
                                    handleItemChange(
                                      item.id,
                                      "retail",
                                      numValue
                                    );
                                  // 入力中の文字列をクリア
                                  setRetailInputs((prev) => {
                                    const newMap = new Map(prev);
                                    newMap.delete(item.id);
                                    return newMap;
                                  });
                                }}
                                className={`w-full text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                    : "bg-white border-gray-300 text-gray-900"
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
                            ) : (
                              <div
                                className={`text-sm ${
                                  isDark ? "text-slate-100" : "text-gray-900"
                                }`}
                                style={{
                                  lineHeight: "20px",
                                  height: "20px",
                                  minHeight: "20px",
                                  maxHeight: "20px",
                                }}
                              >
                                {item.retail !== null &&
                                item.retail !== undefined
                                  ? eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams
                                    ? `$${(
                                        (item.retail / 1000) *
                                        item.each_grams
                                      ).toFixed(2)}/each`
                                    : `$${item.retail.toFixed(2)}/kg`
                                  : "-"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Retail Labor% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                  const currentRetail = retailInputs.has(
                                    item.id
                                  )
                                  ? (() => {
                                        const value = retailInputs.get(
                                          item.id
                                        )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.retail !== null &&
                                    item.retail !== undefined
                                  ? (item.retail / 1000) * item.each_grams // $/kg → $/each
                                  : item.retail;
                                const { laborPercent } = calculatePercentages(
                                  currentRetail,
                                  item
                                );
                                return laborPercent !== null
                                  ? `${laborPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* Retail COG% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                  const currentRetail = retailInputs.has(
                                    item.id
                                  )
                                  ? (() => {
                                        const value = retailInputs.get(
                                          item.id
                                        )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.retail !== null &&
                                    item.retail !== undefined
                                  ? (item.retail / 1000) * item.each_grams // $/kg → $/each
                                  : item.retail;
                                const { cogPercent } = calculatePercentages(
                                  currentRetail,
                                  item
                                );
                                return cogPercent !== null
                                  ? `${cogPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* Retail LCOG% */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "100px",
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
                            <div
                              className={`text-sm ${
                                isDark ? "text-slate-100" : "text-gray-900"
                              }`}
                              style={{ lineHeight: "20px", height: "20px" }}
                            >
                              {(() => {
                                // 入力中の値があればそれを使用、なければ既存の値を使用
                                  const currentRetail = retailInputs.has(
                                    item.id
                                  )
                                  ? (() => {
                                        const value = retailInputs.get(
                                          item.id
                                        )!;
                                      return value === "" || value === "."
                                        ? null
                                        : parseFloat(value) || null;
                                    })()
                                  : eachMode &&
                                    item.proceed_yield_unit === "each" &&
                                    item.each_grams &&
                                    item.retail !== null &&
                                    item.retail !== undefined
                                  ? (item.retail / 1000) * item.each_grams // $/kg → $/each
                                  : item.retail;
                                const { lcogPercent } = calculatePercentages(
                                  currentRetail,
                                  item
                                );
                                return lcogPercent !== null
                                  ? `${lcogPercent.toFixed(2)}%`
                                  : "-";
                              })()}
                            </div>
                          </div>
                        </td>

                        {/* ゴミ箱（Editモード時のみ表示） */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            width: "64px",
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
                        >
                            {isEditModeCosting && activeMode === "costing" && (
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
                      )}

                      {/* 展開されたレシピとLaborセクション（Costingモードのみ） */}
                      {activeMode === "costing" && item.isExpanded && (
                        <tr
                          style={{ borderTopWidth: 0, borderTopStyle: "none" }}
                          className={`transition-colors ${
                            isNewItem
                              ? newItemBgClass
                              : expandedBgClass
                              ? expandedBgClass
                              : isDark
                              ? hoveredItemId === item.id
                                ? "bg-slate-700"
                                : "hover:bg-slate-700 peer-hover:bg-slate-700"
                              : hoveredItemId === item.id
                              ? "bg-gray-50"
                              : "hover:bg-gray-50 peer-hover:bg-gray-50"
                          }`}
                          onMouseEnter={() =>
                            !isNewItem &&
                            !expandedBgClass &&
                            setHoveredItemId(item.id)
                          }
                          onMouseLeave={() =>
                            !isNewItem &&
                            !expandedBgClass &&
                            setHoveredItemId(null)
                          }
                        >
                          <td
                            colSpan={14}
                            className={`py-4 transition-colors ${
                              isNewItem
                                ? newItemBgClass
                                : expandedBgClass
                                ? expandedBgClass
                                : isDark
                                ? hoveredItemId === item.id
                                  ? "bg-slate-700"
                                  : "bg-slate-800 peer-hover:bg-slate-700"
                                : hoveredItemId === item.id
                                ? "bg-gray-50"
                                : "bg-white peer-hover:bg-gray-50"
                            }`}
                            style={{
                              width: "100%",
                              paddingLeft: 0,
                              paddingRight: 0,
                            }}
                          >
                            <div
                              className={`space-y-6 px-6 ${
                                expandedBgClass || ""
                              }`}
                              style={{
                                width: "100%",
                                minWidth: "100%",
                              }}
                            >
                              {/* Recipeセクション */}
                              <div>
                                <h3
                                  className={`text-sm font-semibold mb-3 ${
                                    isDark ? "text-slate-300" : "text-gray-700"
                                  }`}
                                >
                                  Ingredients:
                                  {isEditModeCosting &&
                                    activeMode === "costing" && (
                                    <span
                                      className={`ml-4 text-sm font-normal ${
                                        isDark
                                          ? "text-slate-400"
                                          : "text-gray-600"
                                      }`}
                                    >
                                      Total:{" "}
                                      {calculateTotalIngredientsGrams(
                                        item.recipe_lines
                                      ).toFixed(2)}{" "}
                                      g
                                    </span>
                                  )}
                                </h3>
                                <table
                                  className={`w-full ${expandedBgClass || ""}`}
                                >
                                  <thead
                                    className={
                                      expandedBgClass ||
                                      (isDark ? "bg-slate-700" : "bg-gray-100")
                                    }
                                  >
                                    <tr>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Item
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Vendor Selection
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Quantity
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Unit
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium w-16 ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        {/* ゴミ箱列 */}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody
                                    className={`${
                                      expandedBgClass ||
                                      (isDark ? "bg-slate-800" : "bg-white")
                                    } divide-y ${
                                      isDark
                                        ? "divide-slate-700"
                                        : "divide-gray-200"
                                    }`}
                                  >
                                    {item.recipe_lines
                                      .filter(
                                        (line) =>
                                          line.line_type === "ingredient"
                                      )
                                      .map((line) => (
                                        <tr
                                          key={line.id}
                                          className={
                                            line.isMarkedForDeletion
                                              ? "bg-red-50"
                                              : ""
                                          }
                                          style={{
                                            height: "52px",
                                            minHeight: "52px",
                                            maxHeight: "52px",
                                          }}
                                        >
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                            activeMode === "costing" ? (
                                              <SearchableSelect
                                                options={getAvailableItemsForSelect(
                                                  line.child_item_id
                                                )}
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
                                              <div
                                                className={`text-sm ${
                                                  isDark
                                                    ? "text-slate-100"
                                                    : "text-gray-900"
                                                }`}
                                              >
                                                {availableItems.find(
                                                  (i) =>
                                                    i.id === line.child_item_id
                                                )?.name || "-"}
                                              </div>
                                            )}
                                          </td>
                                          {/* Vendor列 */}
                                          <td className="px-4 py-2">
                                            {(() => {
                                              const childItem =
                                                availableItems.find(
                                                  (i) =>
                                                    i.id === line.child_item_id
                                                );
                                              const isRawItem =
                                                childItem?.item_kind === "raw";
                                              const availableVendorProducts =
                                                getAvailableVendorProducts(
                                                  line.child_item_id || "",
                                                  line.specific_child
                                                );

                                              if (!isRawItem) {
                                                return (
                                                  <div className="text-sm text-gray-400">
                                                    -
                                                  </div>
                                                );
                                              }

                                              if (
                                                isEditModeCosting &&
                                                activeMode === "costing"
                                              ) {
                                                return (
                                                  <div className="flex items-center gap-4">
                                                    <label className="flex items-center gap-1">
                                                      <input
                                                        type="radio"
                                                        name={`vendor-${line.id}`}
                                                        checked={
                                                          line.specific_child ===
                                                            null ||
                                                          line.specific_child ===
                                                            "lowest"
                                                        }
                                                        onChange={() =>
                                                          handleRecipeLineChange(
                                                            item.id,
                                                            line.id,
                                                            "specific_child",
                                                            "lowest"
                                                          )
                                                        }
                                                        className="w-4 h-4"
                                                      />
                                                      <span className="text-sm">
                                                        Lowest
                                                      </span>
                                                    </label>
                                                    <label className="flex items-center gap-1">
                                                      <input
                                                        type="radio"
                                                        name={`vendor-${line.id}`}
                                                        checked={
                                                          line.specific_child !==
                                                            null &&
                                                          line.specific_child !==
                                                            "lowest"
                                                        }
                                                        onChange={() => {
                                                          // Specificを選択したら、最初のvendor_productを選択
                                                          if (
                                                            availableVendorProducts.length >
                                                            0
                                                          ) {
                                                            handleRecipeLineChange(
                                                              item.id,
                                                              line.id,
                                                              "specific_child",
                                                              availableVendorProducts[0]
                                                                .id
                                                            );
                                                          }
                                                        }}
                                                        className="w-4 h-4"
                                                      />
                                                      <span className="text-sm">
                                                        Specific
                                                      </span>
                                                    </label>
                                                    {line.specific_child !==
                                                      null &&
                                                      line.specific_child !==
                                                        "lowest" && (
                                                        <select
                                                          value={
                                                            line.specific_child
                                                          }
                                                          onChange={(e) =>
                                                            handleRecipeLineChange(
                                                              item.id,
                                                              line.id,
                                                              "specific_child",
                                                              e.target.value
                                                            )
                                                          }
                                                          className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                                            isDark
                                                              ? "bg-slate-700 border-slate-600 text-slate-100"
                                                              : "bg-white border-gray-300 text-gray-900"
                                                          }`}
                                                          style={{
                                                            minWidth: "200px",
                                                          }}
                                                        >
                                                          {availableVendorProducts.map(
                                                            (vp) => {
                                                              const vendor =
                                                                vendors.find(
                                                                  (v) =>
                                                                    v.id ===
                                                                    vp.vendor_id
                                                                );
                                                              const vendorName =
                                                                vendor?.name ||
                                                                "";
                                                              const productName =
                                                                vp.product_name ||
                                                                vp.brand_name ||
                                                                "";
                                                              const childItem =
                                                                availableItems.find(
                                                                  (i) =>
                                                                    i.id ===
                                                                    line.child_item_id
                                                                );
                                                              const costPerKg =
                                                                childItem
                                                                  ? calculateCostPerKg(
                                                                      vp,
                                                                      childItem
                                                                    )
                                                                  : null;
                                                              const costDisplay =
                                                                costPerKg !==
                                                                null
                                                                  ? `    $${costPerKg.toFixed(
                                                                      2
                                                                    )}/kg`
                                                                  : "";
                                                              const isDeprecated =
                                                                !!vp.deprecated;
                                                              return (
                                                                <option
                                                                  key={vp.id}
                                                                  value={vp.id}
                                                                  disabled={
                                                                    isDeprecated
                                                                  }
                                                                  style={{
                                                                    opacity:
                                                                      isDeprecated
                                                                        ? 0.5
                                                                        : 1,
                                                                    color:
                                                                      isDeprecated
                                                                        ? "#9ca3af"
                                                                        : undefined,
                                                                  }}
                                                                >
                                                                  {isDeprecated
                                                                    ? "[Deprecated] "
                                                                    : ""}
                                                                  {vendorName} -{" "}
                                                                  {productName}
                                                                  {costDisplay}
                                                                </option>
                                                              );
                                                            }
                                                          )}
                                                        </select>
                                                      )}
                                                  </div>
                                                );
                                              } else {
                                                // 表示モード
                                                if (
                                                  line.specific_child ===
                                                    null ||
                                                  line.specific_child ===
                                                    "lowest"
                                                ) {
                                                  return (
                                                    <div
                                                      className={`text-sm ${
                                                        isDark
                                                          ? "text-slate-100"
                                                          : "text-gray-900"
                                                      }`}
                                                    >
                                                      Lowest
                                                    </div>
                                                  );
                                                } else {
                                                  const selectedVendorProduct =
                                                    availableVendorProducts.find(
                                                      (vp) =>
                                                        vp.id ===
                                                        line.specific_child
                                                    );
                                                  const vendor =
                                                    selectedVendorProduct
                                                      ? vendors.find(
                                                          (v) =>
                                                            v.id ===
                                                            selectedVendorProduct.vendor_id
                                                        )
                                                      : null;
                                                  const vendorName =
                                                    vendor?.name || "";
                                                  const productName =
                                                    selectedVendorProduct?.product_name ||
                                                    selectedVendorProduct?.brand_name ||
                                                    "";
                                                  const childItem =
                                                    availableItems.find(
                                                      (i) =>
                                                        i.id ===
                                                        line.child_item_id
                                                    );
                                                  const costPerKg =
                                                    childItem &&
                                                    selectedVendorProduct
                                                      ? calculateCostPerKg(
                                                          selectedVendorProduct,
                                                          childItem
                                                        )
                                                      : null;
                                                  const costDisplay =
                                                    costPerKg !== null
                                                      ? `    $${costPerKg.toFixed(
                                                          2
                                                        )}/kg`
                                                      : "";
                                                  return (
                                                    <div className="space-y-1">
                                                      <div
                                                        className={`text-sm ${
                                                          isDark
                                                            ? "text-slate-100"
                                                            : "text-gray-900"
                                                        }`}
                                                      >
                                                        {vendorName} -{" "}
                                                        {productName}
                                                        {costDisplay}
                                                      </div>
                                                      {/* last_change history */}
                                                      {(() => {
                                                        const apiLine =
                                                          item.recipe_lines.find(
                                                            (rl) =>
                                                              rl.id === line.id
                                                          );
                                                        if (
                                                          apiLine &&
                                                          "last_change" in
                                                            apiLine &&
                                                          apiLine.last_change
                                                        ) {
                                                          return (
                                                            <div className="text-xs text-blue-600 dark:text-blue-400 italic">
                                                              History:{" "}
                                                              {
                                                                apiLine.last_change
                                                              }
                                                            </div>
                                                          );
                                                        }
                                                        return null;
                                                      })()}
                                                    </div>
                                                  );
                                                }
                                              }
                                            })()}
                                          </td>
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                            activeMode === "costing" ? (
                                              <input
                                                type="text"
                                                inputMode="decimal"
                                                value={
                                                  quantityInputs.has(line.id)
                                                    ? quantityInputs.get(
                                                        line.id
                                                      )!
                                                    : line.quantity === 0 ||
                                                      !line.quantity
                                                    ? ""
                                                    : String(line.quantity)
                                                }
                                                onChange={(e) => {
                                                  const value = e.target.value;
                                                  // 数字と小数点のみを許可（空文字列も許可）
                                                  const numericPattern =
                                                    /^(\d+\.?\d*|\.\d+)?$/;
                                                  if (
                                                    numericPattern.test(value)
                                                  ) {
                                                    setQuantityInputs(
                                                      (prev) => {
                                                        const newMap = new Map(
                                                          prev
                                                        );
                                                        newMap.set(
                                                          line.id,
                                                          value
                                                        );
                                                        return newMap;
                                                      }
                                                    );
                                                  }
                                                  // マッチしない場合は何もしない（前の値を保持）
                                                }}
                                                onBlur={(e) => {
                                                  const value = e.target.value;
                                                  // フォーカスアウト時に数値に変換
                                                  const numValue =
                                                    value === "" ||
                                                    value === "."
                                                      ? 0
                                                      : parseFloat(value) || 0;
                                                  handleRecipeLineChange(
                                                    item.id,
                                                    line.id,
                                                    "quantity",
                                                    numValue
                                                  );
                                                  // 入力中の文字列をクリア
                                                  setQuantityInputs((prev) => {
                                                    const newMap = new Map(
                                                      prev
                                                    );
                                                    newMap.delete(line.id);
                                                    return newMap;
                                                  });
                                                }}
                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                                  isDark
                                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                                    : "bg-white border-gray-300 text-gray-900"
                                                }`}
                                                placeholder="0"
                                              />
                                            ) : (
                                              <div
                                                className={`text-sm ${
                                                  isDark
                                                    ? "text-slate-100"
                                                    : "text-gray-900"
                                                }`}
                                              >
                                                {line.quantity || 0}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                            activeMode === "costing" ? (
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
                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                                  isDark
                                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                                    : "bg-white border-gray-300 text-gray-900"
                                                }`}
                                                disabled={!line.child_item_id}
                                              >
                                                {(() => {
                                                  const availableUnits =
                                                    getAvailableUnitsForItem(
                                                      line.child_item_id || ""
                                                    );
                                                  // Itemが選択されていない場合は空のオプションを表示
                                                  if (
                                                    availableUnits.length === 0
                                                  ) {
                                                    return (
                                                      <option value="">
                                                        Select item first
                                                      </option>
                                                    );
                                                  }
                                                  return availableUnits.map(
                                                    (unit) => {
                                                      // eachの場合、選択されたアイテムのeach_gramsを確認
                                                      let isEachDisabled =
                                                        false;
                                                      if (
                                                        unit === "each" &&
                                                        line.child_item_id
                                                      ) {
                                                        const selectedItem =
                                                          availableItems.find(
                                                            (i) =>
                                                              i.id ===
                                                              line.child_item_id
                                                          );
                                                        isEachDisabled =
                                                          !selectedItem?.each_grams ||
                                                          selectedItem.each_grams ===
                                                            0;
                                                      }

                                                      return (
                                                        <option
                                                          key={unit}
                                                          value={unit}
                                                          disabled={
                                                            isEachDisabled
                                                          }
                                                          title={
                                                            isEachDisabled
                                                              ? "Please set each_grams in the Base Items tab"
                                                              : ""
                                                          }
                                                        >
                                                          {unit}
                                                          {isEachDisabled &&
                                                            " (setup required)"}
                                                        </option>
                                                      );
                                                    }
                                                  );
                                                })()}
                                              </select>
                                            ) : (
                                              <div
                                                className={`text-sm ${
                                                  isDark
                                                    ? "text-slate-100"
                                                    : "text-gray-900"
                                                }`}
                                              >
                                                {line.unit || "-"}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                              activeMode === "costing" && (
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
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    <tr>
                                      <td colSpan={5} className="px-4 py-2">
                                        {isEditModeCosting &&
                                          activeMode === "costing" && (
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
                                        )}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>

                              {/* Laborセクション */}
                              <div>
                                <h3
                                  className={`text-sm font-semibold mb-3 ${
                                    isDark ? "text-slate-300" : "text-gray-700"
                                  }`}
                                >
                                  Labor:
                                </h3>
                                <table
                                  className={`w-full ${expandedBgClass || ""}`}
                                >
                                  <thead
                                    className={
                                      expandedBgClass ||
                                      (isDark ? "bg-slate-700" : "bg-gray-100")
                                    }
                                  >
                                    <tr>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Role
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        Minutes
                                      </th>
                                      <th
                                        className={`px-4 py-2 text-left text-xs font-medium w-16 ${
                                          isDark
                                            ? "text-slate-400"
                                            : "text-gray-600"
                                        }`}
                                      >
                                        {/* ゴミ箱列 */}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody
                                    className={`${
                                      expandedBgClass ||
                                      (isDark ? "bg-slate-800" : "bg-white")
                                    } divide-y ${
                                      isDark
                                        ? "divide-slate-700"
                                        : "divide-gray-200"
                                    }`}
                                  >
                                    {item.recipe_lines
                                      .filter(
                                        (line) => line.line_type === "labor"
                                      )
                                      .map((line) => (
                                        <tr
                                          key={line.id}
                                          className={
                                            line.isMarkedForDeletion
                                              ? "bg-red-50"
                                              : ""
                                          }
                                          style={{
                                            height: "52px",
                                            minHeight: "52px",
                                            maxHeight: "52px",
                                          }}
                                        >
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                            activeMode === "costing" ? (
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
                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                                  isDark
                                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                                    : "bg-white border-gray-300 text-gray-900"
                                                }`}
                                              >
                                                <option value="">
                                                  Select role...
                                                </option>
                                                {laborRoles.map((role) => (
                                                  <option
                                                    key={role.id}
                                                    value={role.name}
                                                  >
                                                    {role.name}
                                                  </option>
                                                ))}
                                              </select>
                                            ) : (
                                              <div
                                                className={`text-sm ${
                                                  isDark
                                                    ? "text-slate-100"
                                                    : "text-gray-900"
                                                }`}
                                              >
                                                {laborRoles.find(
                                                  (r) =>
                                                    r.name === line.labor_role
                                                )?.name || "-"}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                            activeMode === "costing" ? (
                                              <input
                                                type="text"
                                                inputMode="numeric"
                                                value={
                                                  minutesInputs.has(line.id)
                                                    ? minutesInputs.get(
                                                        line.id
                                                      )!
                                                    : line.minutes === 0
                                                    ? ""
                                                    : line.minutes || ""
                                                }
                                                onChange={(e) => {
                                                  const value = e.target.value;
                                                  // 整数のみを許可（空文字列も許可）
                                                  const integerPattern =
                                                    /^\d*$/;
                                                  if (
                                                    integerPattern.test(value)
                                                  ) {
                                                    setMinutesInputs((prev) => {
                                                      const newMap = new Map(
                                                        prev
                                                      );
                                                      newMap.set(
                                                        line.id,
                                                        value
                                                      );
                                                      return newMap;
                                                    });
                                                  }
                                                  // マッチしない場合は何もしない（前の値を保持）
                                                }}
                                                onBlur={(e) => {
                                                  const value = e.target.value;
                                                  // フォーカスアウト時に整数に変換
                                                  const numValue =
                                                    value === ""
                                                      ? 0
                                                      : parseInt(value, 10) ||
                                                        0;
                                                  handleRecipeLineChange(
                                                    item.id,
                                                    line.id,
                                                    "minutes",
                                                    numValue
                                                  );
                                                  // 入力中の文字列をクリア
                                                  setMinutesInputs((prev) => {
                                                    const newMap = new Map(
                                                      prev
                                                    );
                                                    newMap.delete(line.id);
                                                    return newMap;
                                                  });
                                                }}
                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                                  isDark
                                                    ? "bg-slate-700 border-slate-600 text-slate-100"
                                                    : "bg-white border-gray-300 text-gray-900"
                                                }`}
                                                placeholder="0"
                                              />
                                            ) : (
                                              <div
                                                className={`text-sm ${
                                                  isDark
                                                    ? "text-slate-100"
                                                    : "text-gray-900"
                                                }`}
                                              >
                                                {line.minutes || 0} minutes
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-4 py-2">
                                            {isEditModeCosting &&
                                              activeMode === "costing" && (
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
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    <tr>
                                      <td colSpan={3} className="px-4 py-2">
                                        {isEditModeCosting &&
                                          activeMode === "costing" && (
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
                                        )}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* プラスマーク行（Editモード時のみ、最後の行の下） */}
                {isEditModeCosting && activeMode === "costing" && (
                  <tr>
                    <td
                      colSpan={
                        isEditModeCosting && activeMode === "costing" ? 6 : 5
                      }
                      className="px-6 py-4"
                    >
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
    </div>
  );
}
