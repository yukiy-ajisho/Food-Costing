"use client";

import { useState, Fragment, useEffect, useRef } from "react";
import { Edit, Save, Plus, Trash2, X, ArrowRight } from "lucide-react";
import {
  vendorProductsAPI,
  itemsAPI,
  baseItemsAPI,
  vendorsAPI,
  productMappingsAPI,
  priceEventsAPI,
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
  selectedType?: "specific_weight" | "each" | "none" | null; // ラジオボタンの選択状態
  isMarkedForDeletion?: boolean;
  isNew?: boolean;
  created_at?: string;
}

/** blur / Save 前 flush 共通: 小数入力の文字列を数値へ（0 も有効） */
function parseDecimalInputForCommit(raw: string): number | null {
  const v = raw.trim();
  if (v === "" || v === ".") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** 入力中 Map のドラフトを行データへ反映（種別と一致する行のみ） */
function flushBaseItemDraftsIntoRows(
  rows: BaseItemUI[],
  swInputs: Map<string, string>,
  egInputs: Map<string, string>
): BaseItemUI[] {
  return rows.map((row) => {
    const sel = row.selectedType ?? "none";
    let next: BaseItemUI = { ...row };

    if (swInputs.has(row.id) && sel === "specific_weight") {
      const n = parseDecimalInputForCommit(swInputs.get(row.id) ?? "");
      next = { ...next, specific_weight: n };
    }
    if (egInputs.has(row.id) && sel === "each") {
      const n = parseDecimalInputForCommit(egInputs.get(row.id) ?? "");
      next = { ...next, each_grams: n };
    }
    return next;
  });
}

interface VendorUI {
  id: string;
  name: string;
  created_at?: string;
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
  const [mappings, setMappings] = useState<ProductMapping[]>([]); // product_mappings（未使用base item判定用）
  const [originalVendorProducts, setOriginalVendorProducts] = useState<
    VendorProductUI[]
  >([]);
  const [isEditModeItems, setIsEditModeItems] = useState(false);
  const [isRecordPriceModeItems, setIsRecordPriceModeItems] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // 入力中のpurchase_quantityを文字列として保持（vp.id -> 入力中の文字列）
  const [purchaseQuantityInputs, setPurchaseQuantityInputs] = useState<
    Map<string, string>
  >(new Map());
  // 入力中の current_price（新規行のみ Edit で編集可）
  const [currentPriceInputs, setCurrentPriceInputs] = useState<
    Map<string, string>
  >(new Map());
  // Manual record new price 用の入力値（vp.id -> 入力中の文字列）
  const [newPriceInputs, setNewPriceInputs] = useState<Map<string, string>>(
    new Map()
  );

  // Base Itemsタブ用のstate
  const [baseItemsUI, setBaseItemsUI] = useState<BaseItemUI[]>([]);
  const [originalBaseItems, setOriginalBaseItems] = useState<BaseItemUI[]>([]);
  const [isEditModeBaseItems, setIsEditModeBaseItems] = useState(false);
  const [loadingBaseItems, setLoadingBaseItems] = useState(false);
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

  // ソート（タブごとに独立、localStorageで永続化）
  type SortOrder = "alphabetical" | "created_at";
  const [sortOrderItems, setSortOrderItems] = useState<SortOrder>(
    () => (typeof window !== "undefined" ? (localStorage.getItem("items_sort_items") as SortOrder) : null) ?? "created_at"
  );
  const [sortOrderBaseItems, setSortOrderBaseItems] = useState<SortOrder>(
    () => (typeof window !== "undefined" ? (localStorage.getItem("items_sort_base_items") as SortOrder) : null) ?? "created_at"
  );
  const [sortOrderVendors, setSortOrderVendors] = useState<SortOrder>(
    () => (typeof window !== "undefined" ? (localStorage.getItem("items_sort_vendors") as SortOrder) : null) ?? "created_at"
  );

  // 固定ヘッダーの高さ管理
  const fixedHeaderRef = useRef<HTMLDivElement>(null);
  const [fixedHeaderHeight, setFixedHeaderHeight] = useState(0);

  useEffect(() => {
    if (fixedHeaderRef.current) {
      setFixedHeaderHeight(fixedHeaderRef.current.offsetHeight);
    }
  }, []);

  useEffect(() => {
    // タブやテナントを切り替えたら、権限メッセージをリセットする
    setPermissionDenied(false);
  }, [activeTab, selectedTenantId]);

  // 単位オプション（質量単位 + 非質量単位、順番を制御）
  const unitOptions = [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED];

  // =========================================================
  // Itemsタブのデータ取得（vendor_productsテーブルを操作）
  // =========================================================
  useEffect(() => {
    if (activeTab !== "items") return;
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

    const fetchData = async () => {
      try {
        setLoadingItems(true);
        const [
          vendorProductsData,
          baseItemsData,
          vendorsData,
          itemsData,
          mappingsData,
        ] = await Promise.all([
          vendorProductsAPI.getAll(),
          baseItemsAPI.getAll(),
          vendorsAPI.getAll(),
          itemsAPI.getAll({ item_kind: "raw" }),
          productMappingsAPI.getAll(),
        ]);

        setBaseItems(baseItemsData);
        setVendors(vendorsData);
        setItems(itemsData);
        setMappings(mappingsData || []);

        // product_mappingsからbase_item_idを取得するマップを作成
        const virtualProductToBaseItemMap = new Map<string, string>();
        mappingsData?.forEach((mapping) => {
          virtualProductToBaseItemMap.set(
            mapping.virtual_product_id,
            mapping.base_item_id
          );
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
            const item = itemsData.find((i) => i.base_item_id === baseItemId);

            // 警告フラグをチェック
            const baseItem = baseItemsData.find((b) => b.id === baseItemId);
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
              current_price: vp.current_price,
              each_grams: item?.each_grams ?? null,
              needsWarning,
              created_at: vp.created_at,
            };
          })
          .filter((vp): vp is VendorProductUI => vp !== null);

        setVendorProducts(vendorProductsUI);
        setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
      } catch (error) {
        console.error("Failed to fetch data:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
        } else {
          alert("データの取得に失敗しました");
        }
      } finally {
        setLoadingItems(false);
      }
    };

    fetchData();
  }, [activeTab, selectedTenantId]);

  // =========================================================
  // Base Itemsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "raw-items") return;
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

    const fetchData = async () => {
      try {
        setLoadingBaseItems(true);
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
            const specificWeight = baseItem.specific_weight ?? null;
            const eachGrams = correspondingItem?.each_grams ?? null;
            // 既存の値から選択状態を判定
            let selectedType: "specific_weight" | "each" | "none" = "none";
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
              created_at: baseItem.created_at,
            };
          });
        setBaseItemsUI(baseItemsUI);
        setOriginalBaseItems(JSON.parse(JSON.stringify(baseItemsUI)));
      } catch (error) {
        console.error("Failed to fetch data:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
        } else {
          alert("データの取得に失敗しました");
        }
      } finally {
        setLoadingBaseItems(false);
      }
    };

    fetchData();
  }, [activeTab, selectedTenantId]);

  // =========================================================
  // Vendorsタブのデータ取得
  // =========================================================
  useEffect(() => {
    if (activeTab !== "vendors") return;
    // selectedTenantIdが設定されるまで待つ
    if (!selectedTenantId) return;

    const fetchData = async () => {
      try {
        setLoadingVendors(true);
        const vendorsData = await vendorsAPI.getAll();
        const vendorsUI: VendorUI[] = vendorsData.map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
          created_at: vendor.created_at,
        }));
        setVendorsUI(vendorsUI);
        setOriginalVendors(JSON.parse(JSON.stringify(vendorsUI)));
      } catch (error) {
        console.error("Failed to fetch data:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Forbidden: Insufficient permissions")) {
          setPermissionDenied(true);
        } else {
          alert("データの取得に失敗しました");
        }
      } finally {
        setLoadingVendors(false);
      }
    };

    fetchData();
  }, [activeTab, selectedTenantId]);

  // =========================================================
  // Itemsタブのハンドラー（vendor_productsテーブルを操作）
  // =========================================================
  const handleEditClickItems = () => {
    setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProducts)));
    setIsRecordPriceModeItems(false);
    setNewPriceInputs(new Map());
    setCurrentPriceInputs(new Map());
    setIsEditModeItems(true);
  };

  const handleRecordNewPriceClickItems = () => {
    setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProducts)));
    setIsEditModeItems(false);
    setPurchaseQuantityInputs(new Map());
    setCurrentPriceInputs(new Map());
    setIsRecordPriceModeItems(true);
  };

  const handleCancelClickItems = () => {
    if (isRecordPriceModeItems) {
      setNewPriceInputs(new Map());
      setIsRecordPriceModeItems(false);
      return;
    }
    setVendorProducts(JSON.parse(JSON.stringify(originalVendorProducts)));
    setPurchaseQuantityInputs(new Map());
    setCurrentPriceInputs(new Map());
    setIsEditModeItems(false);
  };

  const handleSaveClickItems = async () => {
    if (isRecordPriceModeItems) {
      try {
        setLoadingItems(true);
        const updates: Array<{ id: string; price: number }> = [];

        for (const vp of vendorProducts) {
          const raw = newPriceInputs.get(vp.id);
          if (raw === undefined) continue;
          const parsed = parseDecimalInputForCommit(raw);
          if (parsed === null) continue;
          if (parsed <= 0) {
            alert("New price must be greater than 0");
            return;
          }
          updates.push({ id: vp.id, price: parsed });
        }

        if (updates.length === 0) {
          setNewPriceInputs(new Map());
          setIsRecordPriceModeItems(false);
          return;
        }

        const changedVendorProductIds: string[] = [];
        for (const update of updates) {
          await priceEventsAPI.recordManual(update.id, update.price);
          changedVendorProductIds.push(update.id);
        }

        saveChangeHistory({
          changed_vendor_product_ids: changedVendorProductIds,
        });

        const [
          vendorProductsData,
          baseItemsData,
          vendorsData,
          itemsData,
          mappingsData,
        ] = await Promise.all([
          vendorProductsAPI.getAll(),
          baseItemsAPI.getAll(),
          vendorsAPI.getAll(),
          itemsAPI.getAll({ item_kind: "raw" }),
          productMappingsAPI.getAll(),
        ]);

        setBaseItems(baseItemsData);
        setVendors(vendorsData);
        setItems(itemsData);
        setMappings(mappingsData || []);

        const virtualProductToBaseItemMap = new Map<string, string>();
        mappingsData?.forEach((mapping) => {
          virtualProductToBaseItemMap.set(
            mapping.virtual_product_id,
            mapping.base_item_id
          );
        });

        const vendorProductsUI: VendorProductUI[] = vendorProductsData
          .filter((vp) => !vp.deprecated)
          .map((vp): VendorProductUI | null => {
            const baseItemId = virtualProductToBaseItemMap.get(vp.id);
            if (!baseItemId) return null;

            const item = itemsData.find((i) => i.base_item_id === baseItemId);
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
              current_price: vp.current_price,
              each_grams: item?.each_grams ?? null,
              needsWarning,
              created_at: vp.created_at,
            };
          })
          .filter((vp): vp is VendorProductUI => vp !== null);

        setVendorProducts(vendorProductsUI);
        setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
        setNewPriceInputs(new Map());
        setIsRecordPriceModeItems(false);
      } catch (error: unknown) {
        console.error("Failed to record prices:", error);
        const message = error instanceof Error ? error.message : String(error);
        alert(`価格記録に失敗しました: ${message}`);
      } finally {
        setLoadingItems(false);
      }
      return;
    }

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
          vp.current_price === 0
        ) {
          return false;
        }
        return true;
      });

      for (const vp of filteredVendorProducts) {
        if (vp.isNew) {
          if (
            !Number.isFinite(vp.current_price) ||
            vp.current_price <= 0
          ) {
            alert(
              "新規行の Cost は 0 より大きい数値にしてください（変更は New price で記録します）。"
            );
            setLoadingItems(false);
            return;
          }
        }
      }

      // 変更されたvendor_productのIDを追跡
      const changedVendorProductIds: string[] = [];

      // API呼び出し
      for (const vp of filteredVendorProducts) {
        if (vp.isNew) {
          // 新規作成: virtual_vendor_products + price_events（バックエンド）
          const newVp = await vendorProductsAPI.create({
            vendor_id: vp.vendor_id,
            product_name: vp.product_name || null,
            brand_name: vp.brand_name || null,
            purchase_unit: vp.purchase_unit,
            purchase_quantity: vp.purchase_quantity,
            current_price: vp.current_price,
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
      const [
        vendorProductsData,
        baseItemsData,
        vendorsData,
        itemsData,
        mappingsData,
      ] = await Promise.all([
        vendorProductsAPI.getAll(),
        baseItemsAPI.getAll(),
        vendorsAPI.getAll(),
        itemsAPI.getAll({ item_kind: "raw" }),
        productMappingsAPI.getAll(),
      ]);

      setBaseItems(baseItemsData);
      setVendors(vendorsData);
      setItems(itemsData);
      setMappings(mappingsData || []);

      // product_mappingsからbase_item_idを取得するマップを作成
      const virtualProductToBaseItemMap = new Map<string, string>();
      mappingsData?.forEach((mapping) => {
        virtualProductToBaseItemMap.set(
          mapping.virtual_product_id,
          mapping.base_item_id
        );
      });

      const vendorProductsUI: VendorProductUI[] = vendorProductsData
        .filter((vp) => !vp.deprecated)
        .map((vp): VendorProductUI | null => {
          // product_mappingsからbase_item_idを取得
          const baseItemId = virtualProductToBaseItemMap.get(vp.id);
          if (!baseItemId) {
            return null;
          }

          const item = itemsData.find((i) => i.base_item_id === baseItemId);
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
            current_price: vp.current_price,
            each_grams: item?.each_grams ?? null,
            needsWarning,
            created_at: vp.created_at,
          };
        })
        .filter((vp): vp is VendorProductUI => vp !== null);

      setVendorProducts(vendorProductsUI);
      setOriginalVendorProducts(JSON.parse(JSON.stringify(vendorProductsUI)));
      setPurchaseQuantityInputs(new Map());
      setCurrentPriceInputs(new Map());
      setIsEditModeItems(false);
      setIsRecordPriceModeItems(false);
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
      current_price: 0,
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
    setSpecificWeightInputs(new Map());
    setEachGramsInputs(new Map());
    setIsEditModeBaseItems(true);
  };

  const handleCancelClickBaseItems = () => {
    setBaseItemsUI(JSON.parse(JSON.stringify(originalBaseItems)));
    setSpecificWeightInputs(new Map());
    setEachGramsInputs(new Map());
    setIsEditModeBaseItems(false);
  };

  const handleSaveClickBaseItems = async () => {
    try {
      setLoadingBaseItems(true);

      const merged = flushBaseItemDraftsIntoRows(
        baseItemsUI,
        specificWeightInputs,
        eachGramsInputs
      );
      setBaseItemsUI(merged);
      setSpecificWeightInputs(new Map());
      setEachGramsInputs(new Map());

      for (const item of merged) {
        if (item.isMarkedForDeletion) continue;
        if (item.isNew && item.name.trim() === "") continue;

        if (item.selectedType === "specific_weight") {
          const sw = item.specific_weight;
          if (sw === null || sw === undefined) {
            alert(
              `"${
                item.name?.trim() || "(untitled)"
              }" has Specific weight selected but no value was entered.\n\nEnter a positive number or switch to None before saving.`
            );
            setLoadingBaseItems(false);
            return;
          }
          if (sw === 0) {
            alert(
              `"${
                item.name?.trim() || "(untitled)"
              }": Specific weight cannot be 0 (it would make cost calculations invalid).\n\nEnter a positive number or switch to None before saving.`
            );
            setLoadingBaseItems(false);
            return;
          }
        }
        if (item.selectedType === "each") {
          const eg = item.each_grams;
          if (eg === null || eg === undefined) {
            alert(
              `"${
                item.name?.trim() || "(untitled)"
              }" has Each (g) selected but no value was entered.\n\nEnter a positive number or switch to None before saving.`
            );
            setLoadingBaseItems(false);
            return;
          }
          if (eg === 0) {
            alert(
              `"${
                item.name?.trim() || "(untitled)"
              }": Each (g) cannot be 0 (it would make cost calculations invalid).\n\nEnter a positive number or switch to None before saving.`
            );
            setLoadingBaseItems(false);
            return;
          }
        }
      }

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
        virtualProductToBaseItemMap.set(
          mapping.virtual_product_id,
          mapping.base_item_id
        );
      });

      // vendorProductsにbase_item_idを追加（表示用）
      const allVendorProductsWithBaseItemId = allVendorProducts.map((vp) => ({
        ...vp,
        base_item_id: virtualProductToBaseItemMap.get(vp.id) || "",
      }));

      for (const item of merged) {
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

      const filteredBaseItems = merged.filter((item) => {
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
            specific_weight: item.specific_weight ?? null,
          });
          baseItemId = newBaseItem.id;
          changedBaseItemIds.push(baseItemId);
        } else {
          // Base Itemを更新
          await baseItemsAPI.update(item.id, {
            name: item.name,
            specific_weight: item.specific_weight ?? null,
          });
          baseItemId = item.id;
          changedBaseItemIds.push(baseItemId);
        }

        // 対応するitemsレコードを取得または作成
        const itemsData = await itemsAPI.getAll({ item_kind: "raw" });
        let correspondingItem = itemsData.find(
          (i) => i.base_item_id === baseItemId
        );

        // itemsレコードが存在しない場合は作成（Raw Itemのnameはnull）
        if (!correspondingItem) {
          const newItem = await itemsAPI.create({
            name: null, // Raw Itemのnameはnull（Base Itemのnameを使用）
            item_kind: "raw",
            is_menu_item: false,
            base_item_id: baseItemId,
            each_grams: item.each_grams ?? null,
          });
          correspondingItem = newItem;
          changedItemIds.push(newItem.id);
        } else {
          // itemsレコードが存在する場合は、each_gramsのみ更新（nameは更新しない）
          if (item.each_grams !== undefined) {
            await itemsAPI.update(correspondingItem.id, {
              each_grams: item.each_grams ?? null,
            });
            changedItemIds.push(correspondingItem.id);
          }
        }
      }

      for (const item of merged) {
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
          const specificWeight = baseItem.specific_weight ?? null;
          const eachGrams = correspondingItem?.each_grams ?? null;
          // 既存の値から選択状態を判定
          let selectedType: "specific_weight" | "each" | "none" = "none";
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
            created_at: baseItem.created_at,
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
    setBaseItemsUI((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleBaseItemTypeChange = (
    id: string,
    type: "specific_weight" | "each" | "none"
  ) => {
    setBaseItemsUI((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        // 既に選択されているタイプの場合は何もしない
        if (item.selectedType === type) {
          return item;
        }

        // NONEに切り替える場合
        if (type === "none") {
          return {
            ...item,
            selectedType: "none",
            specific_weight: null,
            each_grams: null,
          };
        }

        // specific_weightまたはeachに切り替える場合
        // 切り替える際に、もう一方の値をクリア
        return {
          ...item,
          selectedType: type,
          specific_weight:
            type === "specific_weight" ? item.specific_weight : null,
          each_grams: type === "each" ? item.each_grams : null,
        };
      })
    );
    setSpecificWeightInputs((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setEachGramsInputs((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDeleteClickBaseItems = (id: string) => {
    setBaseItemsUI((prev) =>
      prev.map((item) =>
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
      selectedType: "none",
      isNew: true,
    };
    setBaseItemsUI((prev) => [...prev, newItem]);
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
        created_at: vendor.created_at,
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
    (activeTab === "items" && (isEditModeItems || isRecordPriceModeItems)) ||
    (activeTab === "raw-items" && isEditModeBaseItems) ||
    (activeTab === "vendors" && isEditModeVendors);

  // Edit/Save/Cancelボタンのハンドラー
  const handleEditClick = () => {
    if (activeTab === "items") handleEditClickItems();
    else if (activeTab === "raw-items") handleEditClickBaseItems();
    else if (activeTab === "vendors") handleEditClickVendors();
  };

  const handleRecordNewPriceClick = () => {
    if (activeTab === "items") handleRecordNewPriceClickItems();
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

  const makeSortFn = <T extends { created_at?: string; name?: string }>(order: SortOrder) =>
    (a: T, b: T) => {
      if (!a.created_at && !b.created_at) return 0;
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      if (order === "alphabetical") {
        return (a.name ?? "").localeCompare(b.name ?? "");
      }
      return a.created_at.localeCompare(b.created_at);
    };

  const sortedVendorProducts = [...vendorProducts].sort((a, b) => {
    if (!a.created_at && !b.created_at) return 0;
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    if (sortOrderItems === "alphabetical") {
      const nameA = baseItems.find(bi => bi.id === (a as VendorProductUI).base_item_id)?.name ?? a.product_name ?? "";
      const nameB = baseItems.find(bi => bi.id === (b as VendorProductUI).base_item_id)?.name ?? b.product_name ?? "";
      return nameA.localeCompare(nameB);
    }
    return a.created_at.localeCompare(b.created_at);
  });

  const sortedBaseItemsUI = [...baseItemsUI].sort(makeSortFn(sortOrderBaseItems));
  const sortedVendorsUI = [...vendorsUI].sort(makeSortFn(sortOrderVendors));

  if (permissionDenied) {
    return (
      <div className="px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          <div
            className={`rounded-lg shadow-sm border p-8 text-center transition-colors ${
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            You don&apos;t have permission.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 pb-8">
      <div className="max-w-7xl mx-auto">
        {/* 固定ヘッダー（タブ＋ボタン） */}
        <div
          ref={fixedHeaderRef}
          className={`sticky top-0 z-50 -mx-8 px-8 py-4 ${
            isDark ? "bg-slate-900" : "bg-gray-50"
          }`}
        >
          {/* タブ */}
          <div
            className={`mb-4 border-b transition-colors ${
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

          {/* ソート＋Edit/Save/Cancelボタン */}
          <div className="flex justify-between items-center gap-2">
            {/* ソートドロップダウン（左側・タブごとに独立） */}
            {activeTab === "items" && (
              <select
                value={sortOrderItems}
                onChange={(e) => {
                  const v = e.target.value as SortOrder;
                  setSortOrderItems(v);
                  localStorage.setItem("items_sort_items", v);
                }}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-200"
                    : "bg-white border-gray-300 text-gray-700"
                }`}
              >
                <option value="created_at">Date added</option>
                <option value="alphabetical">A-Z</option>
              </select>
            )}
            {activeTab === "raw-items" && (
              <select
                value={sortOrderBaseItems}
                onChange={(e) => {
                  const v = e.target.value as SortOrder;
                  setSortOrderBaseItems(v);
                  localStorage.setItem("items_sort_base_items", v);
                }}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-200"
                    : "bg-white border-gray-300 text-gray-700"
                }`}
              >
                <option value="created_at">Date added</option>
                <option value="alphabetical">A-Z</option>
              </select>
            )}
            {activeTab === "vendors" && (
              <select
                value={sortOrderVendors}
                onChange={(e) => {
                  const v = e.target.value as SortOrder;
                  setSortOrderVendors(v);
                  localStorage.setItem("items_sort_vendors", v);
                }}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-slate-200"
                    : "bg-white border-gray-300 text-gray-700"
                }`}
              >
                <option value="created_at">Date added</option>
                <option value="alphabetical">A-Z</option>
              </select>
            )}
            {/* Edit/Save/Cancelボタン（右側） */}
            <div className="flex items-center gap-2">
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
              <>
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
                {activeTab === "items" && (
                  <button
                    onClick={handleRecordNewPriceClick}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Manual record new price
                  </button>
                )}
              </>
            )}
            </div>
          </div>
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
                className={`rounded-lg shadow-sm border transition-colors ${
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
                    className={`border-b transition-colors sticky z-10 ${
                      isDark
                        ? "bg-slate-700 border-slate-600"
                        : "bg-gray-50 border-gray-200"
                    }`}
                    style={{ top: `${fixedHeaderHeight}px` }}
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
                        Quantity
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
                        style={{ width: "15%" }}
                      >
                        Cost
                      </th>
                      {isRecordPriceModeItems && (
                        <>
                          <th
                            className="px-1 py-3"
                            style={{ width: "4%" }}
                          />
                          <th
                            className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-blue-700"
                            style={{ width: "15%" }}
                          >
                            New price
                          </th>
                        </>
                      )}
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
                    {sortedVendorProducts.map((vp) => (
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
                                  options={(() => {
                                    // 使用済みbase_item_idのSetを作成
                                    const usedBaseItemIds = new Set(
                                      mappings.map((m) => m.base_item_id)
                                    );
                                    return baseItems
                                    .filter((b) => !b.deprecated)
                                    .map((b) => ({
                                      id: b.id,
                                      name: b.name,
                                        isUnused: !usedBaseItemIds.has(b.id),
                                      }));
                                  })()}
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
                                vp.isNew ? (
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
                                        currentPriceInputs.has(vp.id)
                                          ? currentPriceInputs.get(vp.id) || ""
                                          : vp.current_price === 0
                                            ? ""
                                            : String(vp.current_price)
                                      }
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        const numericPattern =
                                          /^(\d+\.?\d*|\.\d+)?$/;
                                        if (numericPattern.test(value)) {
                                          setCurrentPriceInputs((prev) => {
                                            const newMap = new Map(prev);
                                            newMap.set(vp.id, value);
                                            return newMap;
                                          });
                                        }
                                      }}
                                      onBlur={(e) => {
                                        const value = e.target.value;
                                        const numValue =
                                          value === "" || value === "."
                                            ? 0
                                            : parseFloat(value) || 0;
                                        handleVendorProductChange(
                                          vp.id,
                                          "current_price",
                                          numValue
                                        );
                                        setCurrentPriceInputs((prev) => {
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
                                    title="Change price using Record new price"
                                  >
                                    ${(vp.current_price ?? 0).toFixed(2)}
                                  </div>
                                )
                              ) : (
                                <div
                                  className={`text-sm ${
                                    isDark ? "text-slate-100" : "text-gray-900"
                                  }`}
                                  style={{ height: "20px", lineHeight: "20px" }}
                                >
                                  ${(vp.current_price ?? 0).toFixed(2)}
                                </div>
                              )}
                            </div>
                          </td>

                          {isRecordPriceModeItems && (
                            <>
                              <td
                                className="pl-0 pr-1 whitespace-nowrap text-left"
                                style={{
                                  paddingTop: "16px",
                                  paddingBottom: "16px",
                                  boxSizing: "border-box",
                                }}
                              >
                                <ArrowRight
                                  className={`w-5 h-5 inline ${
                                    isDark ? "text-slate-100" : "text-black"
                                  }`}
                                  strokeWidth={2.6}
                                />
                              </td>
                              <td
                                className="px-6 whitespace-nowrap"
                                style={{
                                  paddingTop: "16px",
                                  paddingBottom: "16px",
                                  boxSizing: "border-box",
                                }}
                              >
                                <div
                                  className="flex items-center gap-1"
                                  style={{ height: "20px" }}
                                >
                                  <span
                                    className={`${
                                      isDark ? "text-slate-400" : "text-gray-500"
                                    }`}
                                    style={{ lineHeight: "20px" }}
                                  >
                                    $
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={newPriceInputs.get(vp.id) || ""}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      const numericPattern =
                                        /^(\d+\.?\d*|\.\d+)?$/;
                                      if (numericPattern.test(value)) {
                                        setNewPriceInputs((prev) => {
                                          const newMap = new Map(prev);
                                          if (value === "") {
                                            newMap.delete(vp.id);
                                          } else {
                                            newMap.set(vp.id, value);
                                          }
                                          return newMap;
                                        });
                                      }
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
                              </td>
                            </>
                          )}

                          {/* ゴミ箱 */}
                          {isEditModeItems && (
                            <td
                              className="px-6 whitespace-nowrap"
                              style={{
                                paddingTop: "16px",
                                paddingBottom: "16px",
                                boxSizing: "border-box",
                              }}
                            >
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
                            </td>
                          )}
                        </tr>
                      </Fragment>
                    ))}

                    {/* プラスマーク行 */}
                    {isEditModeItems && (
                      <tr>
                        <td
                          colSpan={8}
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
                className={`rounded-lg shadow-sm border transition-colors ${
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
                    className={`border-b transition-colors sticky z-10 ${
                      isDark
                        ? "bg-slate-700 border-slate-600"
                        : "bg-gray-50 border-gray-200"
                    }`}
                    style={{ top: `${fixedHeaderHeight}px` }}
                  >
                    <tr>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "40%" }}
                      >
                        NAME
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "15%" }}
                      >
                        NONE
                      </th>
                      <th
                        className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${
                          isDark ? "text-slate-300" : "text-gray-500"
                        }`}
                        style={{ width: "22.5%" }}
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
                        style={{ width: "22.5%" }}
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
                    {sortedBaseItemsUI.map((item) => (
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

                        {/* NONE */}
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
                            <input
                              type="radio"
                              name={`type-${item.id}`}
                              checked={(item.selectedType ?? "none") === "none"}
                              onClick={() =>
                                handleBaseItemTypeChange(item.id, "none")
                              }
                              onChange={() =>
                                handleBaseItemTypeChange(item.id, "none")
                              }
                              disabled={!isEditModeBaseItems}
                              className="w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                            />
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
                                <input
                                  type="radio"
                                  name={`type-${item.id}`}
                                  checked={
                                (item.selectedType ?? "none") === "specific_weight"
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
                              disabled={!isEditModeBaseItems}
                              className="w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                                />
                            {isEditModeBaseItems ? (
                              <>
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
                                    const numValue = parseDecimalInputForCommit(
                                      e.target.value
                                    );
                                    setBaseItemsUI((prev) =>
                                      prev.map((row) => {
                                        if (row.id !== item.id) return row;
                                        if (numValue !== null) {
                                          return {
                                            ...row,
                                            selectedType: "specific_weight",
                                            specific_weight: numValue,
                                            each_grams: null,
                                          };
                                        }
                                        // 空で blur してもラジオ選択は維持（Save で未入力エラーにできる）
                                        return {
                                          ...row,
                                          selectedType: "specific_weight",
                                          specific_weight: null,
                                          each_grams: null,
                                        };
                                      })
                                    );
                                    setSpecificWeightInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(item.id);
                                      return newMap;
                                    });
                                  }}
                                  disabled={
                                    (item.selectedType ?? "none") !== "specific_weight"
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
                                <input
                                  type="radio"
                                  name={`type-${item.id}`}
                              checked={(item.selectedType ?? "none") === "each"}
                                  onClick={() =>
                                    handleBaseItemTypeChange(item.id, "each")
                                  }
                                  onChange={() =>
                                    handleBaseItemTypeChange(item.id, "each")
                                  }
                              disabled={!isEditModeBaseItems}
                              className="w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                                />
                            {isEditModeBaseItems ? (
                              <>
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
                                    const numValue = parseDecimalInputForCommit(
                                      e.target.value
                                    );
                                    setBaseItemsUI((prev) =>
                                      prev.map((row) => {
                                        if (row.id !== item.id) return row;
                                        if (numValue !== null) {
                                          return {
                                            ...row,
                                            selectedType: "each",
                                            each_grams: numValue,
                                            specific_weight: null,
                                          };
                                        }
                                        // 空で blur してもラジオ選択は維持（Save で未入力エラーにできる）
                                        return {
                                          ...row,
                                          selectedType: "each",
                                          specific_weight: null,
                                          each_grams: null,
                                        };
                                      })
                                    );
                                    setEachGramsInputs((prev) => {
                                      const newMap = new Map(prev);
                                      newMap.delete(item.id);
                                      return newMap;
                                    });
                                  }}
                                  disabled={(item.selectedType ?? "none") !== "each"}
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
                className={`rounded-lg shadow-sm border transition-colors ${
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
                    className={`border-b transition-colors sticky z-10 ${
                      isDark
                        ? "bg-slate-700 border-slate-600"
                        : "bg-gray-50 border-gray-200"
                    }`}
                    style={{ top: `${fixedHeaderHeight}px` }}
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
                    {sortedVendorsUI.map((vendor) => (
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
