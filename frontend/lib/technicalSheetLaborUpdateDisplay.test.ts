import {
  laborMatchesCurrentVersion,
  laborMatchesRecipeDatabase,
  resolveLaborApplyAvailabilityForSave,
  resolveLaborApplyMode,
  type LaborUpdateRowMeta,
} from "./technicalSheetLaborUpdateDisplay";

const meta: LaborUpdateRowMeta = {
  row_key: "labor-1",
  diffType: "changed",
  sheetRole: "Prep",
  liveRole: "Prep",
  sheetMinutes: 30,
  liveMinutes: 45,
};

describe("labor apply availability", () => {
  it("shows override only when New recipe matches Recipe database", () => {
    const row = { labor_role: "Prep", minutes: 45 };
    expect(laborMatchesRecipeDatabase(meta, row)).toBe(true);
    const availability = resolveLaborApplyAvailabilityForSave(
      meta,
      row,
      "new_version",
    );
    expect(availability).toMatchObject({
      showOverride: true,
      showOverwrite: false,
      defaultMode: "override",
    });
    expect(
      resolveLaborApplyMode("labor-1", availability, new Map([["labor-1", "overwrite"]])),
    ).toBe("override");
  });

  it("forces overwrite only on Save this version when New recipe matches Current only", () => {
    const row = { labor_role: "Prep", minutes: 30 };
    expect(laborMatchesCurrentVersion(meta, row)).toBe(true);
    const availability = resolveLaborApplyAvailabilityForSave(
      meta,
      row,
      "this_version",
    );
    expect(availability).toMatchObject({
      showOverride: false,
      showOverwrite: true,
    });
  });
});
