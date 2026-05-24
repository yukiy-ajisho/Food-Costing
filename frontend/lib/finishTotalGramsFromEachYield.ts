/** Cost ページ: each 仕上がり → g 換算用（個数 × g/each） */

type EachYieldItem = {
  proceed_yield_amount: number;
  each_grams?: number | null;
  recipe_lines: Array<{
    line_type: string;
    quantity?: number;
    unit?: string;
    child_item_id?: string | null;
  }>;
};

export function finishTotalGramsFromEachYield<TRecipeLine>(
  item: EachYieldItem & { recipe_lines: TRecipeLine[] },
  yieldAmountDraft: string | undefined,
  eachGramsDraft: string | undefined,
  calculateTotalIngredientsGrams: (lines: TRecipeLine[]) => number,
): number {
  const count =
    yieldAmountDraft !== undefined
      ? yieldAmountDraft === "" || yieldAmountDraft === "."
        ? 0
        : parseFloat(yieldAmountDraft) || 0
      : item.proceed_yield_amount || 0;

  let gramsPerEach: number | null = null;
  if (eachGramsDraft !== undefined) {
    if (eachGramsDraft !== "" && eachGramsDraft !== ".") {
      const parsed = parseFloat(eachGramsDraft);
      if (parsed > 0 && Number.isFinite(parsed)) {
        gramsPerEach = parsed;
      }
    }
  } else if (
    item.each_grams != null &&
    item.each_grams > 0 &&
    Number.isFinite(item.each_grams)
  ) {
    gramsPerEach = item.each_grams;
  }

  if (gramsPerEach == null || gramsPerEach <= 0) {
    const totalIngredientsGrams = calculateTotalIngredientsGrams(
      item.recipe_lines,
    );
    const yieldAmount = count > 0 ? count : item.proceed_yield_amount || 1;
    if (Number.isFinite(yieldAmount) && yieldAmount > 0) {
      gramsPerEach = totalIngredientsGrams / yieldAmount;
    } else {
      gramsPerEach = 0;
    }
  }

  const total = count * gramsPerEach;
  return Number.isFinite(total) ? total : 0;
}
