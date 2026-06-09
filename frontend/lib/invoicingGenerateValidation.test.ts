import type { InvoicingCostBreakdown } from "./invoicingCalc";
import { validateInvoiceGenerateInput } from "./invoicingGenerateValidation";

const cost: InvoicingCostBreakdown = {
  food_cost_per_gram: 0.008,
  labor_cost_per_gram: 0.002,
  total_cost_per_gram: 0.01,
};

function rowInput(
  overrides: Partial<{
    unitSize: string;
    unitSizeUnit: string;
    units: string;
  }> = {},
) {
  return {
    unitSize: "100",
    unitSizeUnit: "g",
    units: "",
    ...overrides,
  };
}

describe("validateInvoiceGenerateInput", () => {
  it("flags empty dates", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "",
      deliveryDate: "2026-05-25",
      invoiceDate: "",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput()]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.invalidFields.has("invoiceDate")).toBe(true);
    expect(result.invalidFields.has("orderReceivedDate")).toBe(true);
  });

  it("allows empty units", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      invoiceDate: "2026-05-25T10:30",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput({ units: "" })]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(true);
    expect([...result.invalidFields].some((f) => f.startsWith("units:"))).toBe(
      false,
    );
  });

  it("flags negative units only", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      invoiceDate: "2026-05-25T10:30",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput({ units: "-1" })]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.invalidFields.has("units:item-1")).toBe(true);
  });

  it("tracks missing cost without invalid field border", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      invoiceDate: "2026-05-25T10:30",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput()]]),
      costs: {},
    });
    expect(result.ok).toBe(false);
    expect(result.missingCostItemIds).toEqual(["item-1"]);
    expect(result.invalidFields.size).toBe(0);
  });

  it("blocks generate when unpriced items are present", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      invoiceDate: "2026-05-25T10:30",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput()],
        ["item-2", rowInput()],
      ]),
      costs: { "item-1": cost },
      unpricedItemIds: ["item-2"],
    });
    expect(result.ok).toBe(false);
    expect(result.unpricedItemIds).toEqual(["item-2"]);
  });
});
