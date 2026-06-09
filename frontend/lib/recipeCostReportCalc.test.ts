import type { CostBreakdown, ListMemberRow } from "./recipeCostReport";
import {
  convertListPriceInputOnEachToggle,
  convertPriceDraftMapOnEachToggle,
  eachGramsForListPricing,
  formatCostDisplay,
  formatListPriceDisplay,
  listPriceInputDisplay,
  listPriceInputToStoredPerKg,
  listUsesEachDisplay,
  lcogPercentValue,
  parseLcogPercentInput,
  pricePerKgForLcog,
  resolveListPriceStoredPerKg,
  storedPerKgFromLcogPercent,
} from "./recipeCostReportCalc";

function row(overrides: Partial<ListMemberRow>): ListMemberRow {
  return {
    item_id: "test-id",
    name: "Test Item",
    item_kind: "prepped",
    is_menu_item: false,
    proceed_yield_amount: 0,
    proceed_yield_unit: "g",
    each_grams: null,
    latest_wholesale_price: null,
    latest_retail_price: null,
    ...overrides,
  };
}

const breakdown: CostBreakdown = {
  food_cost_per_gram: 0.008,
  labor_cost_per_gram: 0.002,
  total_cost_per_gram: 0.01,
};

describe("eachGramsForListPricing", () => {
  it("prepped + unit each + each_grams → each_grams (Pricing on or off)", () => {
    const r = row({
      is_menu_item: false,
      proceed_yield_unit: "each",
      proceed_yield_amount: 2,
      each_grams: 200,
    });
    expect(eachGramsForListPricing(r, true)).toBe(200);
    expect(eachGramsForListPricing(r, false)).toBe(200);
  });

  it("menu + g yield on Pricing tab → proceed grams", () => {
    const r = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(eachGramsForListPricing(r, true)).toBe(350);
  });

  it("menu + kg yield on Pricing tab → proceed in grams", () => {
    const r = row({
      is_menu_item: true,
      proceed_yield_unit: "kg",
      proceed_yield_amount: 0.5,
    });
    expect(eachGramsForListPricing(r, true)).toBe(500);
  });

  it("menu + g on Wholesale tab → no each grams", () => {
    const r = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(eachGramsForListPricing(r, false)).toBeNull();
  });

  it("prepped + g on Pricing tab → no each grams", () => {
    const r = row({
      is_menu_item: false,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(eachGramsForListPricing(r, true)).toBeNull();
  });

  it("menu + unit each + each_grams on Pricing tab → each_grams", () => {
    const r = row({
      is_menu_item: true,
      proceed_yield_unit: "each",
      proceed_yield_amount: 1,
      each_grams: 180,
    });
    expect(eachGramsForListPricing(r, true)).toBe(180);
  });

  it("menu + zero yield → null", () => {
    const r = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 0,
    });
    expect(eachGramsForListPricing(r, true)).toBeNull();
  });
});

describe("listUsesEachDisplay", () => {
  it("menu g/kg on Pricing with eachMode", () => {
    const menuG = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(listUsesEachDisplay(menuG, true, true)).toBe(true);
    expect(listUsesEachDisplay(menuG, false, true)).toBe(false);
  });
});

describe("price round-trip ($/kg stored)", () => {
  const menu350g = row({
    is_menu_item: true,
    proceed_yield_unit: "g",
    proceed_yield_amount: 350,
  });
  const storedPerKg = 14;

  it("menu Pricing: display $/each then save back to $/kg", () => {
    const displayed = listPriceInputDisplay(
      storedPerKg,
      menu350g,
      true,
      true,
    );
    expect(parseFloat(displayed)).toBeCloseTo(4.9, 5);
    const back = listPriceInputToStoredPerKg(displayed, menu350g, true, true);
    expect(back).toBeCloseTo(storedPerKg, 5);
  });

  it("menu Wholesale: stays $/kg even with eachMode", () => {
    expect(listPriceInputDisplay(storedPerKg, menu350g, true, false)).toBe(
      "14",
    );
    expect(
      listPriceInputToStoredPerKg("14", menu350g, true, false),
    ).toBe(14);
  });

  it("prepped each row works on any tab", () => {
    const preppedEach = row({
      is_menu_item: false,
      proceed_yield_unit: "each",
      proceed_yield_amount: 1,
      each_grams: 250,
    });
    const displayed = listPriceInputDisplay(
      storedPerKg,
      preppedEach,
      true,
      false,
    );
    expect(parseFloat(displayed)).toBeCloseTo(3.5, 5);
    const back = listPriceInputToStoredPerKg(
      displayed,
      preppedEach,
      true,
      false,
    );
    expect(back).toBeCloseTo(storedPerKg, 5);
  });
});

