import {
  computeInvoicingSubTotal,
  eachGramsForInvoicing,
  getInvoicingUnitOptions,
  unitSizeAmountToKg,
} from "./invoicingCalc";

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
