import {
  buildLaborDiffLines,
  compareLaborSnapshots,
  compareRecipeSnapshotsAsync,
  type LaborSnapshotLine,
} from "../../src/services/technical-sheet-builder";

function laborLine(
  row_key: string,
  labor_role: string,
  minutes: number,
): LaborSnapshotLine {
  return { line_type: "labor", row_key, labor_role, minutes };
}

describe("technical sheet snapshot diff (labor)", () => {
  it("compareLaborSnapshots is false when saved and live labor match", () => {
    const row = laborLine("line-1", "Cook", 300);
    expect(compareLaborSnapshots([row], [row])).toBe(false);
  });

  it("compareLaborSnapshots is false when role+minutes match but row_key differs", () => {
    const saved = laborLine("snapshot-id-aaa", "$0.01 per hour worker", 300);
    const live = laborLine("live-id-bbb", "$0.01 per hour worker", 300);
    expect(compareLaborSnapshots([saved], [live])).toBe(false);
  });

  it("buildLaborDiffLines is empty when only labor row_key differs", () => {
    const saved = laborLine("snapshot-id-aaa", "Cook", 300);
    const live = laborLine("live-id-bbb", "Cook", 300);
    expect(buildLaborDiffLines([saved], [live])).toEqual([]);
  });

  it("compareLaborSnapshots is true when live has no labor but saved does", () => {
    expect(
      compareLaborSnapshots([laborLine("line-1", "Cook", 300)], []),
    ).toBe(true);
  });

  it("compareRecipeSnapshotsAsync false-positives if live omits labor (old banner bug)", async () => {
    const saved = [laborLine("line-1", "Cook", 300)];
    expect(await compareRecipeSnapshotsAsync(saved, [])).toBe(true);
  });

  it("compareRecipeSnapshotsAsync is false when live includes matching labor", async () => {
    const row = laborLine("line-1", "Cook", 300);
    expect(await compareRecipeSnapshotsAsync([row], [row])).toBe(false);
  });
});