describe("formatCostDisplay", () => {
  it("menu + g on Pricing + eachMode → $/each cost", () => {
    const menuG = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(
      formatCostDisplay(menuG, breakdown, {
        costUnit: "kg",
        eachMode: true,
        menuPricingEach: true,
      }),
    ).toBe("$3.50/each");
  });

  it("menu + g on Pricing without eachMode → $/kg", () => {
    const menuG = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(
      formatCostDisplay(menuG, breakdown, {
        costUnit: "kg",
        eachMode: false,
        menuPricingEach: true,
      }),
    ).toBe("$10.00/kg");
  });

  it("prepped + g on Pricing + eachMode → still $/kg", () => {
    const preppedG = row({
      is_menu_item: false,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(
      formatCostDisplay(preppedG, breakdown, {
        costUnit: "kg",
        eachMode: true,
        menuPricingEach: true,
      }),
    ).toBe("$10.00/kg");
  });
});

describe("LCOG invariance under each toggle", () => {
  it("menu Pricing: LCOG unchanged whether input shown as $/each or $/kg", () => {
    const menuG = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    const storedPerKg = 14;
    const perKgFromEach = listPriceInputToStoredPerKg(
      listPriceInputDisplay(storedPerKg, menuG, true, true),
      menuG,
      true,
      true,
    );
    expect(perKgFromEach).toBeCloseTo(storedPerKg, 8);
    const lcogStored = lcogPercentValue(breakdown, storedPerKg);
    const lcogFromEach = lcogPercentValue(breakdown, perKgFromEach);
    expect(lcogFromEach).toBeCloseTo(lcogStored!, 8);
  });
});

describe("convertListPriceInputOnEachToggle", () => {
  const menu350g = row({
    is_menu_item: true,
    proceed_yield_unit: "g",
    proceed_yield_amount: 350,
  });
  const preppedEach = row({
    proceed_yield_unit: "each",
    proceed_yield_amount: 1,
    each_grams: 250,
  });

  it("menu Pricing: kg draft → each draft", () => {
    expect(
      convertListPriceInputOnEachToggle("14", menu350g, false, true, true),
    ).toBe("4.9");
  });

  it("menu Pricing: each draft → kg draft", () => {
    expect(
      convertListPriceInputOnEachToggle("4.9", menu350g, true, false, true),
    ).toBe("14");
  });

  it("prepped each: converts on Wholesale tab too", () => {
    expect(
      convertListPriceInputOnEachToggle("10", preppedEach, false, true, false),
    ).toBe("2.5");
  });

  it("menu g/kg on Wholesale: draft unchanged", () => {
    expect(
      convertListPriceInputOnEachToggle("14", menu350g, false, true, false),
    ).toBe("14");
  });

  it("empty draft unchanged", () => {
    expect(
      convertListPriceInputOnEachToggle("", menu350g, false, true, true),
    ).toBe("");
  });
});

describe("convertPriceDraftMapOnEachToggle", () => {
  it("converts only rows with each grams", () => {
    const menuG = row({
      item_id: "menu-1",
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    const preppedG = row({
      item_id: "prep-1",
      is_menu_item: false,
      proceed_yield_unit: "g",
      proceed_yield_amount: 500,
    });
    const memberById = new Map([
      ["menu-1", menuG],
      ["prep-1", preppedG],
    ]);
    const drafts = new Map([
      ["menu-1", "14"],
      ["prep-1", "20"],
    ]);
    const next = convertPriceDraftMapOnEachToggle(
      drafts,
      memberById,
      false,
      true,
      true,
    );
    expect(next.get("menu-1")).toBe("4.9");
    expect(next.get("prep-1")).toBe("20");
  });
});

describe("formatListPriceDisplay", () => {
  it("menu retail on Pricing tab", () => {
    const menuG = row({
      is_menu_item: true,
      proceed_yield_unit: "g",
      proceed_yield_amount: 350,
    });
    expect(formatListPriceDisplay(14, menuG, true, true)).toBe("$4.90/each");
    expect(formatListPriceDisplay(14, menuG, false, true)).toBe("$14.00/kg");
  });
});

describe("LCOG% ↔ price inverse", () => {
  it("storedPerKgFromLcogPercent round-trips lcogPercentValue", () => {
    const stored = 14;
    const lcog = lcogPercentValue(breakdown, stored)!;
    const back = storedPerKgFromLcogPercent(lcog, breakdown)!;
    expect(back).toBeCloseTo(stored, 8);
    expect(lcogPercentValue(breakdown, back)).toBeCloseTo(lcog, 8);
  });

  it("parseLcogPercentInput accepts optional %", () => {
    expect(parseLcogPercentInput("40%")).toBe(40);
    expect(parseLcogPercentInput(" 35.5 ")).toBe(35.5);
  });

  it("pricePerKgForLcog uses ledger when lcog draft is empty", () => {
    const r = row({ latest_wholesale_price: 14 });
    expect(
      pricePerKgForLcog(
        r,
        "wholesale",
        resolveListPriceStoredPerKg({
          mode: "lcog",
          priceRaw: "",
          lcogRaw: "",
          row: r,
          breakdown,
          eachMode: false,
        }),
      ),
    ).toBe(14);
    expect(lcogPercentValue(breakdown, pricePerKgForLcog(r, "wholesale"))).toBeCloseTo(
      (0.01 / (14 / 1000)) * 100,
      8,
    );
  });

  it("pricePerKgForLcog prefers edit draft over ledger", () => {
    const r = row({ latest_wholesale_price: 14 });
    expect(pricePerKgForLcog(r, "wholesale", 20)).toBe(20);
  });

  it("view after lcog-mode save: empty lcog draft must not hide LCOG%", () => {
    const r = row({
      latest_wholesale_price: 25,
      price_input_mode: "lcog",
    });
    const priceDisplay = listPriceInputDisplay(25, r, false, false);
    const editResolved = resolveListPriceStoredPerKg({
      mode: "lcog",
      priceRaw: priceDisplay,
      lcogRaw: "",
      row: r,
      breakdown,
      eachMode: false,
    });
    expect(editResolved).toBeNull();

    const viewPrice = pricePerKgForLcog(r, "wholesale", undefined);
    expect(viewPrice).toBe(25);

    const editPrice = pricePerKgForLcog(r, "wholesale", editResolved);
    expect(editPrice).toBe(25);

    const lcog = lcogPercentValue(breakdown, viewPrice);
    expect(lcog).not.toBeNull();
    expect(lcog!).toBeCloseTo((0.01 / (25 / 1000)) * 100, 8);
  });

  it("edit lcog draft still drives LCOG while typing", () => {
    const r = row({ latest_wholesale_price: 14 });
    const fromDraft = resolveListPriceStoredPerKg({
      mode: "lcog",
      priceRaw: "",
      lcogRaw: "50",
      row: r,
      breakdown,
      eachMode: false,
    });
    expect(fromDraft).not.toBeNull();
    expect(pricePerKgForLcog(r, "wholesale", fromDraft)).toBe(fromDraft);
    expect(pricePerKgForLcog(r, "wholesale", fromDraft)).not.toBe(14);
  });

  it("resolveListPriceStoredPerKg uses lcog in lcog mode", () => {
    const r = row({ proceed_yield_unit: "g", proceed_yield_amount: 1000 });
    const fromLcog = resolveListPriceStoredPerKg({
      mode: "lcog",
      priceRaw: "",
      lcogRaw: "40",
      row: r,
      breakdown,
      eachMode: false,
    });
    const fromPrice = resolveListPriceStoredPerKg({
      mode: "price",
      priceRaw: String(fromLcog!),
      lcogRaw: "",
      row: r,
      breakdown,
      eachMode: false,
    });
    expect(fromPrice).toBeCloseTo(fromLcog!, 8);
  });
});
