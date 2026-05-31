import {
  formatLcogThresholdHeaderLabel,
  getEffectiveLcogThresholds,
  getLcogThresholdCellState,
  lcogThresholdColumnStorageKey,
  readLcogThresholdColumnVisible,
  validateLcogThresholdsForCreate,
  validateLcogThresholdsForSave,
  writeLcogThresholdColumnVisible,
} from "./recipeCostReportLcogThreshold";

describe("getLcogThresholdCellState", () => {
  const both = { caution: 60, over: 70 };

  it("dash when LCOG missing", () => {
    expect(getLcogThresholdCellState(null, both)).toBe("dash");
  });

  it("dash when no thresholds", () => {
    expect(
      getLcogThresholdCellState(65, { caution: null, over: null }),
    ).toBe("dash");
  });

  it("yellow when caution <= LCOG < over", () => {
    expect(getLcogThresholdCellState(60, both)).toBe("yellow");
    expect(getLcogThresholdCellState(69.9, both)).toBe("yellow");
  });

  it("red when over <= LCOG", () => {
    expect(getLcogThresholdCellState(70, both)).toBe("red");
    expect(getLcogThresholdCellState(80, both)).toBe("red");
  });

  it("none below caution", () => {
    expect(getLcogThresholdCellState(59.9, both)).toBe("none");
  });

  it("caution only: yellow from caution upward", () => {
    expect(
      getLcogThresholdCellState(65, { caution: 60, over: null }),
    ).toBe("yellow");
    expect(
      getLcogThresholdCellState(50, { caution: 60, over: null }),
    ).toBe("none");
  });

  it("over only: red from over upward", () => {
    expect(getLcogThresholdCellState(70, { caution: null, over: 70 })).toBe(
      "red",
    );
    expect(getLcogThresholdCellState(65, { caution: null, over: 70 })).toBe(
      "none",
    );
  });
});

describe("getEffectiveLcogThresholds", () => {
  it("invalidates both fields when caution >= over", () => {
    const r = getEffectiveLcogThresholds("60", "50");
    expect(r.caution).toBeNull();
    expect(r.over).toBeNull();
    expect(r.overInvalid).toBe(true);
    expect(r.cautionInvalid).toBe(true);
  });
});

describe("validateLcogThresholdsForCreate", () => {
  it("allows both empty", () => {
    const r = validateLcogThresholdsForCreate("", "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caution).toBeNull();
      expect(r.over).toBeNull();
    }
  });

  it("allows caution only", () => {
    const r = validateLcogThresholdsForCreate("60", "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caution).toBe(60);
      expect(r.over).toBeNull();
    }
  });
});

describe("formatLcogThresholdHeaderLabel", () => {
  it("formats partial values", () => {
    expect(formatLcogThresholdHeaderLabel(60, null)).toBe("60/—");
    expect(formatLcogThresholdHeaderLabel(null, 70)).toBe("—/70");
    expect(formatLcogThresholdHeaderLabel(60, 70)).toBe("60/70");
  });

  it("formats both null as dashes", () => {
    expect(formatLcogThresholdHeaderLabel(null, null)).toBe("—/—");
  });
});

describe("readLcogThresholdColumnVisible", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false when unset", () => {
    expect(readLcogThresholdColumnVisible("wholesale")).toBe(false);
    expect(readLcogThresholdColumnVisible("menu")).toBe(false);
  });

  it("persists tab-wide visibility", () => {
    writeLcogThresholdColumnVisible("wholesale", true);
    writeLcogThresholdColumnVisible("menu", false);
    expect(readLcogThresholdColumnVisible("wholesale")).toBe(true);
    expect(readLcogThresholdColumnVisible("menu")).toBe(false);
    expect(lcogThresholdColumnStorageKey("wholesale")).not.toContain(":list");
  });
});

describe("validateLcogThresholdsForSave", () => {
  it("allows both empty to clear saved thresholds", () => {
    const r = validateLcogThresholdsForSave("", "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caution).toBeNull();
      expect(r.over).toBeNull();
    }
  });
});
