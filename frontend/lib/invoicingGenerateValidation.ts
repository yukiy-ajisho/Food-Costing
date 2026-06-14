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
  /** List has rows but none with units > 0 (empty or zero only). */
  hasNoBillableLines: boolean;
};

/** Empty input → null; otherwise parsed number (may be NaN). */
export function parseInvoiceUnitsInput(unitsRaw: string): number | null {
  const trimmed = unitsRaw.trim();
  if (trimmed === "") return null;
  return parseFloat(trimmed);
}

export function isBillableInvoiceUnits(units: number | null): boolean {
  return units != null && Number.isFinite(units) && units > 0;
}

export function isInvalidInvoiceUnitsInput(
  unitsRaw: string,
  units: number | null,
): boolean {
  if (unitsRaw.trim() === "") return false;
  return units == null || !Number.isFinite(units) || units < 0;
}

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
  const billableUnpricedItemIds: string[] = [];

  if (params.loading || params.costsLoading) {
    return {
      ok: false,
      invalidFields,
      missingCostItemIds,
      unpricedItemIds,
      hasNoItems: false,
      hasNoBillableLines: false,
    };
  }

  if (!params.orderCreatedDate.trim()) {
    invalidFields.add("orderCreatedDate");
  }
  if (!params.deliveryDate.trim()) {
    invalidFields.add("deliveryDate");
  }

  const hasNoItems = params.visibleItemIds.length === 0;
  let billableLineCount = 0;

  for (const itemId of params.visibleItemIds) {
    const input =
      params.rowInputs.get(itemId) ??
      params.emptyRowInput?.(itemId) ?? {
        unitSize: "",
        unitSizeUnit: "g",
        units: "",
      };
    const unitsRaw = input.units;
    const units = parseInvoiceUnitsInput(unitsRaw);

    if (isInvalidInvoiceUnitsInput(unitsRaw, units)) {
      invalidFields.add(`units:${itemId}`);
    }

    if (!isBillableInvoiceUnits(units)) {
      continue;
    }

    billableLineCount += 1;

    const unitSize = parseFloat(input.unitSize);
    const unitSizeUnit = input.unitSizeUnit.trim();

    if (!Number.isFinite(unitSize) || unitSize <= 0) {
      invalidFields.add(`unitSize:${itemId}`);
    }
    if (!unitSizeUnit) {
      invalidFields.add(`unitSizeUnit:${itemId}`);
    }
    if (costPerKgFromBreakdown(params.costs[itemId]) == null) {
      missingCostItemIds.push(itemId);
    }
    if (unpricedItemIds.includes(itemId)) {
      billableUnpricedItemIds.push(itemId);
    }
  }

  const hasNoBillableLines = !hasNoItems && billableLineCount === 0;

  const ok =
    invalidFields.size === 0 &&
    !hasNoItems &&
    !hasNoBillableLines &&
    missingCostItemIds.length === 0 &&
    billableUnpricedItemIds.length === 0;

  return {
    ok,
    invalidFields,
    missingCostItemIds,
    unpricedItemIds: billableUnpricedItemIds,
    hasNoItems,
    hasNoBillableLines,
  };
}
