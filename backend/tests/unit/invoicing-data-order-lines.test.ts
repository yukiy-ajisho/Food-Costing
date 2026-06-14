import {
  validateOrderLinesSubsetOfListLines,
  type InvoiceListLineJson,
  type OrderLineJson,
} from "../../src/services/invoicing-data";

const listLines: InvoiceListLineJson[] = [
  { item_id: "item-a", unit_size: 100, unit_size_unit: "g", sort_order: 0 },
  { item_id: "item-b", unit_size: 200, unit_size_unit: "g", sort_order: 1 },
];

const orderLineA: OrderLineJson = {
  item_id: "item-a",
  name: "Tomato",
  unit_size: 100,
  unit_size_unit: "g",
  units: 2,
  cost: 10,
  sub_total: 20,
  sort_order: 0,
};

describe("validateOrderLinesSubsetOfListLines", () => {
  it("allows billing a subset of list items", () => {
    expect(
      validateOrderLinesSubsetOfListLines(listLines, [orderLineA]),
    ).toBeNull();
  });

  it("rejects empty order lines", () => {
    expect(validateOrderLinesSubsetOfListLines(listLines, [])).toBe(
      "Order must include at least one line",
    );
  });

  it("rejects order lines not on the list", () => {
    expect(
      validateOrderLinesSubsetOfListLines(listLines, [
        { ...orderLineA, item_id: "item-z", name: "Zucchini" },
      ]),
    ).toBe('Order line "Zucchini" is not on the list');
  });
});
