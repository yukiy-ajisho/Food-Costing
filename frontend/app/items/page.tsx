"use client";

import { useState, Fragment, useEffect } from "react";
import { Edit, Save, Plus, Trash2, X } from "lucide-react";
import {
  vendorProductsAPI,
  itemsAPI,
  baseItemsAPI,
  vendorsAPI,
  productMappingsAPI,
  saveChangeHistory,
  type Item,
  type BaseItem as APIBaseItem,
  type Vendor,
  type VendorProduct,
  type ProductMapping,
} from "@/lib/api";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  isNonMassUnit,
} from "@/lib/constants";
import { useTheme } from "@/contexts/ThemeContext";
import { useTenant } from "@/contexts/TenantContext";

type TabType = "items" | "raw-items" | "vendors";

// UI用の型定義
interface VendorProductUI extends VendorProduct {
  base_item_id: string; // product_mappingsから取得した表示用のbase_item_id
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
  selectedType?: "specific_weight" | "each" | null; // ラジオボタンの選択状態
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
  const { theme } = useTheme();
  const { selectedTenantId } = useTenant();
  const isDark = theme === "dark";
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
  // 入力中のpurchase_quantityを文字列として保持（vp.id -> 入力中の文字列）
  const [purchaseQuantityInputs, setPurchaseQuantityInputs] = useState<
    Map<string, string>
  >(new Map());
  // 入力中のpurchase_costを文字列として保持（vp.id -> 入力中の文字列）
  const [purchaseCostInputs, setPurchaseCostInputs] = useState<
    Map<string, string>
  >(new Map());

  // Base Itemsタブ用のstate
  const [baseItemsUI, setBaseItemsUI] = useState<BaseItemUI[]>([]);
  const [originalBaseItems, setOriginalBaseItems] = useState<BaseItemUI[]>([]);
  const [isEditModeBaseItems, setIsEditModeBaseItems] = useState(false);
  const [loadingBaseItems, setLoadingBaseItems] = useState(false);
  const [hasLoadedBaseItemsOnce, setHasLoadedBaseItemsOnce] = useState(false);
  // 入力中のspecific_weightを文字列として保持（item.id -> 入力中の文字列）
  const [specificWeightInputs, setSpecificWeightInputs] = useState<
    Map<string, string>
  >(new Map());
  // 入力中のeach_gramsを文字列として保持（item.id -> 入力中の文字列）
  const [eachGramsInputs, setEachGramsInputs] = useState<Map<string, string>>(
    new Map()
  );

  // Vendorsタブ用のstate
  const [vendorsUI, setVendorsUI] = useState<VendorUI[]>([]);
  const [originalVendors, setOriginalVendors] = useState<VendorUI[]>([]);
  const [isEditModeVendors, setIsEditModeVendors] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [hasLoadedVendorsOnce, setHasLoadedVendorsOnce] = useState(false);

  // 単位オプション（質量単位 + 非質量単位、順番を制御）
  const unitOptions = [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED];

