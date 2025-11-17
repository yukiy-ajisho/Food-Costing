"use client";

import { useState, Fragment, useEffect } from "react";
import {
  Edit,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  itemsAPI,
  recipeLinesAPI,
  laborRolesAPI,
  costAPI,
  baseItemsAPI,
  vendorProductsAPI,
  type Item,
  type RecipeLine as APIRecipeLine,
  type LaborRole,
  type BaseItem,
  type VendorProduct,
} from "@/lib/api";
import { checkCyclesForItems } from "@/lib/cycle-detection";
import {
  MASS_UNIT_CONVERSIONS,
  NON_MASS_UNITS,
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  VOLUME_UNIT_TO_LITERS,
  isNonMassUnit,
  isMassUnit,
} from "@/lib/constants";

// Recipe Lineの型定義（UI用）
interface RecipeLine {
  id: string;
  line_type: "ingredient" | "labor";
  child_item_id?: string; // ingredient only
  quantity?: number; // ingredient only
  unit?: string; // ingredient only
  labor_role?: string; // labor only
  minutes?: number; // labor only
  isMarkedForDeletion?: boolean;
  isNew?: boolean; // 新規作成フラグ
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
}

// 単位のオプション（順番を制御）
const unitOptions = [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED];

// Yieldの単位オプション（gとeachのみ）
const yieldUnitOptions = ["g", "each"];

