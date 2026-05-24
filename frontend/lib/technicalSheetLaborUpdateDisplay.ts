import type { StandardRecipeDiff } from "@/lib/api";
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
  _restoredRemovedKeys: ReadonlySet<string> = new Set(),
): LaborUpdateDisplayPlan {
  const roleSwaps = detectLaborRoleSwapPairs(diff);
  const laborSaved = diff.labor_saved ?? [];
  const laborLive = diff.labor_live ?? [];
  const allKeys = new Set([
    ...laborSaved.map((l) => l.row_key),
    ...laborLive.map((l) => l.row_key),
  ]);
  const savedByKey = new Map(laborSaved.map((l) => [l.row_key, l]));
  const liveByKey = new Map(laborLive.map((l) => [l.row_key, l]));

  const displayKeys = [...allKeys].sort((a, b) => {
    const roleA = savedByKey.get(a)?.labor_role ?? liveByKey.get(a)?.labor_role ?? a;
    const roleB = savedByKey.get(b)?.labor_role ?? liveByKey.get(b)?.labor_role ?? b;
    const byRole = roleA.localeCompare(roleB);
    if (byRole !== 0) return byRole;
    return a.localeCompare(b);
  });

  return { displayKeys, roleSwaps, pairedRemovedKeys: new Set() };
}

export function buildLaborUpdateMetaByRowKey(
  diff: StandardRecipeDiff,
  restoredRemovedKeys: ReadonlySet<string> = new Set(),
): Map<string, LaborUpdateRowMeta> {
  const plan = buildLaborUpdateDisplayPlan(diff, restoredRemovedKeys);
  const diffByKey = new Map((diff.labor_lines ?? []).map((l) => [l.row_key, l]));
  const savedByKey = new Map((diff.labor_saved ?? []).map((l) => [l.row_key, l]));
  const liveByKey = new Map((diff.labor_live ?? []).map((l) => [l.row_key, l]));
  const meta = new Map<string, LaborUpdateRowMeta>();

  const allKeys = new Set([
    ...(diff.labor_saved ?? []).map((l) => l.row_key),
    ...(diff.labor_live ?? []).map((l) => l.row_key),
  ]);

  for (const rowKey of allKeys) {
    const diffLine = diffByKey.get(rowKey);
    const savedLine = savedByKey.get(rowKey);
    const liveLine = liveByKey.get(rowKey);

    let diffType: LaborUpdateDiffType = diffLine?.type ?? "unchanged";
    if (diffType === "removed" && restoredRemovedKeys.has(rowKey)) {
      diffType = "unchanged";
    }

    meta.set(rowKey, {
      row_key: rowKey,
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