  // =========================================================
  // Itemsタブのデータ取得（vendor_productsテーブルを操作）
  // =========================================================
  useEffect(() => {
    if (activeTab !== "items") return;
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

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
        const [vendorProductsData, baseItemsData, vendorsData, itemsData, mappingsData] =
          await Promise.all([
            vendorProductsAPI.getAll(),
            baseItemsAPI.getAll(),
            vendorsAPI.getAll(),
            itemsAPI.getAll({ item_kind: "raw" }),
            productMappingsAPI.getAll(),
          ]);

        setBaseItems(baseItemsData);
        setVendors(vendorsData);
        setItems(itemsData);

        // product_mappingsからbase_item_idを取得するマップを作成
        const virtualProductToBaseItemMap = new Map<string, string>();
        mappingsData?.forEach((mapping) => {
          virtualProductToBaseItemMap.set(mapping.virtual_product_id, mapping.base_item_id);
        });

        // VendorProductUI形式に変換（deprecatedを除外）
        const vendorProductsUI: VendorProductUI[] = vendorProductsData
          .filter((vp) => !vp.deprecated)
          .map((vp): VendorProductUI | null => {
            // product_mappingsからbase_item_idを取得
            const baseItemId = virtualProductToBaseItemMap.get(vp.id);
            if (!baseItemId) {
              // マッピングがない場合はスキップ（またはエラー処理）
              return null;
            }

            // 対応するitemを取得（each_gramsを取得するため）
            const item = itemsData.find(
              (i) => i.base_item_id === baseItemId
            );

            // 警告フラグをチェック
            const baseItem = baseItemsData.find(
              (b) => b.id === baseItemId
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
              base_item_id: baseItemId,
              vendor_id: vp.vendor_id,
              product_name: vp.product_name,
              brand_name: vp.brand_name,
              purchase_unit: vp.purchase_unit,
              purchase_quantity: vp.purchase_quantity,
              purchase_cost: vp.purchase_cost,
              user_id: vp.user_id, // Required field from VendorProduct
              each_grams: item?.each_grams || null,
              needsWarning,
            };
          })
          .filter((vp): vp is VendorProductUI => vp !== null);

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
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

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

        // Base Itemに対応するItemsレコードからeach_gramsを取得（deprecatedを除外）
        const baseItemsUI: BaseItemUI[] = baseItemsData
          .filter((baseItem) => !baseItem.deprecated)
          .map((baseItem) => {
            const correspondingItem = itemsData.find(
              (item) => item.base_item_id === baseItem.id
            );
            const specificWeight = baseItem.specific_weight || null;
            const eachGrams = correspondingItem?.each_grams || null;
            // 既存の値から選択状態を判定
            let selectedType: "specific_weight" | "each" | null = null;
            if (specificWeight !== null && specificWeight !== undefined) {
              selectedType = "specific_weight";
            } else if (eachGrams !== null && eachGrams !== undefined) {
              selectedType = "each";
            }
            return {
              id: baseItem.id,
              name: baseItem.name,
              specific_weight: specificWeight,
              each_grams: eachGrams,
              selectedType: selectedType,
              isNew: false,
              isMarkedForDeletion: false,
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
  }, [activeTab, selectedTenantId]);

  // =========================================================
  // Vendorsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "vendors") return;
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

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
  }, [activeTab, selectedTenantId]);

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

      // 変更されたvendor_productのIDを追跡
      const changedVendorProductIds: string[] = [];

      // API呼び出し
      for (const vp of filteredVendorProducts) {
        if (vp.isNew) {
          // 新規作成: virtual_vendor_productsを作成（base_item_idは含めない）
          const newVp = await vendorProductsAPI.create({
            vendor_id: vp.vendor_id,
            product_name: vp.product_name || null,
            brand_name: vp.brand_name || null,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
          });
          changedVendorProductIds.push(newVp.id);

          // product_mappingsを作成
          if (vp.base_item_id) {
            await productMappingsAPI.create({
              base_item_id: vp.base_item_id,
              virtual_product_id: newVp.id,
            });
          }

          // each_gramsはBase Itemsタブで管理するため、ここでは更新しない
        } else {
          // 更新: virtual_vendor_productsを更新（base_item_idは含めない）
          await vendorProductsAPI.update(vp.id, {
            vendor_id: vp.vendor_id,
            product_name: vp.product_name || null,
            brand_name: vp.brand_name || null,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
          });
          changedVendorProductIds.push(vp.id);

          // product_mappingsを更新（既存のマッピングを削除して新規作成）
          if (vp.base_item_id) {
            // 既存のマッピングを取得
            const existingMappings = await productMappingsAPI.getAll({
              virtual_product_id: vp.id,
            });
            // 既存のマッピングを削除
            for (const mapping of existingMappings) {
              await productMappingsAPI.delete(mapping.id);
            }
            // 新しいマッピングを作成
            await productMappingsAPI.create({
              base_item_id: vp.base_item_id,
              virtual_product_id: vp.id,
            });
          }

          // each_gramsはBase Itemsタブで管理するため、ここでは更新しない
        }
      }

      // Deprecate処理
      for (const vp of vendorProducts) {
        if (vp.isMarkedForDeletion && !vp.isNew) {
          // 削除ではなくdeprecateを使用
          await vendorProductsAPI.deprecate(vp.id);
          changedVendorProductIds.push(vp.id);
        }
      }

      // 変更履歴をlocalStorageに保存
      if (changedVendorProductIds.length > 0) {
        saveChangeHistory({
          changed_vendor_product_ids: changedVendorProductIds,
        });
      }

      // データを再取得
      const [vendorProductsData, baseItemsData, vendorsData, itemsData, mappingsData] =
        await Promise.all([
          vendorProductsAPI.getAll(),
          baseItemsAPI.getAll(),
          vendorsAPI.getAll(),
          itemsAPI.getAll({ item_kind: "raw" }),
          productMappingsAPI.getAll(),
        ]);

      setBaseItems(baseItemsData);
      setVendors(vendorsData);
      setItems(itemsData);

      // product_mappingsからbase_item_idを取得するマップを作成
      const virtualProductToBaseItemMap = new Map<string, string>();
      mappingsData?.forEach((mapping) => {
        virtualProductToBaseItemMap.set(mapping.virtual_product_id, mapping.base_item_id);
      });

      const vendorProductsUI: VendorProductUI[] = vendorProductsData
        .filter((vp) => !vp.deprecated)
        .map((vp): VendorProductUI | null => {
          // product_mappingsからbase_item_idを取得
          const baseItemId = virtualProductToBaseItemMap.get(vp.id);
          if (!baseItemId) {
            return null;
          }

          const item = itemsData.find(
            (i) => i.base_item_id === baseItemId
          );
          const baseItem = baseItemsData.find((b) => b.id === baseItemId);
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
            base_item_id: baseItemId,
            vendor_id: vp.vendor_id,
            product_name: vp.product_name,
            brand_name: vp.brand_name,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            purchase_cost: vp.purchase_cost,
            user_id: vp.user_id, // Required field from VendorProduct
            each_grams: item?.each_grams || null,
            needsWarning,
          };
        })
        .filter((vp): vp is VendorProductUI => vp !== null);

