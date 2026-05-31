import {
  ingredientMatchesCurrentVersion,
  ingredientMatchesRecipeDatabase,
  resolveIngredientApplyAvailabilityForDisplay,
  resolveIngredientApplyAvailabilityForSave,
  resolveIngredientApplyMode,
  type UpdateRowMeta,
} from "./technicalSheetUpdateDisplay";

const meta: UpdateRowMeta = {
  row_key: "raw:item-1:lowest",
  child_item_id: "item-1",
  diffType: "changed",
  sheetGrams: 10,
  liveGrams: 15,
  sheetQuantity: 10,
  sheetUnit: "g",
  liveQuantity: 15,
  liveUnit: "g",
  sheetVendorLabel: "Vendor A",
  liveVendorLabel: "Vendor A",
  sheetSpecificChild: "lowest",
  liveSpecificChild: "lowest",
};

describe("ingredient apply availability", () => {
  it("marks row inactive when New recipe matches both versions", () => {
    const row = { specific_child: "lowest", total: 10 };
    expect(ingredientMatchesCurrentVersion(meta, row, null)).toBe(true);
    expect(
      resolveIngredientApplyAvailabilityForDisplay(meta, row, null).inactive,
    ).toBe(false);
    expect(
      resolveIngredientApplyAvailabilityForDisplay(meta, { ...row, total: 15 }, null)
        .inactive,
    ).toBe(false);
    expect(
      resolveIngredientApplyAvailabilityForDisplay(
        { ...meta, sheetGrams: 10, liveGrams: 10 },
        { specific_child: "lowest", total: 10 },
        null,
      ).inactive,
    ).toBe(true);
  });

  it("shows override only when New recipe matches Recipe database", () => {
    const row = { specific_child: "lowest", total: 15 };
    expect(ingredientMatchesRecipeDatabase(meta, row, null)).toBe(true);
    const availability = resolveIngredientApplyAvailabilityForDisplay(
      meta,
      row,
      null,
    );
    expect(availability).toMatchObject({
      inactive: false,
      showOverride: true,
      showOverwrite: false,
      defaultMode: "override",
    });
    expect(
      resolveIngredientApplyMode("raw:item-1:lowest", availability, new Map()),
    ).toBe("override");
  });

  it("shows both options when New recipe matches Current only (display)", () => {
    const row = { specific_child: "lowest", total: 10 };
    expect(ingredientMatchesCurrentVersion(meta, row, null)).toBe(true);
    expect(ingredientMatchesRecipeDatabase(meta, row, null)).toBe(false);
    const availability = resolveIngredientApplyAvailabilityForDisplay(
      meta,
      row,
      null,
    );
    expect(availability).toMatchObject({
      inactive: false,
      showOverride: true,
      showOverwrite: true,
      defaultMode: "overwrite",
    });
  });

  it("forces overwrite only on Save this version when New recipe matches Current only", () => {
    const row = { specific_child: "lowest", total: 10 };
    const saveAvailability = resolveIngredientApplyAvailabilityForSave(
      meta,
      row,
      null,
      "this_version",
    );
    expect(saveAvailability).toMatchObject({
      showOverride: false,
      showOverwrite: true,
      defaultMode: "overwrite",
    });
    expect(
      resolveIngredientApplyMode(
        "raw:item-1:lowest",
        saveAvailability,
        new Map([["raw:item-1:lowest", "override"]]),
      ),
    ).toBe("overwrite");
  });

  it("keeps both options on Save as new version when New recipe matches Current only", () => {
    const row = { specific_child: "lowest", total: 10 };
    const saveAvailability = resolveIngredientApplyAvailabilityForSave(
      meta,
      row,
      null,
      "new_version",
    );
    expect(saveAvailability).toMatchObject({
      showOverride: true,
      showOverwrite: true,
    });
    expect(
      resolveIngredientApplyMode(
        "raw:item-1:lowest",
        saveAvailability,
        new Map([["raw:item-1:lowest", "override"]]),
      ),
    ).toBe("override");
  });
});
