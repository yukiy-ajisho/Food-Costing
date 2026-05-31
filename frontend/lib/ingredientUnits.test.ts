import type { BaseItem, Item } from "@/lib/api";
import {
  ensureUnitInList,
  getAvailableUnitsForItem,
} from "@/lib/ingredientUnits";

const eggItem: Item = {
  id: "egg-item",
  name: "Egg",
  item_kind: "raw",
  base_item_id: "egg-base",
  each_grams: 50,
  is_menu_item: false,
  user_id: "user-1",
};

const eggBase: BaseItem = {
  id: "egg-base",
  name: "Egg",
  specific_weight: null,
  user_id: "user-1",
};

describe("getAvailableUnitsForItem", () => {
  it("includes each for raw item when vendor product uses each", () => {
    expect(
      getAvailableUnitsForItem(eggItem, [eggBase], [
        { base_item_id: "egg-base", purchase_unit: "each" },
      ]),
    ).toEqual(["g", "kg", "oz", "lb", "each"]);
  });

  it("includes each for prepped item with proceed_yield_unit each", () => {
    const prepped: Item = {
      ...eggItem,
      item_kind: "prepped",
      proceed_yield_unit: "each",
    };
    expect(getAvailableUnitsForItem(prepped, [eggBase])).toEqual([
      "g",
      "kg",
      "oz",
      "lb",
      "each",
    ]);
  });

  it("includes each from each_grams even when vendor products use mass units", () => {
    expect(
      getAvailableUnitsForItem(eggItem, [eggBase], [
        { base_item_id: "egg-base", purchase_unit: "kg" },
      ]),
    ).toEqual(["g", "kg", "oz", "lb", "each"]);
  });

  it("uses specific_weight for volume units when no vendor products", () => {
    const liquidBase: BaseItem = {
      ...eggBase,
      id: "oil-base",
      specific_weight: 0.92,
    };
    const oilItem: Item = {
      ...eggItem,
      base_item_id: "oil-base",
      each_grams: null,
    };
    expect(getAvailableUnitsForItem(oilItem, [liquidBase])).toEqual([
      "g",
      "kg",
      "oz",
      "lb",
      "floz",
      "ml",
      "liter",
      "gallon",
    ]);
  });
});

describe("ensureUnitInList", () => {
  it("appends missing unit", () => {
    expect(ensureUnitInList(["g", "kg"], "each")).toEqual(["g", "kg", "each"]);
  });

  it("leaves list unchanged when unit exists", () => {
    expect(ensureUnitInList(["g", "each"], "each")).toEqual(["g", "each"]);
  });
});
