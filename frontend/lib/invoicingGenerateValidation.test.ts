import type { InvoicingCostBreakdown } from "./invoicingCalc";
import {
  isBillableInvoiceUnits,
  parseInvoiceUnitsInput,
  validateInvoiceGenerateInput,
} from "./invoicingGenerateValidation";

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
    units: "1",
    ...overrides,
  };
}

describe("invoicingGenerateValidation helpers", () => {
  it("treats empty units as non-billable", () => {
    expect(parseInvoiceUnitsInput("")).toBeNull();
    expect(isBillableInvoiceUnits(null)).toBe(false);
  });

  it("treats zero units as non-billable", () => {
    expect(isBillableInvoiceUnits(0)).toBe(false);
  });

  it("treats positive units as billable", () => {
    expect(isBillableInvoiceUnits(3)).toBe(true);
  });
});

describe("validateInvoiceGenerateInput", () => {
  it("flags empty dates", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput()]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.invalidFields.has("orderCreatedDate")).toBe(true);
    expect(result.invalidFields.has("orderReceivedDate")).toBe(false);
  });

  it("allows empty order received date", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput()]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(true);
  });

  it("allows empty units when another row is billable", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput({ units: "" })],
        ["item-2", rowInput({ units: "2" })],
      ]),
      costs: { "item-1": cost, "item-2": cost },
    });
    expect(result.ok).toBe(true);
    expect(result.hasNoBillableLines).toBe(false);
    expect([...result.invalidFields].some((f) => f.startsWith("units:"))).toBe(
      false,
    );
  });

  it("blocks generate when every row has empty or zero units", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput({ units: "" })],
        ["item-2", rowInput({ units: "0" })],
      ]),
      costs: { "item-1": cost, "item-2": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.hasNoBillableLines).toBe(true);
  });

  it("does not require unit size on non-billable rows", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput({ unitSize: "", units: "" })],
        ["item-2", rowInput({ units: "2" })],
      ]),
      costs: { "item-1": cost, "item-2": cost },
    });
    expect(result.ok).toBe(true);
    expect(result.invalidFields.has("unitSize:item-1")).toBe(false);
  });

  it("flags negative units only", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1"],
      rowInputs: new Map([["item-1", rowInput({ units: "-1" })]]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.invalidFields.has("units:item-1")).toBe(true);
  });

  it("tracks missing cost only for billable rows", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput({ units: "" })],
        ["item-2", rowInput({ units: "2" })],
      ]),
      costs: { "item-1": cost },
    });
    expect(result.ok).toBe(false);
    expect(result.missingCostItemIds).toEqual(["item-2"]);
    expect(result.invalidFields.size).toBe(0);
  });

  it("flags unpriced billable items only", () => {
    const result = validateInvoiceGenerateInput({
      loading: false,
      costsLoading: false,
      orderReceivedDate: "2026-05-24",
      deliveryDate: "2026-05-25",
      orderCreatedDate: "2026-05-25",
      visibleItemIds: ["item-1", "item-2"],
      rowInputs: new Map([
        ["item-1", rowInput({ units: "" })],
        ["item-2", rowInput({ units: "2" })],
      ]),
      costs: { "item-1": cost, "item-2": cost },
      unpricedItemIds: ["item-1", "item-2"],
    });
    expect(result.ok).toBe(false);
    expect(result.unpricedItemIds).toEqual(["item-2"]);
  });
});
