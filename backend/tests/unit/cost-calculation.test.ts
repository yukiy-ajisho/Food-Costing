import { getCost } from "../../src/services/cost";
import { buildTestMaps } from "../helpers/test-helpers";
import { RecipeLine, Item } from "../../src/types/database";

// Supabaseをモック化
let mockRecipeLinesMap: Map<string, RecipeLine[]> = new Map();
let mockItemsMap: Map<string, Item> = new Map();

jest.mock("../../src/config/supabase", () => {
  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === "recipe_lines") {
          return {
            select: jest.fn(() => {
              let parentItemId: string | null = null;
              const mockChain = {
                eq: jest.fn((column: string, value: string) => {
                  if (column === "parent_item_id") {
                    parentItemId = value;
                  }
                  // user_idフィルタは無視してチェーンを続ける
                  // 最後の.eq()呼び出し後にデータを返す
                  return {
                    eq: jest.fn((column2: string, value2: string) => {
                      // user_idフィルタは無視
                      return Promise.resolve({
                        data: parentItemId ? mockRecipeLinesMap.get(parentItemId) || null : null,
                        error: null,
                      });
                    }),
                  };
                }),
              };
              return mockChain;
            }),
          };
        }
        if (table === "items") {
          return {
            select: jest.fn(() => {
              let itemId: string | null = null;
              const mockChain = {
                eq: jest.fn((column: string, value: string) => {
                  if (column === "id") {
                    itemId = value;
                  }
                  // tenant_idフィルタは無視してチェーンを続ける
                  return {
                    in: jest.fn((column2: string, value2: string[]) => {
                      // tenant_idフィルタは無視
                      return {
                        single: jest.fn(() => {
                          return Promise.resolve({
                            data: itemId ? mockItemsMap.get(itemId) || null : null,
                            error: null,
                          });
                        }),
                      };
                    }),
                    eq: jest.fn((column2: string, value2: string) => {
                      // 後方互換性のため残す
                      return {
                        single: jest.fn(() => {
                          return Promise.resolve({
                            data: itemId ? mockItemsMap.get(itemId) || null : null,
                            error: null,
                          });
                        }),
                      };
                    }),
                  };
                }),
              };
              return mockChain;
            }),
            update: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => {
                  return Promise.resolve({
                    error: null,
                  });
                }),
              })),
            })),
          };
        }
        if (table === "product_mappings") {
          return {
            select: jest.fn(() => {
              return {
                eq: jest.fn(() => {
                  return {
                    in: jest.fn(() => {
                      return Promise.resolve({
                        data: [],
                        error: null,
                      });
                    }),
                  };
                }),
              };
            }),
          };
        }
        if (table === "base_items") {
          return {
            select: jest.fn(() => {
              return {
                in: jest.fn(() => {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                }),
              };
            }),
          };
        }
        if (table === "virtual_vendor_products") {
          return {
            select: jest.fn(() => {
              return {
                in: jest.fn(() => {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                }),
              };
            }),
          };
        }
        if (table === "labor_roles") {
          return {
            select: jest.fn(() => {
              return {
                in: jest.fn(() => {
                  return Promise.resolve({
                    data: [],
                    error: null,
                  });
                }),
              };
            }),
          };
        }
        return {};
      }),
    },
  };
});

