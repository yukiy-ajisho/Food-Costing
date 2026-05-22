import { finishTotalGramsFromEachYield } from "./finishTotalGramsFromEachYield";

const noIngredients = () => 0;
const total900 = () => 900;

describe("finishTotalGramsFromEachYield", () => {
  it("個数 × 明示 g/each", () => {
    expect(
      finishTotalGramsFromEachYield(
        {
          proceed_yield_amount: 3,
          each_grams: 150,
          recipe_lines: [],
        },
        undefined,
        undefined,
        noIngredients,
      ),
    ).toBe(450);
  });

  it("入力ドラフトを優先", () => {
    expect(
      finishTotalGramsFromEachYield(
        {
          proceed_yield_amount: 1,
          each_grams: 100,
          recipe_lines: [],
        },
        "4",
        "200",
        noIngredients,
      ),
    ).toBe(800);
  });

  it("g/each 未入力時は材料総グラム ÷ 個数で Auto", () => {
    expect(
      finishTotalGramsFromEachYield(
        {
          proceed_yield_amount: 3,
          each_grams: null,
          recipe_lines: [],
        },
        undefined,
        undefined,
        total900,
      ),
    ).toBe(900);
  });

  it("個数 0 のとき総グラムは 0", () => {
    expect(
      finishTotalGramsFromEachYield(
        {
          proceed_yield_amount: 5,
          each_grams: 150,
          recipe_lines: [],
        },
        "0",
        undefined,
        noIngredients,
      ),
    ).toBe(0);
  });
});
