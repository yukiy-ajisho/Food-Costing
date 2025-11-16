"use client";

import { useState, Fragment, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import {
  itemsAPI,
  rawItemsAPI,
  vendorsAPI,
  type Item,
  type RawItem as APIRawItem,
  type Vendor,
} from "@/lib/api";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  MASS_UNIT_CONVERSIONS,
  NON_MASS_UNITS,
  isNonMassUnit,
} from "@/lib/constants";

type TabType = "items" | "raw-items" | "vendors";

// UI用の型定義
interface ItemUI {
  id: string;
  raw_item_id: string;
  vendor_id: string;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_cost: number;
  notes: string;
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
  needsWarning?: boolean; // 警告フラグ（非質量単位/eachでspecific_weight/each_gramsが未設定）
}

interface RawItemUI {
  id: string;
  name: string;
  specific_weight?: number | null;
  each_grams?: number | null;
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
}

interface VendorUI {
  id: string;
  name: string;
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
}

export default function ItemsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("items");

  // Itemsタブ用のstate
  const [items, setItems] = useState<ItemUI[]>([]);
  const [rawItems, setRawItems] = useState<APIRawItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [originalItems, setOriginalItems] = useState<ItemUI[]>([]);
  const [isEditModeItems, setIsEditModeItems] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [hasLoadedItemsOnce, setHasLoadedItemsOnce] = useState(false);

  // Raw Itemsタブ用のstate
  const [rawItemsUI, setRawItemsUI] = useState<RawItemUI[]>([]);
  const [originalRawItems, setOriginalRawItems] = useState<RawItemUI[]>([]);
  const [isEditModeRawItems, setIsEditModeRawItems] = useState(false);
  const [loadingRawItems, setLoadingRawItems] = useState(false);
  const [hasLoadedRawItemsOnce, setHasLoadedRawItemsOnce] = useState(false);

  // Vendorsタブ用のstate
  const [vendorsUI, setVendorsUI] = useState<VendorUI[]>([]);
  const [originalVendors, setOriginalVendors] = useState<VendorUI[]>([]);
  const [isEditModeVendors, setIsEditModeVendors] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [hasLoadedVendorsOnce, setHasLoadedVendorsOnce] = useState(false);

  // 単位オプション（質量単位 + 非質量単位）
  const unitOptions = [
    ...Object.keys(MASS_UNIT_CONVERSIONS),
    ...NON_MASS_UNITS,
  ];

  // =========================================================
  // Itemsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "items") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (items.length > 0 && rawItems.length > 0 && vendors.length > 0) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedItemsOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingItems(true);
        }
        const [itemsData, rawItemsData, vendorsData] = await Promise.all([
          itemsAPI.getAll({ item_kind: "raw" }),
          rawItemsAPI.getAll(),
          vendorsAPI.getAll(),
        ]);

        setRawItems(rawItemsData);
        setVendors(vendorsData);

        // ItemUI形式に変換
        const itemsUI: ItemUI[] = itemsData.map((item) => {
          // 警告フラグをチェック
          const rawItem = rawItemsData.find((r) => r.id === item.raw_item_id);
          let needsWarning = false;

          if (item.purchase_unit) {
            if (item.purchase_unit === "each") {
              // eachの場合、raw_itemにeach_gramsがないと警告
              needsWarning = !rawItem?.each_grams;
            } else if (isNonMassUnit(item.purchase_unit)) {
              // 非質量単位の場合、raw_itemにspecific_weightがないと警告
              needsWarning = !rawItem?.specific_weight;
            }
          }

          return {
            id: item.id,
            raw_item_id: item.raw_item_id || "",
            vendor_id: item.vendor_id || "",
            purchase_unit: item.purchase_unit || "",
            purchase_quantity: item.purchase_quantity ?? 0,
            purchase_cost: item.purchase_cost ?? 0,
            notes: item.notes || "",
            needsWarning,
          };
        });

        setItems(itemsUI);
        setOriginalItems(JSON.parse(JSON.stringify(itemsUI)));
        setHasLoadedItemsOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoadingItems(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // =========================================================
  // Raw Itemsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "raw-items") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (rawItemsUI.length > 0) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedRawItemsOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingRawItems(true);
        }
        const rawItemsData = await rawItemsAPI.getAll();
        const rawItemsUI: RawItemUI[] = rawItemsData.map((item) => ({
          id: item.id,
          name: item.name,
          specific_weight: item.specific_weight,
          each_grams: item.each_grams,
        }));
        setRawItemsUI(rawItemsUI);
        setOriginalRawItems(JSON.parse(JSON.stringify(rawItemsUI)));
        setHasLoadedRawItemsOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoadingRawItems(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // =========================================================
  // Vendorsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "vendors") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (vendorsUI.length > 0) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedVendorsOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingVendors(true);
        }
        const vendorsData = await vendorsAPI.getAll();
        const vendorsUI: VendorUI[] = vendorsData.map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
        }));
        setVendorsUI(vendorsUI);
        setOriginalVendors(JSON.parse(JSON.stringify(vendorsUI)));
        setHasLoadedVendorsOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoadingVendors(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // =========================================================
  // Itemsタブのハンドラー
  // =========================================================
  const handleEditClickItems = () => {
    setOriginalItems(JSON.parse(JSON.stringify(items)));
    setIsEditModeItems(true);
  };

  const handleCancelClickItems = () => {
    setItems(JSON.parse(JSON.stringify(originalItems)));
    setIsEditModeItems(false);
  };

  const handleSaveClickItems = async () => {
    try {
      setLoadingItems(true);

      // 削除予定と空の新規レコードをフィルター
      const filteredItems = items.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (
          item.isNew &&
          item.raw_item_id === "" &&
          item.vendor_id === "" &&
          item.purchase_quantity === 0 &&
          item.purchase_cost === 0
        ) {
          return false;
        }
        return true;
      });

      // API呼び出し
      for (const item of filteredItems) {
        const rawItem = rawItems.find((r) => r.id === item.raw_item_id);
        if (!rawItem) {
          throw new Error(`Raw item not found: ${item.raw_item_id}`);
        }

        if (item.isNew) {
          await itemsAPI.create({
            name: rawItem.name, // raw_itemから取得
            item_kind: "raw",
            is_menu_item: false,
            raw_item_id: item.raw_item_id,
            vendor_id: item.vendor_id,
            purchase_unit: item.purchase_unit,
            purchase_quantity: item.purchase_quantity,
            purchase_cost: item.purchase_cost,
            notes: item.notes || null,
          });
        } else {
          await itemsAPI.update(item.id, {
            name: rawItem.name, // raw_itemから取得
            raw_item_id: item.raw_item_id,
            vendor_id: item.vendor_id,
            purchase_unit: item.purchase_unit,
            purchase_quantity: item.purchase_quantity,
            purchase_cost: item.purchase_cost,
            notes: item.notes || null,
          });
        }
      }

      // 削除処理
      for (const item of items) {
        if (item.isMarkedForDeletion && !item.isNew) {
          await itemsAPI.delete(item.id);
        }
      }

      // データを再取得
      const [itemsData, rawItemsData] = await Promise.all([
        itemsAPI.getAll({ item_kind: "raw" }),
        rawItemsAPI.getAll(),
      ]);

      setRawItems(rawItemsData);

      const itemsUI: ItemUI[] = itemsData.map((item) => {
        const rawItem = rawItemsData.find((r) => r.id === item.raw_item_id);
        let needsWarning = false;

        if (item.purchase_unit) {
          if (item.purchase_unit === "each") {
            needsWarning = !rawItem?.each_grams;
          } else if (isNonMassUnit(item.purchase_unit)) {
            needsWarning = !rawItem?.specific_weight;
          }
        }

        return {
          id: item.id,
          raw_item_id: item.raw_item_id || "",
          vendor_id: item.vendor_id || "",
          purchase_unit: item.purchase_unit || "",
          purchase_quantity: item.purchase_quantity ?? 0,
          purchase_cost: item.purchase_cost ?? 0,
          notes: item.notes || "",
          needsWarning,
        };
      });

      setItems(itemsUI);
      setOriginalItems(JSON.parse(JSON.stringify(itemsUI)));
      setIsEditModeItems(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleItemChange = (
    id: string,
    field: keyof ItemUI,
    value: string | number
  ) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          // raw_item_idが変更された場合、警告フラグを再計算
          if (field === "raw_item_id" || field === "purchase_unit") {
            const rawItem = rawItems.find((r) => r.id === updated.raw_item_id);
            let needsWarning = false;
            if (updated.purchase_unit) {
              if (updated.purchase_unit === "each") {
                needsWarning = !rawItem?.each_grams;
              } else if (isNonMassUnit(updated.purchase_unit)) {
                needsWarning = !rawItem?.specific_weight;
              }
            }
            updated.needsWarning = needsWarning;
          }
          return updated;
        }
        return item;
      })
    );
  };

  const handleDeleteClickItems = (id: string) => {
    setItems(
      items.map((item) =>
        item.id === id
          ? { ...item, isMarkedForDeletion: !item.isMarkedForDeletion }
          : item
      )
    );
  };

  const handleAddClickItems = (insertAfterId: string) => {
    const newItem: ItemUI = {
      id: `new-${Date.now()}`,
      raw_item_id: "",
      vendor_id: "",
      purchase_unit: "kg",
      purchase_quantity: 0,
      purchase_cost: 0,
      notes: "",
      isNew: true,
    };

    const insertIndex = items.findIndex((item) => item.id === insertAfterId);
    const newItems = [...items];
    newItems.splice(insertIndex + 1, 0, newItem);
    setItems(newItems);
  };

  // =========================================================
  // Raw Itemsタブのハンドラー
  // =========================================================
  const handleEditClickRawItems = () => {
    setOriginalRawItems(JSON.parse(JSON.stringify(rawItemsUI)));
    setIsEditModeRawItems(true);
  };

  const handleCancelClickRawItems = () => {
    setRawItemsUI(JSON.parse(JSON.stringify(originalRawItems)));
    setIsEditModeRawItems(false);
  };

  const handleSaveClickRawItems = async () => {
    try {
      setLoadingRawItems(true);

      const filteredRawItems = rawItemsUI.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (item.isNew && item.name.trim() === "") return false;
        return true;
      });

      for (const item of filteredRawItems) {
        if (item.isNew) {
          await rawItemsAPI.create({
            name: item.name,
            specific_weight: item.specific_weight || null,
            each_grams: item.each_grams || null,
          });
        } else {
          await rawItemsAPI.update(item.id, {
            name: item.name,
            specific_weight: item.specific_weight || null,
            each_grams: item.each_grams || null,
          });
        }
      }

      for (const item of rawItemsUI) {
        if (item.isMarkedForDeletion && !item.isNew) {
          await rawItemsAPI.delete(item.id);
        }
      }

      const rawItemsData = await rawItemsAPI.getAll();
      const rawItemsUIUpdated: RawItemUI[] = rawItemsData.map((item) => ({
        id: item.id,
        name: item.name,
        specific_weight: item.specific_weight,
        each_grams: item.each_grams,
      }));

      setRawItemsUI(rawItemsUIUpdated);
      setOriginalRawItems(JSON.parse(JSON.stringify(rawItemsUIUpdated)));
      setIsEditModeRawItems(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoadingRawItems(false);
    }
  };

  const handleRawItemChange = (
    id: string,
    field: keyof RawItemUI,
    value: string | number | null
  ) => {
    setRawItemsUI(
      rawItemsUI.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleDeleteClickRawItems = (id: string) => {
    setRawItemsUI(
      rawItemsUI.map((item) =>
        item.id === id
          ? { ...item, isMarkedForDeletion: !item.isMarkedForDeletion }
          : item
      )
    );
  };

  const handleAddClickRawItems = () => {
    const newItem: RawItemUI = {
      id: `new-${Date.now()}`,
      name: "",
      specific_weight: null,
      each_grams: null,
      isNew: true,
    };
    setRawItemsUI([...rawItemsUI, newItem]);
  };

  // =========================================================
  // Vendorsタブのハンドラー
  // =========================================================
  const handleEditClickVendors = () => {
    setOriginalVendors(JSON.parse(JSON.stringify(vendorsUI)));
    setIsEditModeVendors(true);
  };

  const handleCancelClickVendors = () => {
    setVendorsUI(JSON.parse(JSON.stringify(originalVendors)));
    setIsEditModeVendors(false);
  };

  const handleSaveClickVendors = async () => {
    try {
      setLoadingVendors(true);

      const filteredVendors = vendorsUI.filter((vendor) => {
        if (vendor.isMarkedForDeletion) return false;
        if (vendor.isNew && vendor.name.trim() === "") return false;
        return true;
      });

      for (const vendor of filteredVendors) {
        if (vendor.isNew) {
          await vendorsAPI.create({ name: vendor.name });
        } else {
          await vendorsAPI.update(vendor.id, { name: vendor.name });
        }
      }

      for (const vendor of vendorsUI) {
        if (vendor.isMarkedForDeletion && !vendor.isNew) {
          await vendorsAPI.delete(vendor.id);
        }
      }

      const vendorsData = await vendorsAPI.getAll();
      const vendorsUIUpdated: VendorUI[] = vendorsData.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
      }));

      setVendorsUI(vendorsUIUpdated);
      setOriginalVendors(JSON.parse(JSON.stringify(vendorsUIUpdated)));
      setIsEditModeVendors(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoadingVendors(false);
    }
  };

  const handleVendorChange = (
    id: string,
    field: keyof VendorUI,
    value: string
  ) => {
    setVendorsUI(
      vendorsUI.map((vendor) =>
        vendor.id === id ? { ...vendor, [field]: value } : vendor
      )
    );
  };

  const handleDeleteClickVendors = (id: string) => {
    setVendorsUI(
      vendorsUI.map((vendor) =>
        vendor.id === id
          ? { ...vendor, isMarkedForDeletion: !vendor.isMarkedForDeletion }
          : vendor
      )
    );
  };

  const handleAddClickVendors = () => {
    const newVendor: VendorUI = {
      id: `new-${Date.now()}`,
      name: "",
      isNew: true,
    };
    setVendorsUI([...vendorsUI, newVendor]);
  };

  // =========================================================
  // レンダリング
  // =========================================================
  const getLastItemId = () => {
    return items.length > 0 ? items[items.length - 1].id : "";
  };

  const getLastRawItemId = () => {
    return rawItemsUI.length > 0 ? rawItemsUI[rawItemsUI.length - 1].id : "";
  };

  const getLastVendorId = () => {
    return vendorsUI.length > 0 ? vendorsUI[vendorsUI.length - 1].id : "";
  };

  // Raw ItemsとVendorsのオプション（SearchableSelect用）
  const rawItemsOptions = rawItems.map((item) => ({
    id: item.id,
    name: item.name,
  }));

  const vendorsOptions = vendors.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
  }));

  // 現在のタブのローディング状態
  const isLoading =
    (activeTab === "items" && loadingItems) ||
    (activeTab === "raw-items" && loadingRawItems) ||
    (activeTab === "vendors" && loadingVendors);

  // 現在のタブのEditモード
  const isEditMode =
    (activeTab === "items" && isEditModeItems) ||
    (activeTab === "raw-items" && isEditModeRawItems) ||
    (activeTab === "vendors" && isEditModeVendors);

  // Edit/Save/Cancelボタンのハンドラー
  const handleEditClick = () => {
    if (activeTab === "items") handleEditClickItems();
    else if (activeTab === "raw-items") handleEditClickRawItems();
    else if (activeTab === "vendors") handleEditClickVendors();
  };

  const handleCancelClick = () => {
    if (activeTab === "items") handleCancelClickItems();
    else if (activeTab === "raw-items") handleCancelClickRawItems();
    else if (activeTab === "vendors") handleCancelClickVendors();
  };

  const handleSaveClick = () => {
    if (activeTab === "items") handleSaveClickItems();
    else if (activeTab === "raw-items") handleSaveClickRawItems();
    else if (activeTab === "vendors") handleSaveClickVendors();
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* タブ */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab("items")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "items"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Items
            </button>
            <button
              onClick={() => setActiveTab("raw-items")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "raw-items"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Raw Items
            </button>
            <button
              onClick={() => setActiveTab("vendors")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "vendors"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Vendors
            </button>
          </nav>
        </div>

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

        {/* Itemsタブ */}
        {activeTab === "items" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor
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
                  {isEditModeItems && (
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
                      } hover:bg-gray-50`}
                    >
                      {/* Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <SearchableSelect
                            options={rawItemsOptions}
                            value={item.raw_item_id}
                            onChange={(value) =>
                              handleItemChange(item.id, "raw_item_id", value)
                            }
                            placeholder="Select raw item"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {rawItems.find((r) => r.id === item.raw_item_id)
                              ?.name || "-"}
                          </div>
                        )}
                      </td>

                      {/* Vendor */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <SearchableSelect
                            options={vendorsOptions}
                            value={item.vendor_id}
                            onChange={(value) =>
                              handleItemChange(item.id, "vendor_id", value)
                            }
                            placeholder="Select vendor"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {vendors.find((v) => v.id === item.vendor_id)
                              ?.name || "-"}
                          </div>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isEditModeItems ? (
                            <select
                              value={item.purchase_unit}
                              onChange={(e) =>
                                handleItemChange(
                                  item.id,
                                  "purchase_unit",
                                  e.target.value
                                )
                              }
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {unitOptions.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-900">
                                {item.purchase_unit}
                              </span>
                              {/* 警告（赤点） */}
                              {item.needsWarning && (
                                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <input
                            type="number"
                            value={
                              item.purchase_quantity === 0
                                ? ""
                                : item.purchase_quantity
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              const numValue =
                                value === "" ? 0 : parseFloat(value) || 0;
                              handleItemChange(
                                item.id,
                                "purchase_quantity",
                                numValue
                              );
                            }}
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
                        {isEditModeItems ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500">$</span>
                            <input
                              type="number"
                              value={
                                item.purchase_cost === 0
                                  ? ""
                                  : item.purchase_cost
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                const numValue =
                                  value === "" ? 0 : parseFloat(value) || 0;
                                handleItemChange(
                                  item.id,
                                  "purchase_cost",
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
                            ${item.purchase_cost.toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* Notes */}
                      <td className="px-6 py-4">
                        {isEditModeItems ? (
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

                      {/* ゴミ箱 */}
                      {isEditModeItems && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteClickItems(item.id)}
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
                  </Fragment>
                ))}

                {/* プラスマーク行 */}
                {isEditModeItems && (
                  <tr>
                    <td colSpan={isEditModeItems ? 7 : 6} className="px-6 py-4">
                      <button
                        onClick={() => handleAddClickItems(getLastItemId())}
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
        )}

        {/* Raw Itemsタブ */}
        {activeTab === "raw-items" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Specific Weight (g/ml)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Each (g)
                  </th>
                  {isEditModeRawItems && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      {/* ゴミ箱列のヘッダー */}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rawItemsUI.map((item) => (
                  <tr
                    key={item.id}
                    className={`${
                      item.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50`}
                  >
                    {/* Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeRawItems ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            handleRawItemChange(item.id, "name", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Raw item name"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">{item.name}</div>
                      )}
                    </td>

                    {/* Specific Weight */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeRawItems ? (
                        <input
                          type="number"
                          value={item.specific_weight || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue =
                              value === "" ? null : parseFloat(value) || null;
                            handleRawItemChange(
                              item.id,
                              "specific_weight",
                              numValue
                            );
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.specific_weight
                            ? item.specific_weight.toFixed(2)
                            : "-"}
                        </div>
                      )}
                    </td>

                    {/* Each Grams */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeRawItems ? (
                        <input
                          type="number"
                          value={item.each_grams || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue =
                              value === "" ? null : parseFloat(value) || null;
                            handleRawItemChange(
                              item.id,
                              "each_grams",
                              numValue
                            );
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                          min="0"
                          step="0.01"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.each_grams ? item.each_grams.toFixed(2) : "-"}
                        </div>
                      )}
                    </td>

                    {/* ゴミ箱 */}
                    {isEditModeRawItems && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteClickRawItems(item.id)}
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
                ))}

                {/* プラスマーク行 */}
                {isEditModeRawItems && (
                  <tr>
                    <td
                      colSpan={isEditModeRawItems ? 4 : 3}
                      className="px-6 py-4"
                    >
                      <button
                        onClick={handleAddClickRawItems}
                        className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        <span>Add new raw item</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Vendorsタブ */}
        {activeTab === "vendors" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  {isEditModeVendors && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      {/* ゴミ箱列のヘッダー */}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {vendorsUI.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className={`${
                      vendor.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50`}
                  >
                    {/* Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeVendors ? (
                        <input
                          type="text"
                          value={vendor.name}
                          onChange={(e) =>
                            handleVendorChange(
                              vendor.id,
                              "name",
                              e.target.value
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Vendor name"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">
                          {vendor.name}
                        </div>
                      )}
                    </td>

                    {/* ゴミ箱 */}
                    {isEditModeVendors && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteClickVendors(vendor.id)}
                          className={`p-2 rounded-md transition-colors ${
                            vendor.isMarkedForDeletion
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

                {/* プラスマーク行 */}
                {isEditModeVendors && (
                  <tr>
                    <td
                      colSpan={isEditModeVendors ? 2 : 1}
                      className="px-6 py-4"
                    >
                      <button
                        onClick={handleAddClickVendors}
                        className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        <span>Add new vendor</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
