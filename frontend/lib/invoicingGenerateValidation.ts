import {
  costPerKgFromBreakdown,
  type InvoicingCostBreakdown,
} from "./invoicingCalc";

export type InvoiceGenerateRowInput = {
  unitSize: string;
  unitSizeUnit: string;
  units: string;
};

export type InvoiceGenerateValidationField =
  | "orderCreatedDate"
  | "deliveryDate"
  | "orderReceivedDate"
  | `unitSize:${string}`
  | `unitSizeUnit:${string}`
  | `units:${string}`;

export type InvoiceGenerateValidationResult = {
  ok: boolean;
  invalidFields: Set<InvoiceGenerateValidationField>;
  missingCostItemIds: string[];
  unpricedItemIds: string[];
  hasNoItems: boolean;
};

export function validateInvoiceGenerateInput(params: {
  loading: boolean;
  costsLoading: boolean;
  orderReceivedDate: string;
  deliveryDate: string;
  orderCreatedDate: string;
  visibleItemIds: string[];
  rowInputs: Map<string, InvoiceGenerateRowInput>;
  costs: Record<string, InvoicingCostBreakdown>;
  unpricedItemIds?: string[];
  emptyRowInput?: (itemId: string) => InvoiceGenerateRowInput;
}): InvoiceGenerateValidationResult {
  const invalidFields = new Set<InvoiceGenerateValidationField>();
  const missingCostItemIds: string[] = [];
  const unpricedItemIds = params.unpricedItemIds ?? [];

  if (params.loading || params.costsLoading) {
    return {
      ok: false,
      invalidFields,
      missingCostItemIds,
      unpricedItemIds,
      hasNoItems: false,
    };
  }

  if (!params.orderCreatedDate.trim()) {
    invalidFields.add("orderCreatedDate");
  }
  if (!params.deliveryDate.trim()) {
    invalidFields.add("deliveryDate");
  }

  const hasNoItems = params.visibleItemIds.length === 0;

  for (const itemId of params.visibleItemIds) {
    const input =
      params.rowInputs.get(itemId) ??
      params.emptyRowInput?.(itemId) ?? {
        unitSize: "",
        unitSizeUnit: "g",
        units: "",
      };
    const unitSize = parseFloat(input.unitSize);
    const unitsRaw = input.units.trim();
    const units = unitsRaw === "" ? null : parseFloat(unitsRaw);
    const unitSizeUnit = input.unitSizeUnit.trim();

    if (!Number.isFinite(unitSize) || unitSize <= 0) {
      invalidFields.add(`unitSize:${itemId}`);
    }
    if (!unitSizeUnit) {
      invalidFields.add(`unitSizeUnit:${itemId}`);
    }
    if (units != null && (!Number.isFinite(units) || units < 0)) {
      invalidFields.add(`units:${itemId}`);
    }
    if (costPerKgFromBreakdown(params.costs[itemId]) == null) {
      missingCostItemIds.push(itemId);
    }
  }

  const ok =
    invalidFields.size === 0 &&
    !hasNoItems &&
    missingCostItemIds.length === 0 &&
    unpricedItemIds.length === 0;

  return {
    ok,
    invalidFields,
    missingCostItemIds,
    unpricedItemIds,
    hasNoItems,
  };
}
