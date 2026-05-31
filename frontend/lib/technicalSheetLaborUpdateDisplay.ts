import type {
  StandardRecipeDiff,
  StandardSheetApplyMode,
  StandardSheetSaveMode,
} from "@/lib/api";
import type { PuChoice } from "@/lib/technicalSheetUpdateDisplay";

export type LaborUpdateRowChoices = {
  minutes: PuChoice;
};

export type LaborUpdateDiffType =
  | "added"
  | "removed"
  | "changed"
  | "unchanged"
  | "role_swap";

export type LaborUpdateRowMeta = {
  row_key: string;
  diffType: LaborUpdateDiffType;
  sheetRole: string | null;
  liveRole: string | null;
  sheetMinutes: number | null;
  liveMinutes: number | null;
};

export type LaborRoleSwapPair = {
  removedKey: string;
  addedKey: string;
  minutes: number;
};

export type LaborUpdateDisplayPlan = {
  displayKeys: string[];
  roleSwaps: Map<string, LaborRoleSwapPair>;
  pairedRemovedKeys: Set<string>;
};

export function laborRoleSwapDisplayKey(minutes: number): string {
  return `labor-swap:${minutes}`;
}

function laborSemanticKey(labor_role: string, minutes: number): string {
  return `${labor_role.trim()}|${minutes}`;
}

export function detectLaborRoleSwapPairs(
  diff: StandardRecipeDiff,
): Map<string, LaborRoleSwapPair> {
  const laborLines = diff.labor_lines ?? [];
  const removedByMinutes = new Map<number, string[]>();
  const addedByMinutes = new Map<number, string[]>();

  for (const line of laborLines) {
    if (line.type === "removed" && line.saved_minutes != null) {
      const list = removedByMinutes.get(line.saved_minutes) ?? [];
      list.push(line.row_key);
      removedByMinutes.set(line.saved_minutes, list);
    } else if (line.type === "added" && line.live_minutes != null) {
      const list = addedByMinutes.get(line.live_minutes) ?? [];
      list.push(line.row_key);
      addedByMinutes.set(line.live_minutes, list);
    }
  }

  const pairs = new Map<string, LaborRoleSwapPair>();
  for (const [minutes, removedKeys] of removedByMinutes) {
    const addedKeys = addedByMinutes.get(minutes) ?? [];
    if (removedKeys.length === 1 && addedKeys.length === 1) {
      pairs.set(String(minutes), {
        removedKey: removedKeys[0]!,
        addedKey: addedKeys[0]!,
        minutes,
      });
    }
  }
  return pairs;
}

