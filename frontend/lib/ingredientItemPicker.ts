import {
  getItemDisplayName,
  type BaseItem,
  type Item,
  type VendorProduct,
} from "@/lib/api";

export type IngredientPickerType = "raw" | "prepped" | "cross-tenant";

export type CrossTenantPickerEntry = {
  item: {
    id: string;
    name: string | null;
    tenant_id: string;
    proceed_yield_unit?: string | null;
    each_grams?: number | null;
    item_kind?: string | null;
    is_menu_item?: boolean | null;
    base_item_id?: string | null;
    deprecated?: string | null;
  };
  ownerTenantName: string;
};

export type IngredientSelectOption = {
  id: string;
  name: string;
  subLabel?: string;
  disabled?: boolean;
  deprecated?: boolean;
};

export function crossTenantEntryToItem(entry: CrossTenantPickerEntry): Item {
  return {
    id: entry.item.id,
    name: entry.item.name,
    item_kind: "prepped",
    is_menu_item: !!entry.item.is_menu_item,
    base_item_id: entry.item.base_item_id ?? null,
    each_grams: entry.item.each_grams ?? null,
    proceed_yield_unit: entry.item.proceed_yield_unit ?? null,
    user_id: "",
  } as Item;
}

export function deriveIngredientPickerType(
  childItemId: string | undefined,
  availableItems: Item[],
  crossTenantAvailableItems: CrossTenantPickerEntry[],
): IngredientPickerType {
  if (!childItemId) return "raw";
  if (crossTenantAvailableItems.some(({ item }) => item.id === childItemId)) {
    return "cross-tenant";
  }
  const found = availableItems.find((i) => i.id === childItemId);
  return found?.item_kind === "prepped" ? "prepped" : "raw";
}

export function buildIngredientItemSelectOptions(params: {
  availableItems: Item[];
  baseItems: BaseItem[];
  vendorProducts: Array<VendorProduct & { base_item_id?: string }>;
  crossTenantAvailableItems: CrossTenantPickerEntry[];
  typeFilter?: IngredientPickerType;
  ownerTenantFilter?: string;
  currentChildItemId?: string;
}): IngredientSelectOption[] {
  const {
    availableItems,
    baseItems,
    vendorProducts,
    crossTenantAvailableItems,
    typeFilter,
    ownerTenantFilter,
    currentChildItemId,
  } = params;

  if (typeFilter === "cross-tenant") {
    const filtered =
      ownerTenantFilter && ownerTenantFilter !== "all"
        ? crossTenantAvailableItems.filter(
            ({ item }) => item.tenant_id === ownerTenantFilter,
          )
        : crossTenantAvailableItems;
    return filtered.map(({ item, ownerTenantName }) => ({
      id: item.id,
      name: item.name ?? "",
      subLabel: ownerTenantName,
      deprecated: !!item.deprecated,
      disabled: !!(item.deprecated && item.id !== currentChildItemId),
    }));
  }

  return availableItems
    .filter((item) => {
      if (typeFilter && item.item_kind !== typeFilter) return false;

      if (item.item_kind === "raw" && item.base_item_id) {
        const hasActiveVendorProduct = vendorProducts.some(
          (vp) => vp.base_item_id === item.base_item_id && !vp.deprecated,
        );
        if (!hasActiveVendorProduct) {
          return item.id === currentChildItemId;
        }
      }

      if (item.deprecated) {
        if (item.deprecation_reason === "direct") {
          return item.id === currentChildItemId;
        }
        if (item.deprecation_reason === "indirect") {
          return true;
        }
      }

      return true;
    })
    .map((item) => ({
      id: item.id,
      name: getItemDisplayName(item, baseItems),
      disabled: !!(
        item.deprecated &&
        item.deprecation_reason === "direct" &&
        item.id === currentChildItemId
      ),
      deprecated: !!item.deprecated,
    }));
}

export function crossTenantOwnerTenants(
  crossTenantAvailableItems: CrossTenantPickerEntry[],
): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const { item, ownerTenantName } of crossTenantAvailableItems) {
    if (!seen.has(item.tenant_id)) {
      seen.set(item.tenant_id, ownerTenantName);
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