      setVendorProducts(vendorProductsUI);
      setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
      setIsEditModeItems(false);
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`保存に失敗しました: ${message}`);
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
      user_id: "", // Required field from VendorProduct (will be set by backend)
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

      // ============================================================
      // バリデーション: specific_weightやeach_gramsを削除しようとしている場合、
      // Vendor Productsで使用されていないかチェック
      // ============================================================
      const [allVendorProducts, allMappings] = await Promise.all([
        vendorProductsAPI.getAll(),
        productMappingsAPI.getAll(),
      ]);

      // product_mappingsからbase_item_idを取得するマップを作成
      const virtualProductToBaseItemMap = new Map<string, string>();
      allMappings?.forEach((mapping) => {
        virtualProductToBaseItemMap.set(mapping.virtual_product_id, mapping.base_item_id);
      });

      // vendorProductsにbase_item_idを追加（表示用）
      const allVendorProductsWithBaseItemId = allVendorProducts.map((vp) => ({
        ...vp,
        base_item_id: virtualProductToBaseItemMap.get(vp.id) || "",
      }));

      for (const item of baseItemsUI) {
        if (item.isNew) continue; // 新規追加は対象外

        // オリジナルを取得
        const original = originalBaseItems.find((o) => o.id === item.id);
        if (!original) continue;

        // specific_weightが削除されようとしている場合
        const isRemovingSpecificWeight =
          original.specific_weight !== null &&
          original.specific_weight !== undefined &&
          (item.specific_weight === null || item.specific_weight === undefined);

        if (isRemovingSpecificWeight) {
          // このBase Itemを使用しているVendor Productsを取得
          const usedVendorProducts = allVendorProductsWithBaseItemId.filter(
            (vp) =>
              vp.base_item_id === item.id &&
              ["gallon", "liter", "floz", "ml"].includes(vp.purchase_unit)
          );

          if (usedVendorProducts.length > 0) {
            const productNames = usedVendorProducts
              .map((vp) => vp.product_name || "(no name)")
              .join(", ");
            alert(
              `Cannot remove specific_weight for "${item.name}".\n\nIt is used by Vendor Products with non-mass units (gallon, liter, floz, ml):\n${productNames}\n\nPlease change the purchase_unit of these products first.`
            );
            setLoadingBaseItems(false);
            return;
          }
        }

        // each_gramsが削除されようとしている場合
        const isRemovingEachGrams =
          original.each_grams !== null &&
          original.each_grams !== undefined &&
          (item.each_grams === null || item.each_grams === undefined);

        if (isRemovingEachGrams) {
          // このBase Itemを使用しているVendor Productsを取得
          const usedVendorProducts = allVendorProductsWithBaseItemId.filter(
            (vp) => vp.base_item_id === item.id && vp.purchase_unit === "each"
          );

          if (usedVendorProducts.length > 0) {
            const productNames = usedVendorProducts
              .map((vp) => vp.product_name || "(no name)")
              .join(", ");
            alert(
              `Cannot remove each_grams for "${item.name}".\n\nIt is used by Vendor Products with "each" unit:\n${productNames}\n\nPlease change the purchase_unit of these products first.`
            );
            setLoadingBaseItems(false);
            return;
          }
        }
      }

      const filteredBaseItems = baseItemsUI.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (item.isNew && item.name.trim() === "") return false;
        return true;
      });

      // 変更されたbase_item_idとitem_idを追跡
      const changedBaseItemIds: string[] = [];
      const changedItemIds: string[] = [];

      for (const item of filteredBaseItems) {
        let baseItemId: string;

        if (item.isNew) {
          // Base Itemを作成
          const newBaseItem = await baseItemsAPI.create({
            name: item.name,
            specific_weight: item.specific_weight || null,
          });
          baseItemId = newBaseItem.id;
          changedBaseItemIds.push(baseItemId);
        } else {
          // Base Itemを更新
          await baseItemsAPI.update(item.id, {
            name: item.name,
            specific_weight: item.specific_weight || null,
          });
          baseItemId = item.id;
          changedBaseItemIds.push(baseItemId);
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
          changedItemIds.push(newItem.id);
        } else {
          // itemsレコードが存在する場合は、each_gramsを更新
          if (item.each_grams !== undefined) {
            await itemsAPI.update(correspondingItem.id, {
              each_grams: item.each_grams || null,
            });
            changedItemIds.push(correspondingItem.id);
          }
        }
      }

      for (const item of baseItemsUI) {
        if (item.isMarkedForDeletion && !item.isNew) {
          // 削除ではなくdeprecateを使用
          await baseItemsAPI.deprecate(item.id);
          changedBaseItemIds.push(item.id);
        }
      }

      // 変更履歴をlocalStorageに保存
      if (changedBaseItemIds.length > 0 || changedItemIds.length > 0) {
        saveChangeHistory({
          changed_base_item_ids: changedBaseItemIds,
          changed_item_ids: changedItemIds,
        });
      }

      // データを再取得
      const [baseItemsData, itemsData] = await Promise.all([
        baseItemsAPI.getAll(),
        itemsAPI.getAll({ item_kind: "raw" }),
      ]);

      // deprecatedされていないアイテムのみ表示
      const baseItemsUIUpdated: BaseItemUI[] = baseItemsData
        .filter((baseItem) => !baseItem.deprecated)
        .map((baseItem) => {
          const correspondingItem = itemsData.find(
            (item) => item.base_item_id === baseItem.id
          );
          const specificWeight = baseItem.specific_weight || null;
          const eachGrams = correspondingItem?.each_grams || null;
          // 既存の値から選択状態を判定
          let selectedType: "specific_weight" | "each" | null = null;
          if (specificWeight !== null && specificWeight !== undefined) {
            selectedType = "specific_weight";
          } else if (eachGrams !== null && eachGrams !== undefined) {
            selectedType = "each";
          }
          return {
            id: baseItem.id,
            name: baseItem.name,
            specific_weight: specificWeight,
            each_grams: eachGrams,
            selectedType: selectedType,
          };
        });

      setBaseItemsUI(baseItemsUIUpdated);
      setOriginalBaseItems(JSON.parse(JSON.stringify(baseItemsUIUpdated)));
      // Itemsタブのプルダウン用にbaseItemsも更新
      setBaseItems(baseItemsData);
      setIsEditModeBaseItems(false);
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`保存に失敗しました: ${message}`);
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

  const handleBaseItemTypeChange = (
    id: string,
    type: "specific_weight" | "each"
  ) => {
    setBaseItemsUI(
      baseItemsUI.map((item) => {
        if (item.id !== id) return item;

        // 既に選択されているタイプの場合
        if (item.selectedType === type) {
          // 現在の値を確認
          const currentValue =
            type === "specific_weight" ? item.specific_weight : item.each_grams;

          // 値が空の場合のみ選択解除を許可
          if (currentValue === null || currentValue === undefined) {
            return {
              ...item,
              selectedType: null,
            };
          }

          // 値がある場合は何もしない（選択解除を拒否）
          return item;
        }

        // 別のタイプに切り替える場合、現在の値が空でないとダメ
        const currentValue =
          item.selectedType === "specific_weight"
            ? item.specific_weight
            : item.selectedType === "each"
            ? item.each_grams
            : null;

        // 現在の値が空でない場合は切り替えを許可しない
        if (currentValue !== null && currentValue !== undefined) {
          return item;
        }

        // 値が空の場合のみ切り替えを許可
        return {
          ...item,
          selectedType: type,
        };
      })
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
      selectedType: null,
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
    } catch (error: unknown) {
      console.error("Failed to save:", error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`保存に失敗しました: ${message}`);
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
  // 未使用の関数と変数を削除
  // const getLastItemId = () => {
  //   return vendorProducts.length > 0
  //     ? vendorProducts[vendorProducts.length - 1].id
  //     : "";
  // };

  // const getLastBaseItemId = () => {
  //   return baseItemsUI.length > 0 ? baseItemsUI[baseItemsUI.length - 1].id : "";
  // };

  // const getLastVendorId = () => {
  //   return vendorsUI.length > 0 ? vendorsUI[vendorsUI.length - 1].id : "";
  // };

  // Base ItemsとVendorsのオプション（SearchableSelect用）
  // const baseItemsOptions = baseItems.map((item) => ({
  //   id: item.id,
  //   name: item.name,
  // })); // 未使用のためコメントアウト

  // const vendorsOptions = vendors.map((vendor) => ({
  //   id: vendor.id,
  //   name: vendor.name,
  // })); // 未使用のためコメントアウト

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
              onClick={() => setActiveTab("items")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "items"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Vendor Items
            </button>
            <button
              onClick={() => setActiveTab("raw-items")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "raw-items"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Base Items
            </button>
            <button
              onClick={() => setActiveTab("vendors")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "vendors"
                  ? "border-blue-500 text-blue-600"
                  : isDark
                  ? "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-600"
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

        {/* Itemsタブ（vendor_productsテーブルを操作） */}
        {activeTab === "items" && (
          <>
            {loadingItems ? (
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
                        style={{ width: "15%" }}
                      >
                        Base Item Name
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "15%" }}
                      >
                        Vendor Name
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "20%" }}
                      >
                        Product Name
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "15%" }}
                      >
                        Brand Name
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "10%" }}
                      >
                        Unit
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "10%" }}
                      >
                        Quantity
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "15%" }}
                      >
                        Cost
                      </th>
                      {isEditModeItems && (
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
                    {vendorProducts.map((vp) => (
                      <Fragment key={vp.id}>
                        <tr
                          className={`transition-colors ${
                            vp.isMarkedForDeletion
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
                          {/* Base Item Name */}
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
                                <div
                                  className={`text-sm ${
                                    isDark ? "text-slate-100" : "text-gray-900"
                                  }`}
                                  style={{ height: "20px", lineHeight: "20px" }}
                                >
                                  {baseItems.find(
                                    (b) => b.id === vp.base_item_id
                                  )?.name || "-"}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Vendor Name */}
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
                                <div
                                  className={`text-sm ${
                                    isDark ? "text-slate-100" : "text-gray-900"
                                  }`}
                                  style={{ height: "20px", lineHeight: "20px" }}
                                >
                                  {vendors.find((v) => v.id === vp.vendor_id)
                                    ?.name || "-"}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Product Name */}
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
                                  className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                      : "border-gray-300"
                                  }`}
                                  placeholder="Product name"
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
                                  {vp.product_name}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Brand Name */}
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
                                  className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                      : "border-gray-300"
                                  }`}
                                  placeholder="Brand name (optional)"
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
                                  {vp.brand_name || "-"}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Unit */}
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
                              <div
                                className="flex items-center gap-2"
                                style={{ height: "20px" }}
                              >
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
                                    className="flex-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                    {unitOptions.map((unit) => {
                                      // eachの場合、対応するitemsレコードのeach_gramsを確認
                                      let isDisabled = false;
                                      let disabledReason = "";

                                      if (unit === "each" && vp.base_item_id) {
                                        const correspondingItem = items.find(
                                          (i) =>
                                            i.base_item_id === vp.base_item_id
                                        );
                                        isDisabled =
                                          !correspondingItem?.each_grams ||
                                          correspondingItem.each_grams === 0;
                                        if (isDisabled) {
                                          disabledReason =
                                            "Please set each_grams in the Base Items tab";
                                        }
                                      } else if (
                                        [
                                          "gallon",
                                          "liter",
                                          "floz",
                                          "ml",
                                        ].includes(unit) &&
                                        vp.base_item_id
                                      ) {
                                        // 非質量単位の場合、base_itemのspecific_weightを確認
                                        const correspondingBaseItem =
                                          baseItems.find(
                                            (bi) => bi.id === vp.base_item_id
                                          );
                                        isDisabled =
                                          !correspondingBaseItem?.specific_weight ||
                                          correspondingBaseItem.specific_weight ===
                                            0;
                                        if (isDisabled) {
                                          disabledReason =
                                            "Please set specific_weight in the Base Items tab";
                                        }
                                      }

                                      return (
                                        <option
                                          key={unit}
                                          value={unit}
                                          disabled={isDisabled}
                                          title={disabledReason}
                                        >
                                          {unit}
                                          {isDisabled && " (setup required)"}
                                        </option>
                                      );
                                    })}
                                  </select>
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
                                      style={{
                                        height: "20px",
                                        lineHeight: "20px",
                                      }}
                                    >
                                      {vp.purchase_unit}
                                    </span>
                                    {/* 警告（赤点） */}
                                    {vp.needsWarning && (
                                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                    )}
                                    {/* each_gramsが設定されている場合、表示 */}
                                    {vp.purchase_unit === "each" &&
                                      vp.each_grams && (
                                        <span
                                          className="text-xs text-gray-500"
                                          style={{ lineHeight: "20px" }}
                                        >
                                          ({vp.each_grams}g)
                                        </span>
                                      )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Quantity */}
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
                              {isEditModeItems ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    purchaseQuantityInputs.has(vp.id)
                                      ? purchaseQuantityInputs.get(vp.id) || ""
                                      : vp.purchase_quantity === 0
                                      ? ""
                                      : String(vp.purchase_quantity)
                                  }
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                    if (numericPattern.test(value)) {
                                      setPurchaseQuantityInputs((prev) => {
                                        const newMap = new Map(prev);
                                        newMap.set(vp.id, value);
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
                                    handleVendorProductChange(
                                      vp.id,
                                      "purchase_quantity",
                                      numValue
                                    );
                                    // 入力状態をクリア（次回表示時は実際の値から取得）
                                    setPurchaseQuantityInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(vp.id);
                                      return newMap;
                                    });
                                  }}
                                  className="w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="0"
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
                                  {vp.purchase_quantity}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Cost */}
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
                              {isEditModeItems ? (
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
                                      purchaseCostInputs.has(vp.id)
                                        ? purchaseCostInputs.get(vp.id) || ""
                                        : vp.purchase_cost === 0
                                        ? ""
                                        : String(vp.purchase_cost)
                                    }
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      // 数字と小数点のみを許可（空文字列も許可）
                                      const numericPattern =
                                        /^(\d+\.?\d*|\.\d+)?$/;
                                      if (numericPattern.test(value)) {
                                        setPurchaseCostInputs((prev) => {
                                          const newMap = new Map(prev);
                                          newMap.set(vp.id, value);
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
                                      handleVendorProductChange(
                                        vp.id,
                                        "purchase_cost",
                                        numValue
                                      );
                                      // 入力状態をクリア（次回表示時は実際の値から取得）
                                      setPurchaseCostInputs((prev) => {
                                        const newMap = new Map(prev);
                                        newMap.delete(vp.id);
                                        return newMap;
                                      });
                                    }}
                                    className="w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                  ${vp.purchase_cost.toFixed(2)}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* ゴミ箱 */}
                          <td
                            className="px-6 whitespace-nowrap"
                            style={{
                              paddingTop: "16px",
                              paddingBottom: "16px",
                              boxSizing: "border-box",
                            }}
                          >
                            {isEditModeItems && (
                              <button
                                onClick={() => handleDeleteClickItems(vp.id)}
                                className={`p-2 rounded-md transition-colors ${
                                  vp.isMarkedForDeletion
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
                      </Fragment>
                    ))}

                    {/* プラスマーク行 */}
                    {isEditModeItems && (
                      <tr>
                        <td
                          colSpan={isEditModeItems ? 8 : 7}
                          className="px-6"
                          style={{
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
                        >
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
          </>
        )}

        {/* Base Itemsタブ */}
        {activeTab === "raw-items" && (
          <>
            {loadingBaseItems ? (
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
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "50%" }}
                      >
                        NAME
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "25%" }}
                      >
                        <div className="flex items-center gap-1">
                          <span>SPECIFIC WEIGHT (g/ml)</span>
                          <div className="relative group">
                            <div className="w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center text-gray-400 text-xs cursor-help">
                              ?
                            </div>
                            <div className="absolute left-0 top-full mt-1 w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50">
                              Specific weight for volume-based items (e.g.,
                              liquids, powders). Used to convert ml to grams.
                            </div>
                          </div>
                        </div>
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "25%" }}
                      >
                        <div className="flex items-center gap-1">
                          <span>EACH (g)</span>
                          <div className="relative group">
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center text-xs cursor-help ${
                                isDark
                                  ? "border-slate-500 text-slate-400"
                                  : "border-gray-400 text-gray-400"
                              }`}
                            >
                              ?
                            </div>
                            <div className="absolute left-0 top-full mt-1 w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50">
                              Weight per piece for count-based items (e.g.,
                              eggs, fruits). Used to convert &apos;each&apos; to
                              grams.
                            </div>
                          </div>
                        </div>
                      </th>
                      {isEditModeBaseItems && (
                        <th
                          className={`px-6 py-3 text-left text-xs font-medium tracking-wider w-16 ${
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
                    {baseItemsUI.map((item) => (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          item.isMarkedForDeletion
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
                                className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                    : "border-gray-300"
                                }`}
                                placeholder="Base item name"
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
                                {item.name}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Specific Weight */}
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
                              gap: "8px",
                            }}
                          >
                            {isEditModeBaseItems ? (
                              <>
                                <input
                                  type="radio"
                                  name={`type-${item.id}`}
                                  checked={
                                    item.selectedType === "specific_weight"
                                  }
                                  onClick={() =>
                                    handleBaseItemTypeChange(
                                      item.id,
                                      "specific_weight"
                                    )
                                  }
                                  onChange={() =>
                                    handleBaseItemTypeChange(
                                      item.id,
                                      "specific_weight"
                                    )
                                  }
                                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                />
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    specificWeightInputs.has(item.id)
                                      ? specificWeightInputs.get(item.id)!
                                      : item.specific_weight === null ||
                                        item.specific_weight === undefined
                                      ? ""
                                      : String(item.specific_weight)
                                  }
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // 数字と小数点のみを許可（空文字列も許可）
                                    const numericPattern =
                                      /^(\d+\.?\d*|\.\d+)?$/;
                                    if (numericPattern.test(value)) {
                                      setSpecificWeightInputs((prev) => {
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
                                    handleBaseItemChange(
                                      item.id,
                                      "specific_weight",
                                      numValue
                                    );
                                    // selectedTypeは保持する（空にしても選択状態は維持）
                                    // 入力中の文字列をクリア
                                    setSpecificWeightInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(item.id);
                                      return newMap;
                                    });
                                  }}
                                  disabled={
                                    item.selectedType !== "specific_weight"
                                  }
                                  className={`flex-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed transition-colors ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400 disabled:bg-slate-800"
                                      : "border-gray-300 disabled:bg-gray-100"
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
                              </>
                            ) : (
                              <div
                                className={`text-sm ${
                                  isDark ? "text-slate-100" : "text-gray-900"
                                }`}
                                style={{ height: "20px", lineHeight: "20px" }}
                              >
                                {item.specific_weight
                                  ? item.specific_weight.toFixed(2)
                                  : "-"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Each (g) */}
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
                              gap: "8px",
                            }}
                          >
                            {isEditModeBaseItems ? (
                              <>
                                <input
                                  type="radio"
                                  name={`type-${item.id}`}
                                  checked={item.selectedType === "each"}
                                  onClick={() =>
                                    handleBaseItemTypeChange(item.id, "each")
                                  }
                                  onChange={() =>
                                    handleBaseItemTypeChange(item.id, "each")
                                  }
                                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                />
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    eachGramsInputs.has(item.id)
                                      ? eachGramsInputs.get(item.id)!
                                      : item.each_grams === null ||
                                        item.each_grams === undefined
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
                                    handleBaseItemChange(
                                      item.id,
                                      "each_grams",
                                      numValue
                                    );
                                    // selectedTypeは保持する（空にしても選択状態は維持）
                                    // 入力中の文字列をクリア
                                    setEachGramsInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(item.id);
                                      return newMap;
                                    });
                                  }}
                                  disabled={item.selectedType !== "each"}
                                  className={`flex-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed transition-colors ${
                                    isDark
                                      ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400 disabled:bg-slate-800"
                                      : "border-gray-300 disabled:bg-gray-100"
                                  }`}
                                  placeholder="0"
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
                              </>
                            ) : (
                              <div
                                className="text-sm text-gray-900"
                                style={{ height: "20px", lineHeight: "20px" }}
                              >
                                {item.each_grams
                                  ? item.each_grams.toFixed(2)
                                  : "-"}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* ゴミ箱 */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
                        >
                          {isEditModeBaseItems && (
                            <button
                              onClick={() =>
                                handleDeleteClickBaseItems(item.id)
                              }
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
                    ))}

                    {/* プラスマーク行 */}
                    {isEditModeBaseItems && (
                      <tr>
                        <td
                          colSpan={isEditModeBaseItems ? 4 : 3}
                          className="px-6"
                          style={{
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
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
          </>
        )}

        {/* Vendorsタブ */}
        {activeTab === "vendors" && (
          <>
            {loadingVendors ? (
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
                        style={{ width: "100%" }}
                      >
                        Name
                      </th>
                      {isEditModeVendors && (
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
                    {vendorsUI.map((vendor) => (
                      <tr
                        key={vendor.id}
                        className={`transition-colors ${
                          vendor.isMarkedForDeletion
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
                                className={`w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                  isDark
                                    ? "bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400"
                                    : "border-gray-300"
                                }`}
                                placeholder="Vendor name"
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
                                {vendor.name}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* ゴミ箱 */}
                        <td
                          className="px-6 whitespace-nowrap"
                          style={{
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
                        >
                          {isEditModeVendors && (
                            <button
                              onClick={() =>
                                handleDeleteClickVendors(vendor.id)
                              }
                              className={`p-2 rounded-md transition-colors ${
                                vendor.isMarkedForDeletion
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

                    {/* プラスマーク行 */}
                    {isEditModeVendors && (
                      <tr>
                        <td
                          colSpan={isEditModeVendors ? 2 : 1}
                          className="px-6"
                          style={{
                            paddingTop: "16px",
                            paddingBottom: "16px",
                            boxSizing: "border-box",
                          }}
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
          </>
        )}
      </div>
    </div>
  );
}
