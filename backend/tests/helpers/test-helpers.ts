import {
  BaseItem,
  Item,
  VendorProduct,
  LaborRole,
  RecipeLine,
} from "../../src/types/database";

/**
 * テスト用のマップを構築するヘルパー関数
 * テストデータから直接Mapを構築する
 */
export function buildTestMaps(data: {
  baseItems?: Array<{
    id: string;
    name: string;
    specificWeight?: number | null;
  }>;
  items?: Array<{
    id: string;
    name: string;
    itemKind: "raw" | "prepped";
    baseItemId?: string | null;
    proceedYieldAmount?: number | null;
    proceedYieldUnit?: string | null;
    eachGrams?: number | null;
    notes?: string | null;
  }>;
  vendorProducts?: Array<{
    id: string;
    baseItemId: string;
    vendorId: string;
    productName?: string | null;
    brandName?: string | null;
    purchaseUnit: string;
    purchaseQuantity: number;
    purchaseCost: number;
  }>;
  laborRoles?: Array<{
    id: string;
    name: string;
    hourlyWage: number;
  }>;
  recipeLines?: Array<{
    parentItemId: string;
    lineType: "ingredient" | "labor";
    childItemId?: string | null;
    quantity?: number | null;
    unit?: string | null;
    laborRoleId?: string | null;
    minutes?: number | null;
  }>;
}): {
  baseItemsMap: Map<string, BaseItem>;
  itemsMap: Map<string, Item>;
  vendorProductsMap: Map<string, VendorProduct>;
  laborRolesMap: Map<string, LaborRole>;
  recipeLinesMap: Map<string, RecipeLine[]>;
} {
  const baseItemsMap = new Map<string, BaseItem>();
  const itemsMap = new Map<string, Item>();
  const vendorProductsMap = new Map<string, VendorProduct>();
  const laborRolesMap = new Map<string, LaborRole>();
  const recipeLinesMap = new Map<string, RecipeLine[]>();

  // Base Items
  if (data.baseItems) {
    data.baseItems.forEach((bi) => {
      baseItemsMap.set(bi.id, {
        id: bi.id,
        name: bi.name,
        specific_weight: bi.specificWeight ?? null,
        user_id: "test-user-id",
      });
    });
  }

  // Items
  if (data.items) {
    data.items.forEach((item) => {
      itemsMap.set(item.id, {
        id: item.id,
        name: item.name,
        item_kind: item.itemKind,
        is_menu_item: false,
        base_item_id: item.baseItemId ?? null,
        proceed_yield_amount: item.proceedYieldAmount ?? null,
        proceed_yield_unit: item.proceedYieldUnit ?? null,
        each_grams: item.eachGrams ?? null,
        notes: item.notes ?? null,
        user_id: "test-user-id",
      });
    });
  }

  // Vendor Products (Phase 1b: base_item_id removed, use product_mappings instead)
  if (data.vendorProducts) {
    data.vendorProducts.forEach((vp) => {
      vendorProductsMap.set(vp.id, {
        id: vp.id,
        // base_item_id removed in Phase 1b
        vendor_id: vp.vendorId,
        product_name: vp.productName ?? null,
        brand_name: vp.brandName ?? null,
        purchase_unit: vp.purchaseUnit,
        purchase_quantity: vp.purchaseQuantity,
        purchase_cost: vp.purchaseCost,
        user_id: "test-user-id",
        tenant_id: "test-tenant-id",
      });
    });
  }

  // Labor Roles
  if (data.laborRoles) {
    data.laborRoles.forEach((lr) => {
      laborRolesMap.set(lr.id, {
        id: lr.id,
        name: lr.name,
        hourly_wage: lr.hourlyWage,
        user_id: "test-user-id",
      });
    });
  }

  // Recipe Lines
  if (data.recipeLines) {
    data.recipeLines.forEach((rl, index) => {
      const recipeLine: RecipeLine = {
        id: `recipe-line-${rl.parentItemId}-${index}`,
        parent_item_id: rl.parentItemId,
        line_type: rl.lineType,
        child_item_id: rl.childItemId ?? null,
        quantity: rl.quantity ?? null,
        unit: rl.unit ?? null,
        labor_role: rl.laborRoleId ?? null,
        minutes: rl.minutes ?? null,
        user_id: "test-user-id",
      };

      if (!recipeLinesMap.has(rl.parentItemId)) {
        recipeLinesMap.set(rl.parentItemId, []);
      }
      recipeLinesMap.get(rl.parentItemId)!.push(recipeLine);
    });
  }

  return {
    baseItemsMap,
    itemsMap,
    vendorProductsMap,
    laborRolesMap,
    recipeLinesMap,
  };
}
