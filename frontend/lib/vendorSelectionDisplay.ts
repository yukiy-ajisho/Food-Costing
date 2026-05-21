import type { Item } from "@/lib/api";
import {
  vendorLabelForProduct,
  type VendorProductWithBase,
} from "@/lib/vendorProductPicker";

/** Display label for Vendor Selection column (read-only). */
export function vendorSelectionDisplay(
  item: Item | undefined,
  specificChild: string | null | undefined,
  storedLabel?: string | null,
): string {
  if (!item) return storedLabel?.trim() || "—";
  if (item.item_kind === "prepped" || item.is_menu_item) return "-";
  const norm =
    !specificChild || specificChild === "lowest" ? "lowest" : specificChild;
  if (norm === "lowest") return "Lowest";
  if (storedLabel?.trim() && storedLabel !== "Lowest" && storedLabel !== "-") {
    return storedLabel.trim();
  }
  return "Selected";
}

export function vendorSelectionLabelFromEdit(
  item: Item | undefined,
  specificChild: string | null,
  vendorProducts: VendorProductWithBase[],
): string {
  if (!item) return "—";
  if (item.item_kind === "prepped" || item.is_menu_item) return "-";
  if (!specificChild || specificChild === "lowest") return "Lowest";
  const vp = vendorProducts.find((v) => v.id === specificChild);
  return vp ? vendorLabelForProduct(vp) : "Selected";
}
