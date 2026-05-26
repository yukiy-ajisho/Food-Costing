/** LCOG caution / over threshold helpers for recipe cost report lists. */

export type LcogThresholdCellState = "dash" | "none" | "yellow" | "red";

export type EffectiveLcogThresholds = {
  /** Values used for row icons (invalid fields excluded). */
  caution: number | null;
  over: number | null;
  cautionInvalid: boolean;
  overInvalid: boolean;
};

const THRESHOLD_COLUMN_STORAGE_PREFIX = "recipe-cost-report:lcog-threshold-column:";

export function lcogThresholdColumnStorageKey(
  pageMode: "wholesale" | "menu",
): string {
  return `${THRESHOLD_COLUMN_STORAGE_PREFIX}${pageMode}`;
}

/** Tab-wide column visibility (Wholesale Costing vs Pricing Strategy). Default OFF. */
export function readLcogThresholdColumnVisible(
  pageMode: "wholesale" | "menu",
): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    localStorage.getItem(lcogThresholdColumnStorageKey(pageMode)) === "true"
  );
}

export function writeLcogThresholdColumnVisible(
  pageMode: "wholesale" | "menu",
  visible: boolean,
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    lcogThresholdColumnStorageKey(pageMode),
    visible ? "true" : "false",
  );
}

export function normalizeThresholdFromApi(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function thresholdToDraftString(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function decimalPlacesExceeded(raw: string, maxPlaces: number): boolean {
  const t = raw.trim();
  const dot = t.indexOf(".");
  if (dot === -1) return false;
  return t.length - dot - 1 > maxPlaces;
}

function parsePositiveThreshold(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "" || t === ".") return null;
  if (decimalPlacesExceeded(t, 2)) return "invalid";
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return "invalid";
  return n;
}

/** Edit-time validation; invalid fields are excluded from icon logic but stay typed. */
export function getEffectiveLcogThresholds(
  cautionRaw: string,
  overRaw: string,
): EffectiveLcogThresholds {
  const cautionParsed = parsePositiveThreshold(cautionRaw);
  const overParsed = parsePositiveThreshold(overRaw);

  const cautionInvalid = cautionParsed === "invalid";
  let overInvalid = overParsed === "invalid";
  const caution: number | null =
    cautionParsed === "invalid" || cautionParsed === null ? null : cautionParsed;
  let over: number | null =
    overParsed === "invalid" || overParsed === null ? null : overParsed;

  if (caution != null && over != null && caution >= over) {
    overInvalid = true;
    over = null;
  }

  return {
    caution: cautionInvalid ? null : caution,
    over: overInvalid ? null : over,
    cautionInvalid,
    overInvalid,
  };
}

export function formatLcogThresholdHeaderLabel(
  caution: number | null,
  over: number | null,
): string {
  const c =
    caution != null && Number.isFinite(caution)
      ? formatThresholdNumber(caution)
      : "—";
  const o =
    over != null && Number.isFinite(over) ? formatThresholdNumber(over) : "—";
  return `${c}/${o}`;
}

function formatThresholdNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function getLcogThresholdCellState(
  lcogPercent: number | null | undefined,
  thresholds: Pick<EffectiveLcogThresholds, "caution" | "over">,
): LcogThresholdCellState {
  if (lcogPercent == null || !Number.isFinite(lcogPercent)) {
    return "dash";
  }
  if (thresholds.caution == null && thresholds.over == null) {
    return "dash";
  }

  const { caution, over } = thresholds;

  if (over != null && lcogPercent >= over) {
    return "red";
  }
  if (caution != null && lcogPercent >= caution) {
    if (over == null || lcogPercent < over) {
      return "yellow";
    }
  }
  return "none";
}

export type LcogThresholdSaveValidation = {
  ok: true;
  caution: number | null;
  over: number | null;
} | {
  ok: false;
  message: string;
};

/** Create list: both empty → null; otherwise same rules as save. */
export function validateLcogThresholdsForCreate(
  cautionRaw: string,
  overRaw: string,
): LcogThresholdSaveValidation {
  const cautionEmpty =
    cautionRaw.trim() === "" || cautionRaw.trim() === ".";
  const overEmpty = overRaw.trim() === "" || overRaw.trim() === ".";
  if (cautionEmpty && overEmpty) {
    return { ok: true, caution: null, over: null };
  }
  return validateLcogThresholdsForSave(cautionRaw, overRaw);
}

/** Save when threshold column is ON in edit mode. */
export function validateLcogThresholdsForSave(
  cautionRaw: string,
  overRaw: string,
): LcogThresholdSaveValidation {
  const cautionEmpty =
    cautionRaw.trim() === "" || cautionRaw.trim() === ".";
  const overEmpty = overRaw.trim() === "" || overRaw.trim() === ".";

  if (cautionEmpty && overEmpty) {
    return { ok: true, caution: null, over: null };
  }

  const effective = getEffectiveLcogThresholds(cautionRaw, overRaw);

  if (effective.cautionInvalid || effective.overInvalid) {
    return {
      ok: false,
      message:
        "Fix caution and over values: each must be greater than 0, up to 2 decimal places, and caution must be less than over when both are set.",
    };
  }

  const cautionParsed = parsePositiveThreshold(cautionRaw);
  const overParsed = parsePositiveThreshold(overRaw);
  const caution =
    cautionParsed === "invalid" || cautionParsed === null
      ? null
      : cautionParsed;
  const over =
    overParsed === "invalid" || overParsed === null ? null : overParsed;

  if (caution != null && over != null && caution >= over) {
    return {
      ok: false,
      message: "Caution must be less than over when both are set.",
    };
  }

  return { ok: true, caution, over };
}

export function thresholdsEqual(
  a: number | null,
  b: number | null,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-9;
}
