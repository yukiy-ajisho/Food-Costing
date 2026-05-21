import type { BaseItem, Item, ProductMapping, Vendor, VendorProduct } from "@/lib/api";
import {
  MASS_UNIT_CONVERSIONS,
  VOLUME_UNIT_TO_LITERS,
  isNonMassUnit,
} from "@/lib/constants";

export type VendorProductWithBase = VendorProduct & { base_item_id: string };

export function enrichVendorProductsWithBase(
  vendorProducts: VendorProduct[],
  mappings: ProductMapping[],
): VendorProductWithBase[] {
  const baseByVp = new Map(
    mappings.map((m) => [m.virtual_product_id, m.base_item_id]),
  );
  return vendorProducts.map((vp) => ({
    ...vp,
    base_item_id: baseByVp.get(vp.id) ?? "",
  }));
}

export function getAvailableVendorProducts(
  childItemId: string,
  items: Item[],
  vendorProducts: VendorProductWithBase[],
  vendors: Vendor[],
  currentSpecificChild?: string | null,
): VendorProductWithBase[] {
  if (!childItemId) return [];

  const childItem = items.find((i) => i.id === childItemId);
  if (
    !childItem ||
    childItem.item_kind !== "raw" ||
    !childItem.base_item_id
  ) {
    return [];
  }

  const matching = vendorProducts.filter((vp) => {
    if (vp.base_item_id !== childItem.base_item_id) return false;
    if (!vp.deprecated) return true;
    if (
      currentSpecificChild &&
      currentSpecificChild !== "lowest" &&
      currentSpecificChild !== null &&
      vp.id === currentSpecificChild
    ) {
      return true;
    }
    return false;
  });

  return matching.sort((a, b) => {
    const vendorA = vendors.find((v) => v.id === a.vendor_id);
    const vendorB = vendors.find((v) => v.id === b.vendor_id);
    const vendorNameA = vendorA?.name || "";
    const vendorNameB = vendorB?.name || "";
    if (vendorNameA !== vendorNameB) {
      return vendorNameA.localeCompare(vendorNameB);
    }
    const productNameA = a.product_name || a.brand_name || "";
    const productNameB = b.product_name || b.brand_name || "";
    return productNameA.localeCompare(productNameB);
  });
}

export function vendorLabelForProduct(vp: VendorProduct | undefined): string {
  if (!vp) return "Selected";
  return (vp.product_name ?? "").trim() || (vp.brand_name ?? "").trim() || "Selected";
}

export function normalizeVendorSpecificChild(
  specific: string | null | undefined,
): string {
  if (!specific || specific === "lowest") return "lowest";
  return specific;
}

/** PU as $/g for a raw item at the given vendor choice (latest VVP prices). */
export function puPerGramForRawVendorChoice(
  item: Pick<Item, "id" | "item_kind" | "is_menu_item" | "base_item_id" | "each_grams">,
  specificChild: string | null | undefined,
  pickerItems: Item[],
  vendorProducts: VendorProductWithBase[],
  vendors: Vendor[],
  baseItems: BaseItem[],
): number | null {
  if (item.item_kind !== "raw" || item.is_menu_item) return null;

  const normalized = normalizeVendorSpecificChild(specificChild);
  const available = getAvailableVendorProducts(
    item.id,
    pickerItems,
    vendorProducts,
    vendors,
    normalized === "lowest" ? "lowest" : normalized,
  );
  const priced = available.filter((vp) => !vp.deprecated);
  if (priced.length === 0) return null;

  if (normalized === "lowest") {
    let lowestPu: number | null = null;
    for (const vp of priced) {
      const costPerKg = calculateVendorProductCostPerKg(vp, item, baseItems);
      if (costPerKg == null) continue;
      const pu = costPerKg / 1000;
      if (lowestPu == null || pu < lowestPu) lowestPu = pu;
    }
    return lowestPu;
  }

  const vp =
    available.find((v) => v.id === normalized) ??
    priced.find((v) => v.id === normalized);
  if (!vp) return null;
  const costPerKg = calculateVendorProductCostPerKg(vp, item, baseItems);
  return costPerKg == null ? null : costPerKg / 1000;
}

/** Same $/kg logic as costing page vendor Specific dropdown. */
export function calculateVendorProductCostPerKg(
  vendorProduct: VendorProduct,
  childItem: Pick<Item, "base_item_id" | "each_grams">,
  baseItems: BaseItem[],
): number | null {
  try {
    if (
      !vendorProduct.purchase_unit ||
      !vendorProduct.purchase_quantity ||
      !vendorProduct.current_price
    ) {
      return null;
    }

    const multiplier = MASS_UNIT_CONVERSIONS[vendorProduct.purchase_unit];
    if (multiplier) {
      const grams = vendorProduct.purchase_quantity * multiplier;
      const costPerGram = vendorProduct.current_price / grams;
      return costPerGram * 1000;
    }

    if (!childItem.base_item_id) return null;

    const baseItem = baseItems.find((b) => b.id === childItem.base_item_id);
    if (!baseItem) return null;

    let grams: number;

    if (vendorProduct.purchase_unit === "each") {
      if (!childItem.each_grams) return null;
      grams = vendorProduct.purchase_quantity * childItem.each_grams;
    } else if (isNonMassUnit(vendorProduct.purchase_unit)) {
      if (!baseItem.specific_weight) return null;
      const litersPerUnit =
        VOLUME_UNIT_TO_LITERS[vendorProduct.purchase_unit];
      if (!litersPerUnit) return null;
      const gramsPerSourceUnit =
        baseItem.specific_weight * 1000 * litersPerUnit;
      grams = vendorProduct.purchase_quantity * gramsPerSourceUnit;
    } else {
      return null;
    }

    const costPerGram = vendorProduct.current_price / grams;
    return costPerGram * 1000;
  } catch {
    return null;
  }
}

/** Option text for Specific vendor_product select (costing page format). */
export function vendorProductSelectOptionLabel(
  vp: VendorProduct,
  vendors: Vendor[],
  childItem: Pick<Item, "base_item_id" | "each_grams"> | undefined,
  baseItems: BaseItem[],
): string {
  const vendor = vendors.find((v) => v.id === vp.vendor_id);
  const vendorName = vendor?.name || "";
  const productName = vp.product_name || vp.brand_name || "";
  const costPerKg = childItem
    ? calculateVendorProductCostPerKg(vp, childItem, baseItems)
    : null;
  const costDisplay =
    costPerKg !== null ? `    $${costPerKg.toFixed(2)}/kg` : "";
  const deprecatedPrefix = vp.deprecated ? "[Deprecated] " : "";
  return `${deprecatedPrefix}${vendorName} - ${productName}${costDisplay}`;
}