describe("Cost Calculation Unit Tests", () => {
  beforeEach(() => {
    // 各テストの前にモックをクリア
    mockRecipeLinesMap.clear();
    mockItemsMap.clear();
  });

  describe("Test Case 1: Simple Raw Item (Mass Unit)", () => {
    it("should calculate cost for raw item with mass unit", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          {
            id: "base-item-1",
            name: "Salt",
            specificWeight: null,
          },
        ],
        items: [
          {
            id: "item-1",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-1",
          },
        ],
        vendorProducts: [
          {
            id: "vp-1",
            baseItemId: "base-item-1",
            vendorId: "vendor-1",
            productName: "Sea Salt",
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
        ],
      };

      const { baseItemsMap, itemsMap, vendorProductsMap, laborRolesMap } =
        buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-1",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値: 200.00 / (20 * 1000) = 0.01 $/g
      expect(costPerGram).toBeCloseTo(0.01, 4);
    });
  });

  describe("Test Case 2: Simple Raw Item (Non-Mass Unit)", () => {
    it("should calculate cost for raw item with non-mass unit (gallon)", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          {
            id: "base-item-2",
            name: "Vegetable Oil",
            specificWeight: 0.92, // g/ml
          },
        ],
        items: [
          {
            id: "item-2",
            name: "Vegetable Oil",
            itemKind: "raw" as const,
            baseItemId: "base-item-2",
          },
        ],
        vendorProducts: [
          {
            id: "vp-2",
            baseItemId: "base-item-2",
            vendorId: "vendor-2",
            productName: "Canola Oil",
            brandName: null,
            purchaseUnit: "gallon",
            purchaseQuantity: 1,
            purchaseCost: 15.0,
          },
        ],
      };

      const { baseItemsMap, itemsMap, vendorProductsMap, laborRolesMap } =
        buildTestMaps(testData);

      // itemsMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-2",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値: 1 gallon = 3.78541 liters
      // Grams = 0.92 * 1000 * 3.78541 = 3484.5772 g
      // Cost per gram = 15.00 / 3484.5772 ≈ 0.0043 $/g
      expect(costPerGram).toBeCloseTo(0.0043, 4);
    });
  });

  describe("Test Case 3: Simple Prepped Item (Yield = 'g')", () => {
    it("should calculate cost for prepped item with yield in grams", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          {
            id: "base-item-3",
            name: "Salt",
            specificWeight: null,
          },
        ],
        items: [
          {
            id: "item-3-raw",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-3",
          },
          {
            id: "item-3-prepped",
            name: "Seasoned Salt",
            itemKind: "prepped" as const,
            proceedYieldAmount: 950,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-3",
            baseItemId: "base-item-3",
            vendorId: "vendor-3",
            productName: "Sea Salt",
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-3-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-3-raw",
            quantity: 950,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-3-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Salt cost per gram = 0.01 $/g
      // Ingredient cost = 950 * 0.01 = 9.50
      // Cost per gram = 9.50 / 950 = 0.01 $/g
      expect(costPerGram).toBeCloseTo(0.01, 4);
    });
  });

  describe("Test Case 4: Simple Prepped Item (Yield = 'each')", () => {
    it("should calculate cost for prepped item with yield in 'each'", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          {
            id: "base-item-4",
            name: "Egg",
            specificWeight: null,
          },
        ],
        items: [
          {
            id: "item-4-raw",
            name: "Egg",
            itemKind: "raw" as const,
            baseItemId: "base-item-4",
            eachGrams: 50, // "each"を使用するため必須
          },
          {
            id: "item-4-prepped",
            name: "Boiled Egg",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            // each_gramsは自動計算される（材料の総合計 = 50g）
          },
        ],
        vendorProducts: [
          {
            id: "vp-4",
            baseItemId: "base-item-4",
            vendorId: "vendor-4",
            productName: "Large Eggs",
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 12,
            purchaseCost: 3.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-4-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-4-raw",
            quantity: 1,
            unit: "each",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-4-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Egg cost per gram = 3.00 / (12 * 50) = 0.005 $/g
      // Ingredient grams = 1 * 50 = 50 g
      // Ingredient cost = 50 * 0.005 = 0.25
      // Yield = 50 g (材料の総合計)
      // Cost per gram = 0.25 / 50 = 0.005 $/g
      expect(costPerGram).toBeCloseTo(0.005, 4);
    });
  });

  describe("Test Case 5: Prepped Item with 'each' unit as ingredient", () => {
    it("should calculate cost when using prepped item with 'each' yield as ingredient", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          {
            id: "base-item-5",
            name: "Egg",
            specificWeight: null,
          },
        ],
        items: [
          {
            id: "item-5-raw",
            name: "Egg",
            itemKind: "raw" as const,
            baseItemId: "base-item-5",
            eachGrams: 50,
          },
          {
            id: "item-5-prepped-1",
            name: "Boiled Egg",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            eachGrams: 50, // 自動計算される（材料の総合計 = 50g）
          },
          {
            id: "item-5-prepped-2",
            name: "Egg Salad",
            itemKind: "prepped" as const,
            proceedYieldAmount: 200,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-5",
            baseItemId: "base-item-5",
            vendorId: "vendor-5",
            productName: "Large Eggs",
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 12,
            purchaseCost: 3.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-5-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-5-raw",
            quantity: 1,
            unit: "each",
          },
          {
            parentItemId: "item-5-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-5-prepped-1",
            quantity: 4,
            unit: "each",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // コスト計算（Egg Salad）
      const costPerGram = await getCost(
        "item-5-prepped-2",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Egg cost per gram = 3.00 / (12 * 50) = 0.005 $/g
      // Boiled Egg cost per gram = 0.005 $/g
      // Egg Salad:
      //   Boiled Egg grams = 4 * 50 = 200 g
      //   Ingredient cost = 200 * 0.005 = 1.00
      //   Cost per gram = 1.00 / 200 = 0.005 $/g
      expect(costPerGram).toBeCloseTo(0.005, 4);
    });
  });

  describe("Test Case 6: Yield Unit = 'each' with auto-calculated each_grams", () => {
    it("should calculate cost with auto-calculated each_grams", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          { id: "base-item-6-1", name: "Flour", specificWeight: null },
          { id: "base-item-6-2", name: "Salt", specificWeight: null },
          { id: "base-item-6-3", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-6-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-6-1",
          },
          {
            id: "item-6-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-6-2",
          },
          {
            id: "item-6-raw-3",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-6-3",
          },
          {
            id: "item-6-prepped",
            name: "Dough Batch",
            itemKind: "prepped" as const,
            proceedYieldAmount: 10,
            proceedYieldUnit: "each",
            // each_gramsは自動計算される（材料の総合計 / yield_amount = 5300 / 10 = 530g）
          },
        ],
        vendorProducts: [
          {
            id: "vp-6-1",
            baseItemId: "base-item-6-1",
            vendorId: "vendor-6",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-6-2",
            baseItemId: "base-item-6-2",
            vendorId: "vendor-6",
            productName: "Sea Salt",
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-6-3",
            baseItemId: "base-item-6-3",
            vendorId: "vendor-6",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 8.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-6-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-6-raw-1",
            quantity: 5000,
            unit: "g",
          },
          {
            parentItemId: "item-6-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-6-raw-2",
            quantity: 100,
            unit: "g",
          },
          {
            parentItemId: "item-6-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-6-raw-3",
            quantity: 200,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-6-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // 材料の総合計 = 5000 + 100 + 200 = 5300g
      // each_grams（自動計算）= 5300g / 10 = 530g
      // Flour cost per gram = 12.50 / 25000 = 0.0005 $/g
      // Salt cost per gram = 200.00 / 20000 = 0.01 $/g
      // Sugar cost per gram = 8.00 / 10000 = 0.0008 $/g
      // Ingredient cost = (5000 * 0.0005) + (100 * 0.01) + (200 * 0.0008) = 2.50 + 1.00 + 0.16 = 3.66
      // yieldGrams = 530g × 10 = 5300g
      // Cost per gram = 3.66 / 5300 = 0.000691 $/g
      expect(costPerGram).toBeCloseTo(0.000691, 6);
    });
  });

  describe("Test Case 7: Yield Unit = 'each' with manual each_grams input", () => {
    it("should calculate cost with manual each_grams input", async () => {
      // テストデータを手動で定義
      const testData = {
        baseItems: [
          { id: "base-item-7-1", name: "Flour", specificWeight: null },
          { id: "base-item-7-2", name: "Salt", specificWeight: null },
          { id: "base-item-7-3", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-7-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-7-1",
          },
          {
            id: "item-7-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-7-2",
          },
          {
            id: "item-7-raw-3",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-7-3",
          },
          {
            id: "item-7-prepped",
            name: "Dough Batch",
            itemKind: "prepped" as const,
            proceedYieldAmount: 10,
            proceedYieldUnit: "each",
            eachGrams: 500, // 手動入力（自動計算値530gから変更）
          },
        ],
        vendorProducts: [
          {
            id: "vp-7-1",
            baseItemId: "base-item-7-1",
            vendorId: "vendor-7",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-7-2",
            baseItemId: "base-item-7-2",
            vendorId: "vendor-7",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-7-3",
            baseItemId: "base-item-7-3",
            vendorId: "vendor-7",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 8.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-7-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-7-raw-1",
            quantity: 5000,
            unit: "g",
          },
          {
            parentItemId: "item-7-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-7-raw-2",
            quantity: 100,
            unit: "g",
          },
          {
            parentItemId: "item-7-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-7-raw-3",
            quantity: 200,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      // itemsMapとrecipeLinesMapをモックに設定
      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // コスト計算
      const costPerGram = await getCost(
        "item-7-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // 材料の総合計 = 5000 + 100 + 200 = 5300g
      // each_grams（手動入力）= 500g
      // yieldGrams = 500g × 10 = 5000g（手動入力値を使用）
      // Ingredient cost = (5000 * 0.0005) + (100 * 0.01) + (200 * 0.0008) = 2.50 + 1.00 + 0.16 = 3.66
      // Cost per gram = 3.66 / 5000 = 0.000732 $/g
      expect(costPerGram).toBeCloseTo(0.000732, 6);
    });
  });

  describe("Test Case 9: Yield Unit = 'each' with Yield Amount = 1", () => {
    it("should calculate cost when Yield Amount = 1", async () => {
      // テストケース4と同じ（Yield Amount = 1の場合）
      const testData = {
        baseItems: [
          {
            id: "base-item-9",
            name: "Egg",
            specificWeight: null,
          },
        ],
        items: [
          {
            id: "item-9-raw",
            name: "Egg",
            itemKind: "raw" as const,
            baseItemId: "base-item-9",
            eachGrams: 50,
          },
          {
            id: "item-9-prepped",
            name: "Boiled Egg",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            // each_gramsは自動計算される（材料の総合計 = 50g）
          },
        ],
        vendorProducts: [
          {
            id: "vp-9",
            baseItemId: "base-item-9",
            vendorId: "vendor-9",
            productName: null,
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 12,
            purchaseCost: 3.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-9-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-9-raw",
            quantity: 1,
            unit: "each",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-9-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // 材料の総合計 = 1 × 50g = 50g
      // each_grams（自動計算）= 50g / 1 = 50g
      // Egg cost per gram = 3.00 / (12 * 50) = 0.005 $/g
      // Ingredient cost = 50 * 0.005 = 0.25
      // yieldGrams = 50g × 1 = 50g
      // Cost per gram = 0.25 / 50 = 0.005 $/g
      expect(costPerGram).toBeCloseTo(0.005, 4);
    });
  });

  describe("Test Case 10: Yield Unit = 'each' with multiple ingredients and Labor", () => {
    it("should calculate cost with multiple ingredients and Labor", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-10-1", name: "Flour", specificWeight: null },
          { id: "base-item-10-2", name: "Salt", specificWeight: null },
        ],
        items: [
          {
            id: "item-10-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-10-1",
          },
          {
            id: "item-10-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-10-2",
          },
          {
            id: "item-10-prepped",
            name: "Donut",
            itemKind: "prepped" as const,
            proceedYieldAmount: 12,
            proceedYieldUnit: "each",
            eachGrams: 80, // 手動入力
          },
        ],
        vendorProducts: [
          {
            id: "vp-10-1",
            baseItemId: "base-item-10-1",
            vendorId: "vendor-10",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-10-2",
            baseItemId: "base-item-10-2",
            vendorId: "vendor-10",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
        ],
        laborRoles: [
          {
            id: "labor-10-1",
            name: "Baker",
            hourlyWage: 20.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-10-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-10-raw-1",
            quantity: 1000,
            unit: "g",
          },
          {
            parentItemId: "item-10-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-10-raw-2",
            quantity: 20,
            unit: "g",
          },
          {
            parentItemId: "item-10-prepped",
            lineType: "labor" as const,
            laborRoleId: "labor-10-1",
            minutes: 60,
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-10-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // 材料の総合計 = 1000 + 20 = 1020g
      // each_grams（手動入力）= 80g
      // Flour cost per gram = 12.50 / 25000 = 0.0005 $/g
      // Salt cost per gram = 200.00 / 20000 = 0.01 $/g
      // Ingredient cost = (1000 * 0.0005) + (20 * 0.01) = 0.50 + 0.20 = 0.70
      // Labor cost = (60 / 60) * 20.00 = 20.00
      // Total batch cost = 0.70 + 20.00 = 20.70
      // yieldGrams = 80g × 12 = 960g
      // Cost per gram = 20.70 / 960 = 0.0215625 $/g
      expect(costPerGram).toBeCloseTo(0.0215625, 6);
    });
  });

  describe("Test Case 11: Multiple ingredients with Labor", () => {
    it("should calculate cost for prepped item with multiple ingredients and Labor", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-11-1", name: "Flour", specificWeight: null },
          { id: "base-item-11-2", name: "Salt", specificWeight: null },
          { id: "base-item-11-3", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-11-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-11-1",
          },
          {
            id: "item-11-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-11-2",
          },
          {
            id: "item-11-raw-3",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-11-3",
          },
          {
            id: "item-11-prepped",
            name: "Bread Dough",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1580,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-11-1",
            baseItemId: "base-item-11-1",
            vendorId: "vendor-11-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-11-2",
            baseItemId: "base-item-11-2",
            vendorId: "vendor-11-1",
            productName: "Sea Salt",
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-11-3",
            baseItemId: "base-item-11-3",
            vendorId: "vendor-11-2",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 8.0,
          },
        ],
        laborRoles: [
          {
            id: "labor-11-1",
            name: "Baker",
            hourlyWage: 20.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-11-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-11-raw-1",
            quantity: 1500,
            unit: "g",
          },
          {
            parentItemId: "item-11-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-11-raw-2",
            quantity: 30,
            unit: "g",
          },
          {
            parentItemId: "item-11-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-11-raw-3",
            quantity: 50,
            unit: "g",
          },
          {
            parentItemId: "item-11-prepped",
            lineType: "labor" as const,
            laborRoleId: "labor-11-1",
            minutes: 30,
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-11-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Flour cost per gram = 12.50 / (25 * 1000) = 0.0005 $/g
      // Salt cost per gram = 200.00 / (20 * 1000) = 0.01 $/g
      // Sugar cost per gram = 8.00 / (10 * 1000) = 0.0008 $/g
      // Ingredient cost = (1500 * 0.0005) + (30 * 0.01) + (50 * 0.0008) = 0.75 + 0.30 + 0.04 = 1.09
      // Labor cost = (30 / 60) * 20.00 = 10.00
      // Total batch cost = 1.09 + 10.00 = 11.09
      // Cost per gram = 11.09 / 1580 ≈ 0.00702 $/g
      expect(costPerGram).toBeCloseTo(0.00702, 5);
    });
  });

  describe("Test Case 12: Multiple vendor products - select cheapest", () => {
    it("should select the cheapest vendor product when multiple exist", async () => {
      const testData = {
        baseItems: [{ id: "base-item-12", name: "Salt", specificWeight: null }],
        items: [
          {
            id: "item-12-raw",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-12",
          },
        ],
        vendorProducts: [
          {
            id: "vp-12-1",
            baseItemId: "base-item-12",
            vendorId: "vendor-12-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0, // Cost per gram = 200.00 / 20000 = 0.01 $/g
          },
          {
            id: "vp-12-2",
            baseItemId: "base-item-12",
            vendorId: "vendor-12-2",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 220.0, // Cost per gram = 220.00 / 25000 = 0.0088 $/g (最安値)
          },
          {
            id: "vp-12-3",
            baseItemId: "base-item-12",
            vendorId: "vendor-12-3",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 15,
            purchaseCost: 180.0, // Cost per gram = 180.00 / 15000 = 0.012 $/g
          },
        ],
      };

      const { baseItemsMap, itemsMap, vendorProductsMap, laborRolesMap } =
        buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-12-raw",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値: 最安値は Supplier E (0.0088 $/g)
      expect(costPerGram).toBeCloseTo(0.0088, 4);
    });
  });

  describe("Test Case 13: Recursive dependency (Prepped → Prepped → Raw)", () => {
    it("should calculate cost for prepped item using another prepped item", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-13-1", name: "Flour", specificWeight: null },
          { id: "base-item-13-2", name: "Salt", specificWeight: null },
        ],
        items: [
          {
            id: "item-13-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-13-1",
          },
          {
            id: "item-13-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-13-2",
          },
          {
            id: "item-13-prepped-1",
            name: "Seasoned Flour",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1000,
            proceedYieldUnit: "g",
          },
          {
            id: "item-13-prepped-2",
            name: "Bread Dough",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-13-1",
            baseItemId: "base-item-13-1",
            vendorId: "vendor-13",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-13-2",
            baseItemId: "base-item-13-2",
            vendorId: "vendor-13",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-13-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-13-raw-1",
            quantity: 950,
            unit: "g",
          },
          {
            parentItemId: "item-13-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-13-raw-2",
            quantity: 50,
            unit: "g",
          },
          {
            parentItemId: "item-13-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-13-prepped-1",
            quantity: 1500,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-13-prepped-2",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Seasoned Flour cost per gram = 0.000975 $/g
      // Bread Dough:
      //   Seasoned Flour grams = 1500 g
      //   Ingredient cost = 1500 * 0.000975 = 1.4625
      //   Cost per gram = 1.4625 / 1500 = 0.000975 $/g
      expect(costPerGram).toBeCloseTo(0.000975, 6);
    });
  });

  describe("Test Case 14: Non-mass unit combinations", () => {
    it("should calculate cost with multiple non-mass units (gallon, liter, floz)", async () => {
      const testData = {
        baseItems: [
          {
            id: "base-item-14-1",
            name: "Vegetable Oil",
            specificWeight: 0.92, // g/ml
          },
          {
            id: "base-item-14-2",
            name: "Soy Sauce",
            specificWeight: 1.15, // g/ml
          },
        ],
        items: [
          {
            id: "item-14-raw-1",
            name: "Vegetable Oil",
            itemKind: "raw" as const,
            baseItemId: "base-item-14-1",
          },
          {
            id: "item-14-raw-2",
            name: "Soy Sauce",
            itemKind: "raw" as const,
            baseItemId: "base-item-14-2",
          },
          {
            id: "item-14-prepped",
            name: "Teriyaki Sauce",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1004,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-14-1",
            baseItemId: "base-item-14-1",
            vendorId: "vendor-14-1",
            productName: null,
            brandName: null,
            purchaseUnit: "gallon",
            purchaseQuantity: 1,
            purchaseCost: 15.0,
          },
          {
            id: "vp-14-2",
            baseItemId: "base-item-14-2",
            vendorId: "vendor-14-2",
            productName: null,
            brandName: null,
            purchaseUnit: "liter",
            purchaseQuantity: 2,
            purchaseCost: 8.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-14-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-14-raw-1",
            quantity: 0.5,
            unit: "liter",
          },
          {
            parentItemId: "item-14-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-14-raw-2",
            quantity: 16,
            unit: "floz",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-14-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Vegetable Oil cost per gram ≈ 0.0043 $/g
      // Soy Sauce cost per gram ≈ 0.00348 $/g
      // Teriyaki Sauce:
      //   Vegetable Oil grams = 0.5 * 1000 * 0.92 = 460 g
      //   Soy Sauce grams = 16 * 0.0295735 * 1000 * 1.15 = 544.0 g
      //   Ingredient cost = (460 * 0.0043) + (544.0 * 0.00348) ≈ 1.978 + 1.893 = 3.871
      //   Cost per gram = 3.871 / 1004 ≈ 0.00386 $/g
      expect(costPerGram).toBeCloseTo(0.00386, 5);
    });
  });

  describe("Test Case 15: Yield 'each' with child items also using 'each'", () => {
    it("should calculate cost when yield is 'each' and child items also use 'each'", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-15-1", name: "Egg", specificWeight: null },
          { id: "base-item-15-2", name: "Bread", specificWeight: null },
        ],
        items: [
          {
            id: "item-15-raw-1",
            name: "Egg",
            itemKind: "raw" as const,
            baseItemId: "base-item-15-1",
            eachGrams: 50,
          },
          {
            id: "item-15-raw-2",
            name: "Bread",
            itemKind: "raw" as const,
            baseItemId: "base-item-15-2",
            eachGrams: 500,
          },
          {
            id: "item-15-prepped",
            name: "Egg Sandwich",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            // each_gramsは自動計算される（材料の総合計 = 1100g）
          },
        ],
        vendorProducts: [
          {
            id: "vp-15-1",
            baseItemId: "base-item-15-1",
            vendorId: "vendor-15-1",
            productName: null,
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 12,
            purchaseCost: 3.0,
          },
          {
            id: "vp-15-2",
            baseItemId: "base-item-15-2",
            vendorId: "vendor-15-2",
            productName: null,
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 1,
            purchaseCost: 2.5,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-15-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-15-raw-1",
            quantity: 2,
            unit: "each",
          },
          {
            parentItemId: "item-15-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-15-raw-2",
            quantity: 2,
            unit: "each",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-15-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Egg cost per gram = 3.00 / (12 * 50) = 0.005 $/g
      // Bread cost per gram = 2.50 / (1 * 500) = 0.005 $/g
      // Egg Sandwich:
      //   Egg grams = 2 * 50 = 100 g
      //   Bread grams = 2 * 500 = 1000 g
      //   Total ingredients grams = 1100 g
      //   Ingredient cost = (100 * 0.005) + (1000 * 0.005) = 0.5 + 5.0 = 5.5
      //   Yield = 1100 g (材料の総合計)
      //   Cost per gram = 5.5 / 1100 = 0.005 $/g
      expect(costPerGram).toBeCloseTo(0.005, 4);
    });
  });

  describe("Test Case 16: Multiple prepped items with mutual dependencies", () => {
    it("should calculate cost for multiple prepped items with mutual dependencies", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-16-1", name: "Flour", specificWeight: null },
          { id: "base-item-16-2", name: "Salt", specificWeight: null },
          { id: "base-item-16-3", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-16-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-16-1",
          },
          {
            id: "item-16-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-16-2",
          },
          {
            id: "item-16-raw-3",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-16-3",
          },
          {
            id: "item-16-prepped-1",
            name: "Seasoned Flour",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1000,
            proceedYieldUnit: "g",
          },
          {
            id: "item-16-prepped-2",
            name: "Sweet Flour",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1000,
            proceedYieldUnit: "g",
          },
          {
            id: "item-16-prepped-3",
            name: "Complete Flour Mix",
            itemKind: "prepped" as const,
            proceedYieldAmount: 2000,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-16-1",
            baseItemId: "base-item-16-1",
            vendorId: "vendor-16-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-16-2",
            baseItemId: "base-item-16-2",
            vendorId: "vendor-16-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-16-3",
            baseItemId: "base-item-16-3",
            vendorId: "vendor-16-2",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 8.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-16-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-16-raw-1",
            quantity: 950,
            unit: "g",
          },
          {
            parentItemId: "item-16-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-16-raw-2",
            quantity: 50,
            unit: "g",
          },
          {
            parentItemId: "item-16-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-16-raw-1",
            quantity: 900,
            unit: "g",
          },
          {
            parentItemId: "item-16-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-16-raw-3",
            quantity: 100,
            unit: "g",
          },
          {
            parentItemId: "item-16-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-16-prepped-1",
            quantity: 1000,
            unit: "g",
          },
          {
            parentItemId: "item-16-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-16-prepped-2",
            quantity: 1000,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-16-prepped-3",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Seasoned Flour cost per gram = 0.000975 $/g
      // Sweet Flour cost per gram = 0.00053 $/g
      // Complete Flour Mix:
      //   Ingredient cost = (1000 * 0.000975) + (1000 * 0.00053) = 0.975 + 0.53 = 1.505
      //   Cost per gram = 1.505 / 2000 = 0.0007525 $/g
      expect(costPerGram).toBeCloseTo(0.0007525, 7);
    });
  });

  describe("Test Case 17: Edge case - very small quantity", () => {
    it("should calculate cost with very small quantity", async () => {
      const testData = {
        baseItems: [{ id: "base-item-17", name: "Salt", specificWeight: null }],
        items: [
          {
            id: "item-17-raw",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-17",
          },
          {
            id: "item-17-prepped",
            name: "Tiny Seasoned Salt",
            itemKind: "prepped" as const,
            proceedYieldAmount: 0.5,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-17",
            baseItemId: "base-item-17",
            vendorId: "vendor-17",
            productName: null,
            brandName: null,
            purchaseUnit: "g",
            purchaseQuantity: 1,
            purchaseCost: 0.01,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-17-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-17-raw",
            quantity: 0.5,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-17-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Salt cost per gram = 0.01 / 1 = 0.01 $/g
      // Ingredient cost = 0.5 * 0.01 = 0.005
      // Yield = 0.5 g
      // Cost per gram = 0.005 / 0.5 = 0.01 $/g
      expect(costPerGram).toBeCloseTo(0.01, 4);
    });
  });

  describe("Test Case 18: Edge case - very large quantity", () => {
    it("should calculate cost with very large quantity", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-18", name: "Flour", specificWeight: null },
        ],
        items: [
          {
            id: "item-18-raw",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-18",
          },
          {
            id: "item-18-prepped",
            name: "Large Batch Dough",
            itemKind: "prepped" as const,
            proceedYieldAmount: 50000,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-18",
            baseItemId: "base-item-18",
            vendorId: "vendor-18",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 1000,
            purchaseCost: 500.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-18-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-18-raw",
            quantity: 50000,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-18-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Flour cost per gram = 500.00 / (1000 * 1000) = 0.0005 $/g
      // Ingredient cost = 50000 * 0.0005 = 25.00
      // Yield = 50000 g
      // Cost per gram = 25.00 / 50000 = 0.0005 $/g
      expect(costPerGram).toBeCloseTo(0.0005, 4);
    });
  });

  describe("Test Case 19: Edge case - Labor only Prepped Item", () => {
    it("should calculate cost for prepped item with only Labor", async () => {
      const testData = {
        items: [
          {
            id: "item-19-prepped",
            name: "Service Only",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "g",
          },
        ],
        laborRoles: [
          {
            id: "labor-19-1",
            name: "Waiter",
            hourlyWage: 15.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-19-prepped",
            lineType: "labor" as const,
            laborRoleId: "labor-19-1",
            minutes: 10,
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-19-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Ingredient cost = 0
      // Labor cost = (10 / 60) * 15.00 = 2.50
      // Total batch cost = 2.50
      // Cost per gram = 2.50 / 1 = 2.50 $/g
      expect(costPerGram).toBeCloseTo(2.5, 4);
    });
  });

  describe("Test Case 20: Edge case - multiple Labor Roles", () => {
    it("should calculate cost with multiple Labor Roles", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-20", name: "Flour", specificWeight: null },
        ],
        items: [
          {
            id: "item-20-raw",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-20",
          },
          {
            id: "item-20-prepped",
            name: "Professional Bread",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-20",
            baseItemId: "base-item-20",
            vendorId: "vendor-20",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
        ],
        laborRoles: [
          {
            id: "labor-20-1",
            name: "Baker",
            hourlyWage: 25.0,
          },
          {
            id: "labor-20-2",
            name: "Assistant",
            hourlyWage: 15.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-20-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-20-raw",
            quantity: 1500,
            unit: "g",
          },
          {
            parentItemId: "item-20-prepped",
            lineType: "labor" as const,
            laborRoleId: "labor-20-1",
            minutes: 30,
          },
          {
            parentItemId: "item-20-prepped",
            lineType: "labor" as const,
            laborRoleId: "labor-20-2",
            minutes: 20,
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-20-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Flour cost per gram = 12.50 / 25000 = 0.0005 $/g
      // Ingredient cost = 1500 * 0.0005 = 0.75
      // Labor cost = (30 / 60) * 25.00 + (20 / 60) * 15.00 = 12.50 + 5.00 = 17.50
      // Total batch cost = 0.75 + 17.50 = 18.25
      // Cost per gram = 18.25 / 1500 = 0.012167 $/g
      expect(costPerGram).toBeCloseTo(0.012167, 6);
    });
  });

  describe("Test Case 29: ml unit test", () => {
    it("should calculate cost with ml units", async () => {
      const testData = {
        baseItems: [
          {
            id: "base-item-29-1",
            name: "Milk",
            specificWeight: 1.03, // g/ml
          },
          {
            id: "base-item-29-2",
            name: "Water",
            specificWeight: 1.0, // g/ml
          },
        ],
        items: [
          {
            id: "item-29-raw-1",
            name: "Milk",
            itemKind: "raw" as const,
            baseItemId: "base-item-29-1",
          },
          {
            id: "item-29-raw-2",
            name: "Water",
            itemKind: "raw" as const,
            baseItemId: "base-item-29-2",
          },
          {
            id: "item-29-prepped",
            name: "Diluted Milk",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-29-1",
            baseItemId: "base-item-29-1",
            vendorId: "vendor-29-1",
            productName: "Whole Milk",
            brandName: null,
            purchaseUnit: "liter",
            purchaseQuantity: 1,
            purchaseCost: 2.5,
          },
          {
            id: "vp-29-2",
            baseItemId: "base-item-29-2",
            vendorId: "vendor-29-2",
            productName: "Spring Water",
            brandName: null,
            purchaseUnit: "ml",
            purchaseQuantity: 500,
            purchaseCost: 0.5,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-29-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-29-raw-1",
            quantity: 1000,
            unit: "ml",
          },
          {
            parentItemId: "item-29-prepped",
            lineType: "ingredient" as const,
            childItemId: "item-29-raw-2",
            quantity: 500,
            unit: "ml",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-29-prepped",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Milk cost per gram ≈ 0.00243 $/g
      // Water cost per gram = 0.001 $/g
      // Diluted Milk:
      //   Milk grams = 1000 * 1.03 = 1030 g
      //   Water grams = 500 * 1.00 = 500 g
      //   Total ingredients grams = 1030 + 500 = 1530 g
      //   Ingredient cost = (1030 * 0.00243) + (500 * 0.001) ≈ 2.503 + 0.50 = 3.003
      //   Yield = 1500 g (材料の総合計1530g、水分が蒸発して1500gになる)
      //   Cost per gram = 3.003 / 1500 ≈ 0.002 $/g
      expect(costPerGram).toBeCloseTo(0.002, 4);
    });
  });

  describe("Test Case 22: Cost auto-update after ingredient change", () => {
    it("should calculate cost after ingredient change (changed state)", async () => {
      // テストケース22は材料変更後の状態をテスト
      // Seasoned Flour: Salt（50g）を削除、Sugar（50g）を追加
      const testData = {
        baseItems: [
          { id: "base-item-22-1", name: "Flour", specificWeight: null },
          { id: "base-item-22-2", name: "Salt", specificWeight: null },
          { id: "base-item-22-3", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-22-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-22-1",
          },
          {
            id: "item-22-raw-2",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-22-2",
          },
          {
            id: "item-22-raw-3",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-22-3",
          },
          {
            id: "item-22-prepped-1",
            name: "Seasoned Flour",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1000,
            proceedYieldUnit: "g",
          },
          {
            id: "item-22-prepped-2",
            name: "Bread Dough",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-22-1",
            baseItemId: "base-item-22-1",
            vendorId: "vendor-22-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 12.5,
          },
          {
            id: "vp-22-2",
            baseItemId: "base-item-22-2",
            vendorId: "vendor-22-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-22-3",
            baseItemId: "base-item-22-3",
            vendorId: "vendor-22-2",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 8.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-22-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-22-raw-1",
            quantity: 950,
            unit: "g",
          },
          {
            parentItemId: "item-22-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-22-raw-3", // Sugar（変更後）
            quantity: 50,
            unit: "g",
          },
          {
            parentItemId: "item-22-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-22-prepped-1",
            quantity: 1500,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-22-prepped-2",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値（変更後）:
      // Flour cost per gram = 0.0005 $/g（変更なし）
      // Sugar cost per gram = 0.0008 $/g（新規）
      // Seasoned Flour cost:
      //   Ingredient cost = (950 * 0.0005) + (50 * 0.0008) = 0.475 + 0.04 = 0.515
      //   Cost per gram = 0.515 / 1000 = 0.000515 $/g（変更あり）
      // Bread Dough cost:
      //   Seasoned Flour grams = 1500 g
      //   Ingredient cost = 1500 * 0.000515 = 0.7725（変更あり）
      //   Cost per gram = 0.7725 / 1500 = 0.000515 $/g（変更あり）
      expect(costPerGram).toBeCloseTo(0.000515, 6);
    });
  });

  describe("Test Case 23: Deep hierarchy with diverse units and multiple Labor", () => {
    it("should calculate cost for deep hierarchy (4 levels) with diverse units and multiple Labor", async () => {
      const testData = {
        baseItems: [
          {
            id: "base-item-23-1",
            name: "Vegetable Oil",
            specificWeight: 0.92,
          },
          {
            id: "base-item-23-2",
            name: "Soy Sauce",
            specificWeight: 1.15,
          },
          {
            id: "base-item-23-3",
            name: "Vinegar",
            specificWeight: 1.01,
          },
          { id: "base-item-23-4", name: "Meat", specificWeight: null },
          { id: "base-item-23-5", name: "Salt", specificWeight: null },
          { id: "base-item-23-6", name: "Rice", specificWeight: null },
          { id: "base-item-23-7", name: "Lettuce", specificWeight: null },
          { id: "base-item-23-8", name: "Tomato", specificWeight: null },
        ],
        items: [
          {
            id: "item-23-raw-1",
            name: "Vegetable Oil",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-1",
          },
          {
            id: "item-23-raw-2",
            name: "Soy Sauce",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-2",
          },
          {
            id: "item-23-raw-3",
            name: "Vinegar",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-3",
          },
          {
            id: "item-23-raw-4",
            name: "Meat",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-4",
          },
          {
            id: "item-23-raw-5",
            name: "Salt",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-5",
          },
          {
            id: "item-23-raw-6",
            name: "Rice",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-6",
          },
          {
            id: "item-23-raw-7",
            name: "Lettuce",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-7",
            eachGrams: 200,
          },
          {
            id: "item-23-raw-8",
            name: "Tomato",
            itemKind: "raw" as const,
            baseItemId: "base-item-23-8",
            eachGrams: 150,
          },
          {
            id: "item-23-prepped-1",
            name: "Teriyaki Sauce",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1004,
            proceedYieldUnit: "g",
          },
          {
            id: "item-23-prepped-2",
            name: "Seasoned Meat",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1050,
            proceedYieldUnit: "g",
          },
          {
            id: "item-23-prepped-3",
            name: "Salad Dressing",
            itemKind: "prepped" as const,
            proceedYieldAmount: 468.95,
            proceedYieldUnit: "g",
          },
          {
            id: "item-23-prepped-4",
            name: "Main Dish",
            itemKind: "prepped" as const,
            proceedYieldAmount: 3000,
            proceedYieldUnit: "g",
          },
          {
            id: "item-23-prepped-5",
            name: "Side Salad",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            eachGrams: 818.95, // 自動計算される（材料の総合計 = 818.95g）
          },
          {
            id: "item-23-prepped-6",
            name: "Complete Meal",
            itemKind: "prepped" as const,
            proceedYieldAmount: 1,
            proceedYieldUnit: "each",
            eachGrams: 3818.95, // 自動計算される（材料の総合計 = 3818.95g）
          },
        ],
        vendorProducts: [
          {
            id: "vp-23-1",
            baseItemId: "base-item-23-1",
            vendorId: "vendor-23-1",
            productName: null,
            brandName: null,
            purchaseUnit: "gallon",
            purchaseQuantity: 1,
            purchaseCost: 15.0,
          },
          {
            id: "vp-23-2",
            baseItemId: "base-item-23-2",
            vendorId: "vendor-23-2",
            productName: null,
            brandName: null,
            purchaseUnit: "liter",
            purchaseQuantity: 2,
            purchaseCost: 8.0,
          },
          {
            id: "vp-23-3",
            baseItemId: "base-item-23-3",
            vendorId: "vendor-23-3",
            productName: null,
            brandName: null,
            purchaseUnit: "floz",
            purchaseQuantity: 32,
            purchaseCost: 5.0,
          },
          {
            id: "vp-23-4",
            baseItemId: "base-item-23-4",
            vendorId: "vendor-23-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-23-5",
            baseItemId: "base-item-23-5",
            vendorId: "vendor-23-1",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 20,
            purchaseCost: 200.0,
          },
          {
            id: "vp-23-6",
            baseItemId: "base-item-23-6",
            vendorId: "vendor-23-4",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 25,
            purchaseCost: 30.0,
          },
          {
            id: "vp-23-7",
            baseItemId: "base-item-23-7",
            vendorId: "vendor-23-3",
            productName: null,
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 12,
            purchaseCost: 6.0,
          },
          {
            id: "vp-23-8",
            baseItemId: "base-item-23-8",
            vendorId: "vendor-23-3",
            productName: null,
            brandName: null,
            purchaseUnit: "each",
            purchaseQuantity: 20,
            purchaseCost: 10.0,
          },
        ],
        laborRoles: [
          {
            id: "labor-23-1",
            name: "Head Chef",
            hourlyWage: 35.0,
          },
          {
            id: "labor-23-2",
            name: "Sous Chef",
            hourlyWage: 25.0,
          },
          {
            id: "labor-23-3",
            name: "Prep Cook",
            hourlyWage: 18.0,
          },
          {
            id: "labor-23-4",
            name: "Server",
            hourlyWage: 15.0,
          },
        ],
        recipeLines: [
          // Level 3: Teriyaki Sauce
          {
            parentItemId: "item-23-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-1",
            quantity: 0.5,
            unit: "liter",
          },
          {
            parentItemId: "item-23-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-2",
            quantity: 16,
            unit: "floz",
          },
          {
            parentItemId: "item-23-prepped-1",
            lineType: "labor" as const,
            laborRoleId: "labor-23-3",
            minutes: 10,
          },
          // Level 3: Seasoned Meat
          {
            parentItemId: "item-23-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-4",
            quantity: 1000,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-5",
            quantity: 50,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-2",
            lineType: "labor" as const,
            laborRoleId: "labor-23-2",
            minutes: 20,
          },
          {
            parentItemId: "item-23-prepped-2",
            lineType: "labor" as const,
            laborRoleId: "labor-23-3",
            minutes: 15,
          },
          // Level 3: Salad Dressing
          {
            parentItemId: "item-23-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-1",
            quantity: 0.25,
            unit: "liter",
          },
          {
            parentItemId: "item-23-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-3",
            quantity: 8,
            unit: "floz",
          },
          {
            parentItemId: "item-23-prepped-3",
            lineType: "labor" as const,
            laborRoleId: "labor-23-3",
            minutes: 5,
          },
          // Level 2: Main Dish
          {
            parentItemId: "item-23-prepped-4",
            lineType: "ingredient" as const,
            childItemId: "item-23-prepped-1",
            quantity: 1004,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-4",
            lineType: "ingredient" as const,
            childItemId: "item-23-prepped-2",
            quantity: 1050,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-4",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-6",
            quantity: 1000,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-4",
            lineType: "labor" as const,
            laborRoleId: "labor-23-1",
            minutes: 30,
          },
          {
            parentItemId: "item-23-prepped-4",
            lineType: "labor" as const,
            laborRoleId: "labor-23-2",
            minutes: 25,
          },
          // Level 2: Side Salad
          {
            parentItemId: "item-23-prepped-5",
            lineType: "ingredient" as const,
            childItemId: "item-23-prepped-3",
            quantity: 468.95,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-5",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-7",
            quantity: 1,
            unit: "each",
          },
          {
            parentItemId: "item-23-prepped-5",
            lineType: "ingredient" as const,
            childItemId: "item-23-raw-8",
            quantity: 1,
            unit: "each",
          },
          {
            parentItemId: "item-23-prepped-5",
            lineType: "labor" as const,
            laborRoleId: "labor-23-3",
            minutes: 10,
          },
          // Level 1: Complete Meal
          {
            parentItemId: "item-23-prepped-6",
            lineType: "ingredient" as const,
            childItemId: "item-23-prepped-4",
            quantity: 3000,
            unit: "g",
          },
          {
            parentItemId: "item-23-prepped-6",
            lineType: "ingredient" as const,
            childItemId: "item-23-prepped-5",
            quantity: 1,
            unit: "each",
          },
          {
            parentItemId: "item-23-prepped-6",
            lineType: "labor" as const,
            laborRoleId: "labor-23-1",
            minutes: 15,
          },
          {
            parentItemId: "item-23-prepped-6",
            lineType: "labor" as const,
            laborRoleId: "labor-23-4",
            minutes: 5,
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      const costPerGram = await getCost(
        "item-23-prepped-6",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 期待値:
      // Complete Meal:
      //   Main Dish: 3000 g
      //   Side Salad: 1 each = 818.95 g
      //   Total ingredients grams = 3000 + 818.95 = 3818.95 g
      //   Ingredient cost ≈ 62.05
      //   Labor cost = (15 / 60) * 35.00 + (5 / 60) * 15.00 = 8.75 + 1.25 = 10.00
      //   Total batch cost = 62.05 + 10.00 = 72.05
      //   Yield = 3818.95 g (材料の総合計)
      //   Cost per gram = 72.05 / 3818.95 ≈ 0.01887 $/g
      expect(costPerGram).toBeCloseTo(0.01887, 5);
    });
  });

  describe("Test Case 21: Cycle detection", () => {
    it("should throw error when cycle is detected (A → B → A)", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-21-1", name: "Flour", specificWeight: null },
          { id: "base-item-21-2", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-21-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-21-1",
          },
          {
            id: "item-21-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-21-2",
          },
          {
            id: "item-21-prepped-1",
            name: "Item A",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
          {
            id: "item-21-prepped-2",
            name: "Item B",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-21-1",
            baseItemId: "base-item-21-1",
            vendorId: "vendor-21",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-21-2",
            baseItemId: "base-item-21-2",
            vendorId: "vendor-21",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-21-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-21-prepped-2", // Item A → Item B
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-21-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-21-prepped-1", // Item B → Item A（循環参照）
            quantity: 500,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // エラーが発生することを期待
      await expect(
        getCost(
          "item-21-prepped-1",
          ["test-user-id"],
          new Set(),
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRolesMap
        )
      ).rejects.toThrow(/Cycle detected/);
    });
  });

  describe("Test Case 24: Cycle detection - simple cycle (A → B → A)", () => {
    it("should throw error when simple cycle is detected", async () => {
      // ステップ3の状態: Item AにItem Bを追加（循環参照）
      const testData = {
        baseItems: [
          { id: "base-item-24-1", name: "Flour", specificWeight: null },
          { id: "base-item-24-2", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-24-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-24-1",
          },
          {
            id: "item-24-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-24-2",
          },
          {
            id: "item-24-prepped-1",
            name: "Item A",
            itemKind: "prepped" as const,
            proceedYieldAmount: 700,
            proceedYieldUnit: "g",
          },
          {
            id: "item-24-prepped-2",
            name: "Item B",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-24-1",
            baseItemId: "base-item-24-1",
            vendorId: "vendor-24",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-24-2",
            baseItemId: "base-item-24-2",
            vendorId: "vendor-24",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-24-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-24-raw-1",
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-24-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-24-prepped-2", // Item A → Item B（循環参照）
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-24-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-24-raw-2",
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-24-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-24-prepped-1", // Item B → Item A（循環参照）
            quantity: 300,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      await expect(
        getCost(
          "item-24-prepped-1",
          ["test-user-id"],
          new Set(),
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRolesMap
        )
      ).rejects.toThrow(/Cycle detected/);
    });
  });

  describe("Test Case 25: Cycle detection - complex cycle (A → B → C → A)", () => {
    it("should throw error when complex cycle is detected", async () => {
      // ステップ4の状態: Item AにItem Cを追加（循環参照）
      const testData = {
        baseItems: [
          { id: "base-item-25-1", name: "Flour", specificWeight: null },
          { id: "base-item-25-2", name: "Sugar", specificWeight: null },
          { id: "base-item-25-3", name: "Butter", specificWeight: null },
        ],
        items: [
          {
            id: "item-25-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-25-1",
          },
          {
            id: "item-25-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-25-2",
          },
          {
            id: "item-25-raw-3",
            name: "Butter",
            itemKind: "raw" as const,
            baseItemId: "base-item-25-3",
          },
          {
            id: "item-25-prepped-1",
            name: "Item A",
            itemKind: "prepped" as const,
            proceedYieldAmount: 700,
            proceedYieldUnit: "g",
          },
          {
            id: "item-25-prepped-2",
            name: "Item B",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
          {
            id: "item-25-prepped-3",
            name: "Item C",
            itemKind: "prepped" as const,
            proceedYieldAmount: 800,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-25-1",
            baseItemId: "base-item-25-1",
            vendorId: "vendor-25",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-25-2",
            baseItemId: "base-item-25-2",
            vendorId: "vendor-25",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
          {
            id: "vp-25-3",
            baseItemId: "base-item-25-3",
            vendorId: "vendor-25",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 2,
            purchaseCost: 40.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-25-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-25-raw-1",
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-25-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-25-prepped-3", // Item A → Item C（循環参照）
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-25-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-25-raw-2",
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-25-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-25-prepped-1", // Item B → Item A
            quantity: 300,
            unit: "g",
          },
          {
            parentItemId: "item-25-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-25-raw-3",
            quantity: 400,
            unit: "g",
          },
          {
            parentItemId: "item-25-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-25-prepped-2", // Item C → Item B
            quantity: 400,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      await expect(
        getCost(
          "item-25-prepped-1",
          ["test-user-id"],
          new Set(),
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRolesMap
        )
      ).rejects.toThrow(/Cycle detected/);
    });
  });

  describe("Test Case 26: Cycle detection - multiple items simultaneous save", () => {
    it("should throw error when cycle is detected in multiple items", async () => {
      // ステップ4の状態: Item XにItem Zを追加（循環参照）
      const testData = {
        baseItems: [
          { id: "base-item-26-1", name: "Flour", specificWeight: null },
          { id: "base-item-26-2", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-26-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-26-1",
          },
          {
            id: "item-26-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-26-2",
          },
          {
            id: "item-26-prepped-1",
            name: "Item X",
            itemKind: "prepped" as const,
            proceedYieldAmount: 700,
            proceedYieldUnit: "g",
          },
          {
            id: "item-26-prepped-2",
            name: "Item Y",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
          {
            id: "item-26-prepped-3",
            name: "Item Z",
            itemKind: "prepped" as const,
            proceedYieldAmount: 600,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-26-1",
            baseItemId: "base-item-26-1",
            vendorId: "vendor-26",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-26-2",
            baseItemId: "base-item-26-2",
            vendorId: "vendor-26",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-26-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-26-raw-1",
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-26-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-26-prepped-3", // Item X → Item Z（循環参照）
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-26-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-26-raw-2",
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-26-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-26-prepped-1", // Item Y → Item X
            quantity: 300,
            unit: "g",
          },
          {
            parentItemId: "item-26-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-26-prepped-2", // Item Z → Item Y
            quantity: 400,
            unit: "g",
          },
          {
            parentItemId: "item-26-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-26-prepped-1", // Item Z → Item X
            quantity: 200,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      await expect(
        getCost(
          "item-26-prepped-1",
          ["test-user-id"],
          new Set(),
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRolesMap
        )
      ).rejects.toThrow(/Cycle detected/);
    });
  });

  describe("Test Case 27: Cycle detection - normal case (no cycle)", () => {
    it("should calculate cost successfully when no cycle exists", async () => {
      const testData = {
        baseItems: [
          { id: "base-item-27-1", name: "Flour", specificWeight: null },
          { id: "base-item-27-2", name: "Sugar", specificWeight: null },
          { id: "base-item-27-3", name: "Butter", specificWeight: null },
        ],
        items: [
          {
            id: "item-27-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-27-1",
          },
          {
            id: "item-27-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-27-2",
          },
          {
            id: "item-27-raw-3",
            name: "Butter",
            itemKind: "raw" as const,
            baseItemId: "base-item-27-3",
          },
          {
            id: "item-27-prepped-1",
            name: "Item A",
            itemKind: "prepped" as const,
            proceedYieldAmount: 800,
            proceedYieldUnit: "g",
          },
          {
            id: "item-27-prepped-2",
            name: "Item B",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
          {
            id: "item-27-prepped-3",
            name: "Item C",
            itemKind: "prepped" as const,
            proceedYieldAmount: 800,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-27-1",
            baseItemId: "base-item-27-1",
            vendorId: "vendor-27",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-27-2",
            baseItemId: "base-item-27-2",
            vendorId: "vendor-27",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
          {
            id: "vp-27-3",
            baseItemId: "base-item-27-3",
            vendorId: "vendor-27",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 2,
            purchaseCost: 40.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-27-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-27-raw-1",
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-27-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-27-raw-2",
            quantity: 300,
            unit: "g",
          },
          {
            parentItemId: "item-27-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-27-raw-3",
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-27-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-27-prepped-1", // Item B → Item A（正常）
            quantity: 300,
            unit: "g",
          },
          {
            parentItemId: "item-27-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-27-prepped-1", // Item C → Item A（正常）
            quantity: 400,
            unit: "g",
          },
          {
            parentItemId: "item-27-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-27-prepped-2", // Item C → Item B（正常）
            quantity: 400,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      // エラーが発生しないことを期待
      const costPerGram = await getCost(
        "item-27-prepped-3",
        ["test-user-id"],
        new Set(),
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap
      );

      // 正常に計算されることを確認（具体的な値は計算結果に依存）
      expect(costPerGram).toBeGreaterThan(0);
    });
  });

  describe("Test Case 28: Cycle detection - recipe line update", () => {
    it("should throw error when cycle is detected after recipe line update", async () => {
      // ステップ4の状態: Item BにItem Cを追加（循環参照）
      const testData = {
        baseItems: [
          { id: "base-item-28-1", name: "Flour", specificWeight: null },
          { id: "base-item-28-2", name: "Sugar", specificWeight: null },
        ],
        items: [
          {
            id: "item-28-raw-1",
            name: "Flour",
            itemKind: "raw" as const,
            baseItemId: "base-item-28-1",
          },
          {
            id: "item-28-raw-2",
            name: "Sugar",
            itemKind: "raw" as const,
            baseItemId: "base-item-28-2",
          },
          {
            id: "item-28-prepped-1",
            name: "Item A",
            itemKind: "prepped" as const,
            proceedYieldAmount: 500,
            proceedYieldUnit: "g",
          },
          {
            id: "item-28-prepped-2",
            name: "Item B",
            itemKind: "prepped" as const,
            proceedYieldAmount: 600,
            proceedYieldUnit: "g",
          },
          {
            id: "item-28-prepped-3",
            name: "Item C",
            itemKind: "prepped" as const,
            proceedYieldAmount: 400,
            proceedYieldUnit: "g",
          },
        ],
        vendorProducts: [
          {
            id: "vp-28-1",
            baseItemId: "base-item-28-1",
            vendorId: "vendor-28",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 10,
            purchaseCost: 50.0,
          },
          {
            id: "vp-28-2",
            baseItemId: "base-item-28-2",
            vendorId: "vendor-28",
            productName: null,
            brandName: null,
            purchaseUnit: "kg",
            purchaseQuantity: 5,
            purchaseCost: 30.0,
          },
        ],
        recipeLines: [
          {
            parentItemId: "item-28-prepped-1",
            lineType: "ingredient" as const,
            childItemId: "item-28-raw-1",
            quantity: 500,
            unit: "g",
          },
          {
            parentItemId: "item-28-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-28-raw-2",
            quantity: 200,
            unit: "g",
          },
          {
            parentItemId: "item-28-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-28-prepped-1", // Item B → Item A
            quantity: 300,
            unit: "g",
          },
          {
            parentItemId: "item-28-prepped-2",
            lineType: "ingredient" as const,
            childItemId: "item-28-prepped-3", // Item B → Item C（循環参照）
            quantity: 100,
            unit: "g",
          },
          {
            parentItemId: "item-28-prepped-3",
            lineType: "ingredient" as const,
            childItemId: "item-28-prepped-2", // Item C → Item B（循環参照）
            quantity: 400,
            unit: "g",
          },
        ],
      };

      const {
        baseItemsMap,
        itemsMap,
        vendorProductsMap,
        laborRolesMap,
        recipeLinesMap,
      } = buildTestMaps(testData);

      itemsMap.forEach((value, key) => {
        mockItemsMap.set(key, value);
      });
      recipeLinesMap.forEach((value, key) => {
        mockRecipeLinesMap.set(key, value);
      });

      await expect(
        getCost(
          "item-28-prepped-2",
          ["test-user-id"],
          new Set(),
          baseItemsMap,
          itemsMap,
          vendorProductsMap,
          laborRolesMap
        )
      ).rejects.toThrow(/Cycle detected/);
    });
  });
});