export function buildLaborUpdateDisplayPlan(
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string> = new Set(),
): LaborUpdateDisplayPlan {
  const roleSwaps = detectLaborRoleSwapPairs(diff);
  const laborSaved = diff.labor_saved ?? [];
  const laborLive = diff.labor_live ?? [];
  const savedByKey = new Map(laborSaved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(laborLive.map((l) => [l.row_key, l]));

  type SemEntry = {
    saved?: (typeof laborSaved)[number];
    live?: (typeof laborLive)[number];
  };
  const bySem = new Map<string, SemEntry>();
  for (const line of laborSaved) {
    const sem = laborSemanticKey(line.labor_role, line.minutes);
    const entry = bySem.get(sem) ?? {};
    entry.saved = line;
    bySem.set(sem, entry);
  }
  for (const line of laborLive) {
    const sem = laborSemanticKey(line.labor_role, line.minutes);
    const entry = bySem.get(sem) ?? {};
    entry.live = line;
    bySem.set(sem, entry);
  }

  const pairedRemovedKeys = new Set<string>();
  for (const pair of roleSwaps.values()) {
    pairedRemovedKeys.add(pair.removedKey);
    pairedRemovedKeys.add(pair.addedKey);
  }

  const displayKeys: string[] = [];
  const swapMinutesInserted = new Set<number>();

  const sortedSem = [...bySem.keys()].sort((a, b) => {
    const roleA = a.split("|")[0] ?? a;
    const roleB = b.split("|")[0] ?? b;
    const byRole = roleA.localeCompare(roleB);
    if (byRole !== 0) return byRole;
    return a.localeCompare(b);
  });

  for (const sem of sortedSem) {
    const { saved, live } = bySem.get(sem)!;
    if (saved && live) {
      const minutes = saved.minutes;
      const pair = roleSwaps.get(String(minutes));
      if (
        pair &&
        pair.removedKey === saved.row_key &&
        pair.addedKey === live.row_key &&
        !swapMinutesInserted.has(minutes)
      ) {
        swapMinutesInserted.add(minutes);
        displayKeys.push(laborRoleSwapDisplayKey(minutes));
        continue;
      }
      displayKeys.push(live.row_key);
      continue;
    }
    if (saved && !live) {
      if (
        restoredRemovedKeys.has(saved.row_key) ||
        !pairedRemovedKeys.has(saved.row_key)
      ) {
        displayKeys.push(saved.row_key);
      }
      continue;
    }
    if (live && !saved) {
      displayKeys.push(live.row_key);
    }
  }

  return { displayKeys, roleSwaps, pairedRemovedKeys };
}

export function buildLaborUpdateMetaByRowKey(
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string> = new Set(),
): Map<string, LaborUpdateRowMeta> {
  const plan = buildLaborUpdateDisplayPlan(diff, restoredRemovedKeys);
  const diffByKey = new Map((diff.labor_lines ?? []).map((l) => [l.row_key, l]));
  const laborSaved = diff.labor_saved ?? [];
  const laborLive = diff.labor_live ?? [];
  const savedByKey = new Map(laborSaved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(laborLive.map((l) => [l.row_key, l]));
  const meta = new Map<string, LaborUpdateRowMeta>();

  const findSavedForDisplay = (
    displayKey: string,
  ): (typeof laborSaved)[number] | undefined => {
    const direct = savedByKey.get(displayKey);
    if (direct) return direct;
    const liveLine = liveByKey.get(displayKey);
    if (!liveLine) return undefined;
    const sem = laborSemanticKey(liveLine.labor_role, liveLine.minutes);
    return laborSaved.find(
      (s) => laborSemanticKey(s.labor_role, s.minutes) === sem,
    );
  };

  const findLiveForDisplay = (
    displayKey: string,
  ): (typeof laborLive)[number] | undefined => {
    const direct = liveByKey.get(displayKey);
    if (direct) return direct;
    const savedLine = savedByKey.get(displayKey);
    if (!savedLine) return undefined;
    const sem = laborSemanticKey(savedLine.labor_role, savedLine.minutes);
    return laborLive.find(
      (l) => laborSemanticKey(l.labor_role, l.minutes) === sem,
    );
  };

  for (const displayKey of plan.displayKeys) {
    const { sheetKey, liveKey } = resolveLaborSnapshotKeysForChoice(
      displayKey,
      plan.roleSwaps,
    );
    const diffLine =
      diffByKey.get(displayKey) ??
      diffByKey.get(sheetKey) ??
      diffByKey.get(liveKey);
    const savedLine = findSavedForDisplay(displayKey) ?? savedByKey.get(sheetKey);
    const liveLine = findLiveForDisplay(displayKey) ?? liveByKey.get(liveKey);

    let diffType: LaborUpdateDiffType = diffLine?.type ?? "unchanged";
    if (diffType === "removed" && restoredRemovedKeys.has(sheetKey)) {
      diffType = "unchanged";
    }

    meta.set(displayKey, {
      row_key: displayKey,
      diffType,
      sheetRole: diffLine?.saved_labor_role ?? savedLine?.labor_role ?? null,
      liveRole: diffLine?.live_labor_role ?? liveLine?.labor_role ?? null,
      sheetMinutes: diffLine?.saved_minutes ?? savedLine?.minutes ?? null,
      liveMinutes: diffLine?.live_minutes ?? liveLine?.minutes ?? null,
    });
  }

  return meta;
}

export function defaultLaborUpdateRowChoices(
  diff: StandardRecipeDiff,
  plan: LaborUpdateDisplayPlan,
): Map<string, LaborUpdateRowChoices> {
  const choices = new Map<string, LaborUpdateRowChoices>();
  for (const key of plan.displayKeys) {
    choices.set(key, { minutes: "live" });
  }
  for (const line of diff.labor_lines ?? []) {
    if (line.type === "removed") {
      choices.set(line.row_key, { minutes: "sheet" });
    }
  }
  return choices;
}

/** Removed (pending Restore) rows: Override only — recipe has no line to overwrite. */
export function defaultLaborApplyModes(
  diff: StandardRecipeDiff,
  plan: LaborUpdateDisplayPlan,
): Map<string, StandardSheetApplyMode> {
  const modes = new Map<string, StandardSheetApplyMode>();
  for (const key of plan.displayKeys) {
    modes.set(key, "overwrite");
  }
  for (const line of diff.labor_lines ?? []) {
    if (line.type === "removed" && !plan.pairedRemovedKeys.has(line.row_key)) {
      modes.set(line.row_key, "override");
    }
  }
  return modes;
}

export function effectiveLaborChoice(
  diffType: LaborUpdateDiffType,
  stored: PuChoice | undefined,
): PuChoice {
  if (diffType === "added") return "live";
  if (diffType === "removed") return "sheet";
  return stored ?? "live";
}

/** Role for a single-column display (row color conveys add/remove/change). */
export function laborRoleForDisplay(meta: LaborUpdateRowMeta): string {
  if (meta.diffType === "removed") {
    return (meta.sheetRole ?? "").trim();
  }
  return (meta.liveRole ?? meta.sheetRole ?? "").trim();
}

export function minutesDifferForMeta(meta: LaborUpdateRowMeta): boolean {
  const s = meta.sheetMinutes ?? 0;
  const l = meta.liveMinutes ?? 0;
  return Math.abs(s - l) > 0.001;
}

export function showLaborMinutesVersionSplit(
  diffType: LaborUpdateDiffType,
  meta: LaborUpdateRowMeta,
): boolean {
  return diffType === "changed" && minutesDifferForMeta(meta);
}

export type EditMinutesRadioResolve = {
  showRadios: boolean;
  displayChoice: PuChoice;
};

function minutesMatch(
  a: number | null | undefined,
  b: number | null | undefined,
): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= 0.001;
}

export function minutesMatchesSheet(
  meta: LaborUpdateRowMeta,
  minutes: number,
): boolean {
  return minutesMatch(minutes, meta.sheetMinutes);
}

export function minutesMatchesLive(
  meta: LaborUpdateRowMeta,
  minutes: number,
): boolean {
  return minutesMatch(minutes, meta.liveMinutes);
}

function roleMatchesSheet(meta: LaborUpdateRowMeta, role: string): boolean {
  const sheet = (meta.sheetRole ?? "").trim();
  if (!sheet) return false;
  return role.trim() === sheet;
}

function roleMatchesLive(meta: LaborUpdateRowMeta, role: string): boolean {
  const live = (meta.liveRole ?? "").trim();
  if (!live) return false;
  return role.trim() === live;
}

/** True when draft row differs from both Current version and Recipe database. */
export function laborRowDiffersFromVersions(
  meta: LaborUpdateRowMeta,
  row: { labor_role: string; minutes: number },
): boolean {
  if (!roleMatchesSheet(meta, row.labor_role)) return true;
  if (!roleMatchesLive(meta, row.labor_role)) return true;
  if (!minutesMatchesSheet(meta, row.minutes)) return true;
  if (!minutesMatchesLive(meta, row.minutes)) return true;
  return false;
}

export function laborMatchesCurrentVersion(
  meta: LaborUpdateRowMeta,
  row: { labor_role: string; minutes: number },
): boolean {
  return (
    roleMatchesSheet(meta, row.labor_role) &&
    minutesMatchesSheet(meta, row.minutes)
  );
}

export function laborMatchesRecipeDatabase(
  meta: LaborUpdateRowMeta,
  row: { labor_role: string; minutes: number },
): boolean {
  return (
    roleMatchesLive(meta, row.labor_role) &&
    minutesMatchesLive(meta, row.minutes)
  );
}

export type LaborApplyAvailability = {
  inactive: boolean;
  showOverride: boolean;
  showOverwrite: boolean;
  defaultMode: StandardSheetApplyMode;
};

function laborApplyAvailabilityBase(
  meta: LaborUpdateRowMeta | undefined,
  row: { labor_role: string; minutes: number },
  opts?: { isNew?: boolean },
): LaborApplyAvailability {
  if (opts?.isNew || meta == null) {
    return {
      inactive: false,
      showOverride: true,
      showOverwrite: true,
      defaultMode: "overwrite",
    };
  }

  const matchesCurrent = laborMatchesCurrentVersion(meta, row);
  const matchesLive = laborMatchesRecipeDatabase(meta, row);

  if (matchesCurrent && matchesLive) {
    return {
      inactive: true,
      showOverride: false,
      showOverwrite: false,
      defaultMode: "override",
    };
  }

  if (matchesLive && !matchesCurrent) {
    return {
      inactive: false,
      showOverride: true,
      showOverwrite: false,
      defaultMode: "override",
    };
  }

  if (matchesCurrent && !matchesLive) {
    return {
      inactive: false,
      showOverride: true,
      showOverwrite: true,
      defaultMode: "overwrite",
    };
  }

  return {
    inactive: false,
    showOverride: true,
    showOverwrite: true,
    defaultMode: "overwrite",
  };
}

export function resolveLaborApplyAvailabilityForDisplay(
  meta: LaborUpdateRowMeta | undefined,
  row: { labor_role: string; minutes: number },
  opts?: { isNew?: boolean },
): LaborApplyAvailability {
  return laborApplyAvailabilityBase(meta, row, opts);
}

export function resolveLaborApplyAvailabilityForSave(
  meta: LaborUpdateRowMeta | undefined,
  row: { labor_role: string; minutes: number },
  saveMode: StandardSheetSaveMode,
  opts?: { isNew?: boolean },
): LaborApplyAvailability {
  const base = laborApplyAvailabilityBase(meta, row, opts);

  if (
    saveMode === "this_version" &&
    base.showOverride &&
    base.showOverwrite &&
    !base.inactive &&
    meta != null
  ) {
    const matchesCurrent = laborMatchesCurrentVersion(meta, row);
    const matchesLive = laborMatchesRecipeDatabase(meta, row);
    if (matchesCurrent && !matchesLive) {
      return {
        inactive: false,
        showOverride: false,
        showOverwrite: true,
        defaultMode: "overwrite",
      };
    }
  }

  return base;
}

/** @deprecated Use resolveLaborApplyAvailabilityForDisplay().inactive */
export function isLaborApplyChoiceNeeded(
  diffType: LaborUpdateDiffType | undefined,
  meta: LaborUpdateRowMeta | undefined,
  row: { labor_role: string; minutes: number },
  opts?: { isNew?: boolean },
): boolean {
  void diffType;
  return !resolveLaborApplyAvailabilityForDisplay(meta, row, opts).inactive;
}

export function resolveLaborApplyMode(
  rowKey: string,
  availability: LaborApplyAvailability,
  modes: Map<string, StandardSheetApplyMode> | undefined,
): StandardSheetApplyMode {
  if (availability.inactive) return "override";
  if (!availability.showOverwrite) return "override";
  if (!availability.showOverride) return "overwrite";
  return modes?.get(rowKey) ?? availability.defaultMode;
}

export function resolveEditMinutesRadios(
  meta: LaborUpdateRowMeta,
  diffType: LaborUpdateDiffType,
  minutes: number,
  stored?: PuChoice,
): EditMinutesRadioResolve {
  const fallback = effectiveLaborChoice(diffType, stored);
  const matchesSheet = minutesMatchesSheet(meta, minutes);
  const matchesLive = minutesMatchesLive(meta, minutes);
  if (matchesSheet && !matchesLive) {
    return { showRadios: true, displayChoice: "sheet" };
  }
  if (matchesLive && !matchesSheet) {
    return { showRadios: true, displayChoice: "live" };
  }
  if (matchesSheet && matchesLive) {
    return { showRadios: true, displayChoice: fallback };
  }
  return { showRadios: false, displayChoice: fallback };
}

/** Recipe line id to persist on save (not display keys like labor-swap:30). */
export function laborPersistRowKey(
  displayKey: string,
  roleSwaps: Map<string, LaborRoleSwapPair>,
): string | undefined {
  if (!displayKey || displayKey.startsWith("new-")) return undefined;
  if (displayKey.startsWith("labor-swap:")) {
    const minutes = Number(displayKey.slice(11));
    const pair = roleSwaps.get(String(minutes));
    return pair?.addedKey;
  }
  return displayKey;
}

export function resolveLaborSnapshotKeysForChoice(
  displayKey: string,
  roleSwaps: Map<string, LaborRoleSwapPair>,
): { sheetKey: string; liveKey: string } {
  if (displayKey.startsWith("labor-swap:")) {
    const minutes = Number(displayKey.slice(11));
    const pair = roleSwaps.get(String(minutes));
    if (pair) {
      return { sheetKey: pair.removedKey, liveKey: pair.addedKey };
    }
  }
  return { sheetKey: displayKey, liveKey: displayKey };
}

export function laborCostFromWage(
  hourlyWage: number | null | undefined,
  minutes: number,
): number | null {
  if (hourlyWage == null || !Number.isFinite(hourlyWage) || hourlyWage <= 0) {
    return null;
  }
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return (hourlyWage / 60) * minutes;
}

export function formatLaborMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const display = Number.isInteger(minutes) ? minutes : Number(minutes.toFixed(2));
  return `${display} min`;
}

export function formatLaborWage(hourlyWage: number | null | undefined): string {
  if (hourlyWage == null || !Number.isFinite(hourlyWage)) return "—";
  return `$${hourlyWage.toFixed(2)}/hr`;
}

export function formatLaborCost(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return "—";
  return `$${cost.toFixed(2)}`;
}
