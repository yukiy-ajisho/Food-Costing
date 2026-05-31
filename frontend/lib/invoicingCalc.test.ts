import {
  computeInvoicingSubTotal,
  eachGramsForInvoicing,
  formatInvoicingCostDisplay,
  getInvoicingUnitOptions,
  unitSizeAmountToKg,
  type InvoicingCostBreakdown,
} from "./invoicingCalc";

const breakdown: InvoicingCostBreakdown = {
  food_cost_per_gram: 0.005,
  labor_cost_per_gram: 0.005,
  total_cost_per_gram: 0.01,
};

describe("invoicingCalc", () => {
  it("prepped: each only when each_grams > 0", () => {
    const prepped = {
      is_menu_item: false,
      each_grams: null as number | null,
      proceed_yield_amount: 350,
      proceed_yield_unit: "g",
    };
    expect(getInvoicingUnitOptions(prepped)).not.toContain("each");
    expect(
      getInvoicingUnitOptions({ ...prepped, each_grams: 100 }),
    ).toContain("each");
  });

  it("menu: each from finish yield (g/kg) when each_grams unset", () => {
    const menu = {
      is_menu_item: true,
      each_grams: null as number | null,
      proceed_yield_amount: 350,
      proceed_yield_unit: "g",
    };
    expect(eachGramsForInvoicing(menu)).toBe(350);
    expect(getInvoicingUnitOptions(menu)).toContain("each");
  });

  it("menu: each_grams takes precedence over finish yield", () => {
    const menu = {
      is_menu_item: true,
      each_grams: 180,
      proceed_yield_amount: 350,
      proceed_yield_unit: "g",
    };
    expect(eachGramsForInvoicing(menu)).toBe(180);
  });

  it("converts kg unit size to kg mass", () => {
    expect(unitSizeAmountToKg(5, "kg", null)).toBe(5);
    expect(computeInvoicingSubTotal(5, "kg", 3, 10, null)).toBe(150);
  });

  it("converts each unit size using each_grams", () => {
    expect(unitSizeAmountToKg(12, "each", 100)).toBe(1.2);
    expect(computeInvoicingSubTotal(12, "each", 2, 10, 100)).toBe(24);
  });

  it("menu each subtotal uses finish yield grams", () => {
    expect(computeInvoicingSubTotal(1, "each", 2, 10, 350)).toBe(7);
  });
});

describe("formatInvoicingCostDisplay", () => {
  it("menu + finish yield + eachMode → $/each", () => {
    const menu = {
      is_menu_item: true,
      each_grams: null as number | null,
      proceed_yield_amount: 350,
      proceed_yield_unit: "g",
    };
    expect(formatInvoicingCostDisplay(breakdown, menu, true)).toBe("$3.50/each");
    expect(formatInvoicingCostDisplay(breakdown, menu, false)).toBe("$10.00/kg");
  });

  it("prepped + each_grams + eachMode → $/each", () => {
    const prepped = {
      is_menu_item: false,
      each_grams: 100,
      proceed_yield_amount: 0,
      proceed_yield_unit: "g",
    };
    expect(formatInvoicingCostDisplay(breakdown, prepped, true)).toBe(
      "$1.00/each",
    );
  });

  it("prepped without each_grams + eachMode → $/kg", () => {
    const prepped = {
      is_menu_item: false,
      each_grams: null as number | null,
      proceed_yield_amount: 350,
      proceed_yield_unit: "g",
    };
    expect(formatInvoicingCostDisplay(breakdown, prepped, true)).toBe(
      "$10.00/kg",
    );
  });
});
