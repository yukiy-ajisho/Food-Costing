"use client";

import { useState, Fragment, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import {
  vendorProductsAPI,
  itemsAPI,
  baseItemsAPI,
  vendorsAPI,
  type VendorProduct,
  type Item,
  type BaseItem as APIBaseItem,
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
interface VendorProductUI {
  id: string;
  base_item_id: string;
  vendor_id: string;
  product_name?: string | null; // NULL可能
  brand_name?: string | null;
  purchase_unit: string;
  purchase_quantity: number;
  purchase_cost: number;
  each_grams?: number | null; // itemsテーブルのeach_grams（表示用のみ、Base Itemsタブで管理）
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
  needsWarning?: boolean; // 警告フラグ（非質量単位/eachでspecific_weight/each_gramsが未設定）
}

interface BaseItemUI {
  id: string;
  name: string;
  specific_weight?: number | null;
  each_grams?: number | null; // itemsテーブルのeach_grams（base_item_idで対応するitemsレコードから取得）
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

  // Itemsタブ用のstate（vendor_productsテーブルを操作）
  const [vendorProducts, setVendorProducts] = useState<VendorProductUI[]>([]);
  const [baseItems, setBaseItems] = useState<APIBaseItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]); // itemsテーブル（each_gramsを取得するため）
  const [originalVendorProducts, setOriginalVendorProducts] = useState<
    VendorProductUI[]
  >([]);
  const [isEditModeItems, setIsEditModeItems] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [hasLoadedItemsOnce, setHasLoadedItemsOnce] = useState(false);

  // Base Itemsタブ用のstate
  const [baseItemsUI, setBaseItemsUI] = useState<BaseItemUI[]>([]);
  const [originalBaseItems, setOriginalBaseItems] = useState<BaseItemUI[]>([]);
  const [isEditModeBaseItems, setIsEditModeBaseItems] = useState(false);
  const [loadingBaseItems, setLoadingBaseItems] = useState(false);
  const [hasLoadedBaseItemsOnce, setHasLoadedBaseItemsOnce] = useState(false);

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
  // Itemsタブのデータ取得（vendor_productsテーブルを操作）
  // =========================================================
  useEffect(() => {
    if (activeTab !== "items") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (
      vendorProducts.length > 0 &&
      baseItems.length > 0 &&
      vendors.length > 0
    ) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedItemsOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingItems(true);
        }
        const [vendorProductsData, baseItemsData, vendorsData, itemsData] =
          await Promise.all([
            vendorProductsAPI.getAll(),
            baseItemsAPI.getAll(),
            vendorsAPI.getAll(),
            itemsAPI.getAll({ item_kind: "raw" }),
          ]);

        setBaseItems(baseItemsData);
        setVendors(vendorsData);
        setItems(itemsData);

        // VendorProductUI形式に変換
        const vendorProductsUI: VendorProductUI[] = vendorProductsData.map(
          (vp) => {
            // 対応するitemを取得（each_gramsを取得するため）
            const item = itemsData.find(
              (i) => i.base_item_id === vp.base_item_id
            );

            // 警告フラグをチェック
            const baseItem = baseItemsData.find(
              (b) => b.id === vp.base_item_id
            );
            let needsWarning = false;

            if (vp.purchase_unit) {
              if (vp.purchase_unit === "each") {
                // eachの場合、items.each_gramsがないと警告（base_item経由で取得）
                needsWarning = !item?.each_grams;
              } else if (isNonMassUnit(vp.purchase_unit)) {
                // 非質量単位の場合、base_itemにspecific_weightがないと警告
                needsWarning = !baseItem?.specific_weight;
              }
            }

            return {
              id: vp.id,
              base_item_id: vp.base_item_id,
              vendor_id: vp.vendor_id,
              product_name: vp.product_name,
              brand_name: vp.brand_name,
              purchase_unit: vp.purchase_unit,
              purchase_quantity: vp.purchase_quantity,
              purchase_cost: vp.purchase_cost,
              each_grams: item?.each_grams || null,
              needsWarning,
            };
          }
        );

        setVendorProducts(vendorProductsUI);
        setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
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
  // Base Itemsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "raw-items") return;

    // 既にデータが存在する場合は再取得をスキップ
    if (baseItemsUI.length > 0) {
      return;
    }

    // 初回ロード時のみローディング状態を表示
    const isFirstLoad = !hasLoadedBaseItemsOnce;

    const fetchData = async () => {
      try {
        if (isFirstLoad) {
          setLoadingBaseItems(true);
        }
        // Base Itemsと対応するItemsレコードを取得
        const [baseItemsData, itemsData] = await Promise.all([
          baseItemsAPI.getAll(),
          itemsAPI.getAll({ item_kind: "raw" }),
        ]);

        // Base Itemに対応するItemsレコードからeach_gramsを取得
        const baseItemsUI: BaseItemUI[] = baseItemsData.map((baseItem) => {
          const correspondingItem = itemsData.find(
            (item) => item.base_item_id === baseItem.id
          );
          return {
            id: baseItem.id,
            name: baseItem.name,
            specific_weight: baseItem.specific_weight,
            each_grams: correspondingItem?.each_grams || null,
          };
        });
        setBaseItemsUI(baseItemsUI);
        setOriginalBaseItems(JSON.parse(JSON.stringify(baseItemsUI)));
        setHasLoadedBaseItemsOnce(true);
      } catch (error) {
        console.error("Failed to fetch data:", error);
        alert("データの取得に失敗しました");
      } finally {
        setLoadingBaseItems(false);
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
  // Itemsタブのハンドラー（vendor_productsテーブルを操作）
  // =========================================================
  const handleEditClickItems = () => {
    setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProducts)));
    setIsEditModeItems(true);
  };

  const handleCancelClickItems = () => {
    setVendorProducts(JSON.parse(JSON.stringify(originalVendorProducts)));
    setIsEditModeItems(false);
  };

  const handleSaveClickItems = async () => {
    try {
      setLoadingItems(true);

      // 削除予定と空の新規レコードをフィルター
      const filteredVendorProducts = vendorProducts.filter((vp) => {
        if (vp.isMarkedForDeletion) return false;
        if (
          vp.isNew &&
          vp.base_item_id === "" &&
          vp.vendor_id === "" &&
          (!vp.product_name || vp.product_name.trim() === "") &&
          vp.purchase_quantity === 0 &&
          vp.purchase_cost === 0
        ) {
          return false;
        }
        return true;
      });

      // API呼び出し
      for (const vp of filteredVendorProducts) {
        if (vp.isNew) {
          // 新規作成: vendor_productsを作成（自動的にitemsも作成される）
          const newVendorProduct = await vendorProductsAPI.create({
            base_item_id: vp.base_item_id,
            vendor_id: vp.vendor_id,
            product_name: vp.product_name || null,
            brand_name: vp.brand_name || null,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
          });

          // each_gramsはBase Itemsタブで管理するため、ここでは更新しない
        } else {
          // 更新: vendor_productsを更新
          await vendorProductsAPI.update(vp.id, {
            base_item_id: vp.base_item_id,
            vendor_id: vp.vendor_id,
            product_name: vp.product_name || null,
            brand_name: vp.brand_name || null,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
          });

          // each_gramsはBase Itemsタブで管理するため、ここでは更新しない
        }
      }

      // 削除処理
      for (const vp of vendorProducts) {
        if (vp.isMarkedForDeletion && !vp.isNew) {
          await vendorProductsAPI.delete(vp.id);
        }
      }

      // データを再取得
      const [vendorProductsData, baseItemsData, vendorsData, itemsData] =
        await Promise.all([
          vendorProductsAPI.getAll(),
          baseItemsAPI.getAll(),
          vendorsAPI.getAll(),
          itemsAPI.getAll({ item_kind: "raw" }),
        ]);

      setBaseItems(baseItemsData);
      setVendors(vendorsData);
      setItems(itemsData);

      const vendorProductsUI: VendorProductUI[] = vendorProductsData.map(
        (vp) => {
          const item = itemsData.find(
            (i) => i.base_item_id === vp.base_item_id
          );
          const baseItem = baseItemsData.find((b) => b.id === vp.base_item_id);
          let needsWarning = false;

          if (vp.purchase_unit) {
            if (vp.purchase_unit === "each") {
              needsWarning = !item?.each_grams;
            } else if (isNonMassUnit(vp.purchase_unit)) {
              needsWarning = !baseItem?.specific_weight;
            }
          }

          return {
            id: vp.id,
            base_item_id: vp.base_item_id,
            vendor_id: vp.vendor_id,
            product_name: vp.product_name,
            brand_name: vp.brand_name,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
            each_grams: item?.each_grams || null,
            needsWarning,
          };
        }
      );

      setVendorProducts(vendorProductsUI);
      setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
      setIsEditModeItems(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleVendorProductChange = (
    id: string,
    field: keyof VendorProductUI,
    value: string | number | null
  ) => {
    setVendorProducts(
      vendorProducts.map((vp) => {
        if (vp.id === id) {
          const updated = { ...vp, [field]: value };
          // base_item_idまたはpurchase_unitが変更された場合、警告フラグを再計算
          if (field === "base_item_id" || field === "purchase_unit") {
            const baseItem = baseItems.find(
              (b) => b.id === updated.base_item_id
            );
            const item = items.find(
              (i) => i.base_item_id === updated.base_item_id
            );
            let needsWarning = false;
            if (updated.purchase_unit) {
              if (updated.purchase_unit === "each") {
                needsWarning = !item?.each_grams;
              } else if (isNonMassUnit(updated.purchase_unit)) {
                needsWarning = !baseItem?.specific_weight;
              }
            }
            updated.needsWarning = needsWarning;
          }
          return updated;
        }
        return vp;
      })
    );
  };

  const handleDeleteClickItems = (id: string) => {
    setVendorProducts(
      vendorProducts.map((vp) =>
        vp.id === id
          ? { ...vp, isMarkedForDeletion: !vp.isMarkedForDeletion }
          : vp
      )
    );
  };

  const handleAddClickItems = (insertAfterId: string) => {
    const newVendorProduct: VendorProductUI = {
      id: `new-${Date.now()}`,
      base_item_id: "",
      vendor_id: "",
      product_name: null,
      brand_name: null,
      purchase_unit: "kg",
      purchase_quantity: 0,
      purchase_cost: 0,
      isNew: true,
    };

    const insertIndex = vendorProducts.findIndex(
      (vp) => vp.id === insertAfterId
    );
    const newVendorProducts = [...vendorProducts];
    newVendorProducts.splice(insertIndex + 1, 0, newVendorProduct);
    setVendorProducts(newVendorProducts);
  };

  // =========================================================
  // Base Itemsタブのハンドラー
  // =========================================================
  const handleEditClickBaseItems = () => {
    setOriginalBaseItems(JSON.parse(JSON.stringify(baseItemsUI)));
    setIsEditModeBaseItems(true);
  };

  const handleCancelClickBaseItems = () => {
    setBaseItemsUI(JSON.parse(JSON.stringify(originalBaseItems)));
    setIsEditModeBaseItems(false);
  };

  const handleSaveClickBaseItems = async () => {
    try {
      setLoadingBaseItems(true);

      const filteredBaseItems = baseItemsUI.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (item.isNew && item.name.trim() === "") return false;
        return true;
      });

      for (const item of filteredBaseItems) {
        let baseItemId: string;

        if (item.isNew) {
          // Base Itemを作成
          const newBaseItem = await baseItemsAPI.create({
            name: item.name,
            specific_weight: item.specific_weight || null,
          });
          baseItemId = newBaseItem.id;
        } else {
          // Base Itemを更新
          await baseItemsAPI.update(item.id, {
            name: item.name,
            specific_weight: item.specific_weight || null,
          });
          baseItemId = item.id;
        }

        // 対応するitemsレコードを取得または作成
        const itemsData = await itemsAPI.getAll({ item_kind: "raw" });
        let correspondingItem = itemsData.find(
          (i) => i.base_item_id === baseItemId
        );

        // itemsレコードが存在しない場合は作成
        if (!correspondingItem) {
          const newItem = await itemsAPI.create({
            name: item.name,
            item_kind: "raw",
            is_menu_item: false,
            base_item_id: baseItemId,
            each_grams: item.each_grams || null,
          });
          correspondingItem = newItem;
        } else {
          // itemsレコードが存在する場合は、each_gramsを更新
          if (item.each_grams !== undefined) {
            await itemsAPI.update(correspondingItem.id, {
              each_grams: item.each_grams || null,
            });
          }
        }
      }

      for (const item of baseItemsUI) {
        if (item.isMarkedForDeletion && !item.isNew) {
          await baseItemsAPI.delete(item.id);
        }
      }

      // データを再取得
      const [baseItemsData, itemsData] = await Promise.all([
        baseItemsAPI.getAll(),
        itemsAPI.getAll({ item_kind: "raw" }),
      ]);

      const baseItemsUIUpdated: BaseItemUI[] = baseItemsData.map((baseItem) => {
        const correspondingItem = itemsData.find(
          (item) => item.base_item_id === baseItem.id
        );
        return {
          id: baseItem.id,
          name: baseItem.name,
          specific_weight: baseItem.specific_weight,
          each_grams: correspondingItem?.each_grams || null,
        };
      });

      setBaseItemsUI(baseItemsUIUpdated);
      setOriginalBaseItems(JSON.parse(JSON.stringify(baseItemsUIUpdated)));
      // Itemsタブのプルダウン用にbaseItemsも更新
      setBaseItems(baseItemsData);
      setIsEditModeBaseItems(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoadingBaseItems(false);
    }
  };

  const handleBaseItemChange = (
    id: string,
    field: keyof BaseItemUI,
    value: string | number | null
  ) => {
    setBaseItemsUI(
      baseItemsUI.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleDeleteClickBaseItems = (id: string) => {
    setBaseItemsUI(
      baseItemsUI.map((item) =>
        item.id === id
          ? { ...item, isMarkedForDeletion: !item.isMarkedForDeletion }
          : item
      )
    );
  };

  const handleAddClickBaseItems = () => {
    const newItem: BaseItemUI = {
      id: `new-${Date.now()}`,
      name: "",
      specific_weight: null,
      each_grams: null,
      isNew: true,
    };
    setBaseItemsUI([...baseItemsUI, newItem]);
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
    return vendorProducts.length > 0
      ? vendorProducts[vendorProducts.length - 1].id
      : "";
  };

  const getLastBaseItemId = () => {
    return baseItemsUI.length > 0 ? baseItemsUI[baseItemsUI.length - 1].id : "";
  };

  const getLastVendorId = () => {
    return vendorsUI.length > 0 ? vendorsUI[vendorsUI.length - 1].id : "";
  };

  // Base ItemsとVendorsのオプション（SearchableSelect用）
  const baseItemsOptions = baseItems.map((item) => ({
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
    (activeTab === "raw-items" && loadingBaseItems) ||
    (activeTab === "vendors" && loadingVendors);

  // 現在のタブのEditモード
  const isEditMode =
    (activeTab === "items" && isEditModeItems) ||
    (activeTab === "raw-items" && isEditModeBaseItems) ||
    (activeTab === "vendors" && isEditModeVendors);

  // Edit/Save/Cancelボタンのハンドラー
  const handleEditClick = () => {
    if (activeTab === "items") handleEditClickItems();
    else if (activeTab === "raw-items") handleEditClickBaseItems();
    else if (activeTab === "vendors") handleEditClickVendors();
  };

  const handleCancelClick = () => {
    if (activeTab === "items") handleCancelClickItems();
    else if (activeTab === "raw-items") handleCancelClickBaseItems();
    else if (activeTab === "vendors") handleCancelClickVendors();
  };

  const handleSaveClick = () => {
    if (activeTab === "items") handleSaveClickItems();
    else if (activeTab === "raw-items") handleSaveClickBaseItems();
    else if (activeTab === "vendors") handleSaveClickVendors();
  };

  if (isLoading) {
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
              Base Items
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

        {/* Itemsタブ（vendor_productsテーブルを操作） */}
        {activeTab === "items" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Base Item Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Brand Name
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
                  {isEditModeItems && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      {/* ゴミ箱列のヘッダー */}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {vendorProducts.map((vp) => (
                  <Fragment key={vp.id}>
                    <tr
                      className={`${
                        vp.isMarkedForDeletion ? "bg-red-50" : ""
                      } hover:bg-gray-50`}
                    >
                      {/* Base Item Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <SearchableSelect
                            options={baseItems.map((b) => ({
                              id: b.id,
                              name: b.name,
                            }))}
                            value={vp.base_item_id}
                            onChange={(value) =>
                              handleVendorProductChange(
                                vp.id,
                                "base_item_id",
                                value
                              )
                            }
                            placeholder="Select base item"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {baseItems.find((b) => b.id === vp.base_item_id)
                              ?.name || "-"}
                          </div>
                        )}
                      </td>

                      {/* Vendor Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <SearchableSelect
                            options={vendors.map((v) => ({
                              id: v.id,
                              name: v.name,
                            }))}
                            value={vp.vendor_id}
                            onChange={(value) =>
                              handleVendorProductChange(
                                vp.id,
                                "vendor_id",
                                value
                              )
                            }
                            placeholder="Select vendor"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {vendors.find((v) => v.id === vp.vendor_id)?.name ||
                              "-"}
                          </div>
                        )}
                      </td>

                      {/* Product Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <input
                            type="text"
                            value={vp.product_name || ""}
                            onChange={(e) =>
                              handleVendorProductChange(
                                vp.id,
                                "product_name",
                                e.target.value
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Product name"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {vp.product_name}
                          </div>
                        )}
                      </td>

                      {/* Brand Name */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEditModeItems ? (
                          <input
                            type="text"
                            value={vp.brand_name || ""}
                            onChange={(e) =>
                              handleVendorProductChange(
                                vp.id,
                                "brand_name",
                                e.target.value || null
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Brand name (optional)"
                          />
                        ) : (
                          <div className="text-sm text-gray-900">
                            {vp.brand_name || "-"}
                          </div>
                        )}
                      </td>

                      {/* Unit */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isEditModeItems ? (
                            <select
                              value={vp.purchase_unit}
                              onChange={(e) =>
                                handleVendorProductChange(
                                  vp.id,
                                  "purchase_unit",
                                  e.target.value
                                )
                              }
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {unitOptions.map((unit) => {
                                // eachの場合、対応するitemsレコードのeach_gramsを確認
                                let isEachDisabled = false;
                                if (unit === "each" && vp.base_item_id) {
                                  const correspondingItem = items.find(
                                    (i) => i.base_item_id === vp.base_item_id
                                  );
                                  isEachDisabled =
                                    !correspondingItem?.each_grams ||
                                    correspondingItem.each_grams === 0;
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
                              })}
                            </select>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-900">
                                {vp.purchase_unit}
                              </span>
                              {/* 警告（赤点） */}
                              {vp.needsWarning && (
                                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                              )}
                              {/* each_gramsが設定されている場合、表示 */}
                              {vp.purchase_unit === "each" && vp.each_grams && (
                                <span className="text-xs text-gray-500">
                                  ({vp.each_grams}g)
                                </span>
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
                              vp.purchase_quantity === 0
                                ? ""
                                : String(vp.purchase_quantity)
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              const numValue =
                                value === "" ? 0 : parseFloat(value) || 0;
                              handleVendorProductChange(
                                vp.id,
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
                            {vp.purchase_quantity}
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
                                vp.purchase_cost === 0
                                  ? ""
                                  : String(vp.purchase_cost)
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                const numValue =
                                  value === "" ? 0 : parseFloat(value) || 0;
                                handleVendorProductChange(
                                  vp.id,
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
                            ${vp.purchase_cost.toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* ゴミ箱 */}
                      {isEditModeItems && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteClickItems(vp.id)}
                            className={`p-2 rounded-md transition-colors ${
                              vp.isMarkedForDeletion
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
                    <td colSpan={isEditModeItems ? 8 : 7} className="px-6 py-4">
                      <button
                        onClick={() =>
                          handleAddClickItems(
                            vendorProducts.length > 0
                              ? vendorProducts[vendorProducts.length - 1].id
                              : ""
                          )
                        }
                        className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        <span>Add new vendor product</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Base Itemsタブ */}
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
                  {isEditModeBaseItems && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      {/* ゴミ箱列のヘッダー */}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {baseItemsUI.map((item) => (
                  <tr
                    key={item.id}
                    className={`${
                      item.isMarkedForDeletion ? "bg-red-50" : ""
                    } hover:bg-gray-50`}
                  >
                    {/* Name */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeBaseItems ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) =>
                            handleBaseItemChange(
                              item.id,
                              "name",
                              e.target.value
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Base item name"
                        />
                      ) : (
                        <div className="text-sm text-gray-900">{item.name}</div>
                      )}
                    </td>

                    {/* Specific Weight */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeBaseItems ? (
                        <input
                          type="number"
                          value={item.specific_weight || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue =
                              value === "" ? null : parseFloat(value) || null;
                            handleBaseItemChange(
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

                    {/* Each (g) */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditModeBaseItems ? (
                        <input
                          type="number"
                          value={item.each_grams || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            const numValue =
                              value === "" ? null : parseFloat(value) || null;
                            handleBaseItemChange(
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
                    {isEditModeBaseItems && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteClickBaseItems(item.id)}
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
                {isEditModeBaseItems && (
                  <tr>
                    <td
                      colSpan={isEditModeBaseItems ? 4 : 3}
                      className="px-6 py-4"
                    >
                      <button
                        onClick={handleAddClickBaseItems}
                        className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        <span>Add new base item</span>
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