export default function CostPage() {
  const [items, setItems] = useState<PreppedItem[]>([]);
  const [availableItems, setAvailableItems] = useState<Item[]>([]);
  const [baseItems, setBaseItems] = useState<BaseItem[]>([]);
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [originalItems, setOriginalItems] = useState<PreppedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearchTerm, setAppliedSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [yieldMin, setYieldMin] = useState<number | "">("");
  const [yieldMax, setYieldMax] = useState<number | "">("");
  const [costMin, setCostMin] = useState<number | "">("");
  const [costMax, setCostMax] = useState<number | "">("");
  const [loading, setLoading] = useState(true);

  // データ取得
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Prepped/Menu Itemsを取得
        const preppedItems = await itemsAPI.getAll({ item_kind: "prepped" });
        // 全アイテムを取得（ingredient選択用）
        const allItems = await itemsAPI.getAll();
        setAvailableItems(allItems);
        // Base Itemsを取得（バリデーション用）
        const baseItemsData = await baseItemsAPI.getAll();
        setBaseItems(baseItemsData);
        // Vendor Productsを取得（バリデーション用）
        const vendorProductsData = await vendorProductsAPI.getAll();
        setVendorProducts(vendorProductsData);
        // Labor Rolesを取得
        const roles = await laborRolesAPI.getAll();
        setLaborRoles(roles);

        // 各アイテムのレシピを取得
        const itemsWithRecipes: PreppedItem[] = await Promise.all(
          preppedItems.map(async (item) => {
            const recipeLines = await recipeLinesAPI.getByItemId(item.id);
            // コストを計算
            let costPerGram: number | undefined;
            try {
              const costData = await costAPI.getCost(item.id);
              costPerGram = costData.cost_per_gram;
            } catch (error) {
              console.error(
                `Failed to calculate cost for item ${item.id}:`,
                error
              );
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
                labor_role: line.labor_role || undefined,
                minutes: line.minutes || undefined,
              })),
              notes: item.notes || "",
              isExpanded: false,
              cost_per_gram: costPerGram,
            };
          })
        );

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
  }, []);

  // Editモード切り替え
  const handleEditClick = () => {
    // 現在の状態を保存
    setOriginalItems(JSON.parse(JSON.stringify(items)));
    setIsEditMode(true);
  };

  // Cancel処理
  const handleCancelClick = () => {
    // 元の状態に戻す
    setItems(JSON.parse(JSON.stringify(originalItems)));
    setIsEditMode(false);
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

    // Yieldが"g"の場合
    const multiplier = MASS_UNIT_CONVERSIONS[yieldUnit];
    if (!multiplier) {
      return -1; // エラーを示す値
    }
    return yieldAmount * multiplier;
  };

  // 材料の総合計をグラムで計算
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

  // Save処理
  const handleSaveClick = async () => {
    try {
      setLoading(true);

      // 削除予定のアイテムと空の新規レコードをフィルター
      const filteredItems = items.filter((item) => {
        if (item.isMarkedForDeletion) return false;
        if (item.name.trim() === "" && item.proceed_yield_amount === 0) {
          return false;
        }
        return true;
      });

      // バリデーション: Yieldが材料の総合計を超えないかチェック
      for (const item of filteredItems) {
        // Yieldが"each"の場合はバリデーションをスキップ（グラムに変換できないため）
        if (item.proceed_yield_unit === "each") {
          continue;
        }

        const totalIngredientsGrams = calculateTotalIngredientsGrams(
          item.recipe_lines
        );
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
          alert(
            `"${item.name}"のProceed（${item.proceed_yield_amount} ${
              item.proceed_yield_unit
            } = ${yieldGrams.toFixed(
              2
            )}g）が材料の総合計（${totalIngredientsGrams.toFixed(
              2
            )}g）を超えています。Proceedは材料の総合計以下である必要があります。`
          );
          setLoading(false);
          return;
        }
      }

      // 循環参照チェック（保存前）
      try {
        // すべてのアイテムを取得
        const allItems = await itemsAPI.getAll();
        const itemsMap = new Map<string, Item>();
        allItems.forEach((item) => itemsMap.set(item.id, item));

        // すべてのレシピラインを取得
        const allRecipeLines: APIRecipeLine[] = [];
        for (const item of allItems) {
          if (item.item_kind === "prepped") {
            const lines = await recipeLinesAPI.getByItemId(item.id);
            allRecipeLines.push(...lines);
          }
        }

        // レシピラインのマップを作成
        const recipeLinesMap = new Map<string, APIRecipeLine[]>();
        allRecipeLines.forEach((line) => {
          if (line.line_type === "ingredient") {
            const existing = recipeLinesMap.get(line.parent_item_id) || [];
            existing.push(line);
            recipeLinesMap.set(line.parent_item_id, existing);
          }
        });

        // 更新されるアイテムのレシピラインを反映
        for (const item of filteredItems) {
          if (!item.isNew) {
            // 既存アイテムの更新の場合、新しいレシピラインを反映
            const updatedLines: APIRecipeLine[] = [];
            for (const line of item.recipe_lines) {
              if (line.isMarkedForDeletion) continue;
              if (line.line_type === "ingredient") {
                if (!line.child_item_id || !line.quantity || !line.unit)
                  continue;
                if (line.isNew) {
                  // 新規レシピライン（一時的なIDを使用）
                  updatedLines.push({
                    id: `temp-${item.id}-${line.id}`,
                    parent_item_id: item.id,
                    line_type: "ingredient",
                    child_item_id: line.child_item_id,
                    quantity: line.quantity,
                    unit: line.unit,
                    labor_role: null,
                    minutes: null,
                  } as APIRecipeLine);
                } else {
                  // 既存レシピラインの更新
                  updatedLines.push({
                    id: line.id,
                    parent_item_id: item.id,
                    line_type: "ingredient",
                    child_item_id: line.child_item_id || null,
                    quantity: line.quantity || null,
                    unit: line.unit || null,
                    labor_role: null,
                    minutes: null,
                  } as APIRecipeLine);
                }
              }
            }
            recipeLinesMap.set(item.id, updatedLines);
          } else {
            // 新規アイテムの場合、一時的なIDを使用（一意性を確保するため、インデックスを使用）
            const itemIndex = filteredItems.findIndex((i) => i === item);
            const tempId = `temp-new-${itemIndex}`;
            itemsMap.set(tempId, {
              id: tempId,
              name: item.name,
              item_kind: "prepped",
              is_menu_item: item.is_menu_item,
              proceed_yield_amount: item.proceed_yield_amount,
              proceed_yield_unit: item.proceed_yield_unit,
              notes: item.notes || null,
              base_item_id: null,
              each_grams: null,
            } as Item);

            const newLines: APIRecipeLine[] = [];
            for (const line of item.recipe_lines) {
              if (line.isMarkedForDeletion) continue;
              if (line.line_type === "ingredient") {
                if (!line.child_item_id || !line.quantity || !line.unit)
                  continue;
                newLines.push({
                  id: `temp-${tempId}-${line.id}`,
                  parent_item_id: tempId,
                  line_type: "ingredient",
                  child_item_id: line.child_item_id,
                  quantity: line.quantity,
                  unit: line.unit,
                  labor_role: null,
                  minutes: null,
                } as APIRecipeLine);
              }
            }
            recipeLinesMap.set(tempId, newLines);
          }
        }

        // チェックするアイテムIDのリストを作成
        const itemIdsToCheck: string[] = [];
        for (let i = 0; i < filteredItems.length; i++) {
          const item = filteredItems[i];
          if (item.isNew) {
            itemIdsToCheck.push(`temp-new-${i}`);
          } else {
            itemIdsToCheck.push(item.id);
          }
        }

        // 循環参照をチェック
        checkCyclesForItems(itemIdsToCheck, itemsMap, recipeLinesMap);
      } catch (cycleError: any) {
        alert(cycleError.message);
        setLoading(false);
        return;
      }

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
          });

          // レシピラインを作成
          for (const line of item.recipe_lines) {
            if (line.isMarkedForDeletion) continue;
            if (line.line_type === "ingredient") {
              if (!line.child_item_id || !line.quantity || !line.unit) continue;
              await recipeLinesAPI.create({
                parent_item_id: newItem.id,
                line_type: "ingredient",
                child_item_id: line.child_item_id,
                quantity: line.quantity,
                unit: line.unit,
              });
            } else if (line.line_type === "labor") {
              if (!line.minutes) continue;
              await recipeLinesAPI.create({
                parent_item_id: newItem.id,
                line_type: "labor",
                labor_role: line.labor_role || null,
                minutes: line.minutes,
              });
            }
          }
        } else {
          // 更新
          await itemsAPI.update(item.id, {
            name: item.name,
            is_menu_item: item.is_menu_item,
            proceed_yield_amount: item.proceed_yield_amount,
            proceed_yield_unit: item.proceed_yield_unit,
            notes: item.notes || null,
          });

          // レシピラインを更新
          for (const line of item.recipe_lines) {
            if (line.isMarkedForDeletion && !line.isNew) {
              await recipeLinesAPI.delete(line.id);
            } else if (line.isNew) {
              if (line.line_type === "ingredient") {
                if (!line.child_item_id || !line.quantity || !line.unit)
                  continue;
                await recipeLinesAPI.create({
                  parent_item_id: item.id,
                  line_type: "ingredient",
                  child_item_id: line.child_item_id,
                  quantity: line.quantity,
                  unit: line.unit,
                });
              } else if (line.line_type === "labor") {
                if (!line.minutes) continue;
                await recipeLinesAPI.create({
                  parent_item_id: item.id,
                  line_type: "labor",
                  labor_role: line.labor_role || null,
                  minutes: line.minutes,
                });
              }
            } else {
              if (line.line_type === "ingredient") {
                await recipeLinesAPI.update(line.id, {
                  child_item_id: line.child_item_id || null,
                  quantity: line.quantity || null,
                  unit: line.unit || null,
                });
              } else if (line.line_type === "labor") {
                await recipeLinesAPI.update(line.id, {
                  labor_role: line.labor_role || null,
                  minutes: line.minutes || null,
                });
              }
            }
          }
        }
      }

      // 削除処理
      for (const item of items) {
        if (item.isMarkedForDeletion && !item.isNew) {
          await itemsAPI.delete(item.id);
        }
      }

      // データを再取得
      const preppedItems = await itemsAPI.getAll({ item_kind: "prepped" });
      // 全アイテムを再取得（ingredient選択用）
      const allItems = await itemsAPI.getAll();
      setAvailableItems(allItems);
      const itemsWithRecipes: PreppedItem[] = await Promise.all(
        preppedItems.map(async (item) => {
          const recipeLines = await recipeLinesAPI.getByItemId(item.id);
          let costPerGram: number | undefined;
          try {
            const costData = await costAPI.getCost(item.id);
            costPerGram = costData.cost_per_gram;
          } catch (error) {
            console.error(
              `Failed to calculate cost for item ${item.id}:`,
              error
            );
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
              labor_role: line.labor_role || undefined,
              minutes: line.minutes || undefined,
            })),
            notes: item.notes || "",
            isExpanded: false,
            cost_per_gram: costPerGram,
          };
        })
      );

      setItems(itemsWithRecipes);
      setOriginalItems(JSON.parse(JSON.stringify(itemsWithRecipes)));
      setIsEditMode(false);
    } catch (error: any) {
      console.error("Failed to save:", error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setLoading(false);
    }
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
    value: string | number
  ) => {
    setItems(
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              recipe_lines: item.recipe_lines.map((line) => {
                if (line.id === lineId) {
                  const updatedLine = { ...line, [field]: value };

                  // child_item_idが変更された場合、unitをリセット
                  if (field === "child_item_id") {
                    const availableUnits = getAvailableUnitsForItem(
                      value as string
                    );
                    // 利用可能な単位の最初のものをデフォルトとして設定
                    updatedLine.unit =
                      availableUnits.length > 0 ? availableUnits[0] : "g";
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

  // availableItemsをSearchableSelect用の形式に変換
  const availableItemsForSelect = availableItems.map((item) => ({
    id: item.id,
    name: item.name,
  }));

  // laborRolesをSearchableSelect用の形式に変換
  const laborRolesForSelect = laborRoles.map((role) => ({
    id: role.name,
    name: role.name,
  }));

  // 検索・フィルター処理
  const filteredItems = items.filter((item) => {
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

    // フィルター（Yield範囲）
    if (yieldMin !== "" && item.proceed_yield_amount < yieldMin) {
      return false;
    }
    if (yieldMax !== "" && item.proceed_yield_amount > yieldMax) {
      return false;
    }

    // フィルター（Cost/g範囲）
    if (item.cost_per_gram !== undefined) {
      if (costMin !== "" && item.cost_per_gram < costMin) {
        return false;
      }
      if (costMax !== "" && item.cost_per_gram > costMax) {
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

        {/* 検索・フィルターセクション */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
            {/* 検索 */}
            <div className="flex-1 w-full md:w-auto">
              <label className="block text-xs text-gray-600 mb-1">Name:</label>
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
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                    title="Clear search"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* フィルター */}
            <div className="flex-1 w-full md:w-auto">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Typeフィルター */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Type:
                  </label>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="prepped">Prepped</option>
                    <option value="menu">Menu Item</option>
                  </select>
                </div>

                {/* Proceed範囲フィルター */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Proceed (g):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={yieldMin}
                      onChange={(e) =>
                        setYieldMin(
                          e.target.value === ""
                            ? ""
                            : parseFloat(e.target.value)
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Min"
                      min="0"
                      step="0.01"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="number"
                      value={yieldMax}
                      onChange={(e) =>
                        setYieldMax(
                          e.target.value === ""
                            ? ""
                            : parseFloat(e.target.value)
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Max"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                {/* Cost/g範囲フィルター */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Cost/g ($):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={costMin}
                      onChange={(e) =>
                        setCostMin(
                          e.target.value === ""
                            ? ""
                            : parseFloat(e.target.value)
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Min"
                      min="0"
                      step="0.0001"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="number"
                      value={costMax}
                      onChange={(e) =>
                        setCostMax(
                          e.target.value === ""
                            ? ""
                            : parseFloat(e.target.value)
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Max"
                      min="0"
                      step="0.0001"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
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
                  Proceed
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
              {filteredItems.map((item) => (
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

                    {/* Proceed */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditMode ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={
                              item.proceed_yield_amount === 0
                                ? ""
                                : String(item.proceed_yield_amount)
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              // 空文字列の場合は0、それ以外は数値に変換
                              const numValue =
                                value === "" ? 0 : parseFloat(value) || 0;
                              handleItemChange(
                                item.id,
                                "proceed_yield_amount",
                                numValue
                              );
                            }}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                            min="0"
                            step="0.01"
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
                            className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {yieldUnitOptions.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">
                          {item.proceed_yield_amount} {item.proceed_yield_unit}
                        </div>
                      )}
                    </td>

                    {/* Cost/g */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {item.cost_per_gram !== undefined
                          ? `$${item.cost_per_gram.toFixed(6)}/g`
                          : "-"}
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
                                            options={availableItemsForSelect}
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
                                            value={
                                              line.quantity === 0 ||
                                              !line.quantity
                                                ? ""
                                                : String(line.quantity)
                                            }
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              // 空文字列の場合は0、それ以外は数値に変換
                                              const numValue =
                                                value === ""
                                                  ? 0
                                                  : parseFloat(value) || 0;
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "quantity",
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
                                            disabled={!line.child_item_id}
                                          >
                                            {(() => {
                                              const availableUnits =
                                                getAvailableUnitsForItem(
                                                  line.child_item_id || ""
                                                );
                                              // Itemが選択されていない場合は空のオプションを表示
                                              if (availableUnits.length === 0) {
                                                return (
                                                  <option value="">
                                                    Select item first
                                                  </option>
                                                );
                                              }
                                              return availableUnits.map(
                                                (unit) => {
                                                  // eachの場合、選択されたアイテムのeach_gramsを確認
                                                  let isEachDisabled = false;
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
                                                      disabled={isEachDisabled}
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
                                                value={role.name}
                                              >
                                                {role.name}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <div className="text-sm text-gray-900">
                                            {laborRoles.find(
                                              (r) => r.name === line.labor_role
                                            )?.name || "-"}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        {isEditMode ? (
                                          <input
                                            type="number"
                                            value={
                                              line.minutes === 0
                                                ? ""
                                                : line.minutes || ""
                                            }
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              // 空文字列の場合は0、それ以外は数値に変換
                                              const numValue =
                                                value === ""
                                                  ? 0
                                                  : parseFloat(value) || 0;
                                              handleRecipeLineChange(
                                                item.id,
                                                line.id,
                                                "minutes",
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
