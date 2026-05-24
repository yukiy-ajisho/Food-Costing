/** PU is stored as $/g; display as $/kg in technical sheet tables. */
export function formatPuPerKg(puPerGram: number | null | undefined): string {
  if (puPerGram == null || !Number.isFinite(puPerGram)) return "—";
  if (puPerGram === 0) return "";
  return `$${(puPerGram * 1000).toFixed(2)}`;
}

/** PT is row ingredient cost in dollars. */
export function formatPtDollars(pt: number | null | undefined): string {
  if (pt == null || !Number.isFinite(pt)) return "—";
  if (pt === 0) return "";
  return `$${pt.toFixed(2)}`;
}

function formatTotalDollars(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total)) return "—";
  return `$${total.toFixed(2)}`;
}

/** ($snapshot) $current for PU (per kg). */
export function formatDualPuPerKg(
  snapshotPu: number | null | undefined,
  currentPu: number | null | undefined,
): string {
  return `(${formatPuPerKg(snapshotPu)}) ${formatPuPerKg(currentPu)}`;
}

/** ($snapshot) $current for PT. */
export function formatDualPtDollars(
  snapshotPt: number | null | undefined,
  currentPt: number | null | undefined,
): string {
  return `(${formatPtDollars(snapshotPt)}) ${formatPtDollars(currentPt)}`;
}

/** ($snapshot) $current for hourly wage. */
export function formatDualHourlyWage(
  snapshotWage: number | null | undefined,
  currentWage: number | null | undefined,
): string {
  const snap =
    snapshotWage != null && Number.isFinite(snapshotWage)
      ? `$${snapshotWage.toFixed(2)}/hr`
      : "—";
  const cur =
    currentWage != null && Number.isFinite(currentWage)
      ? `$${currentWage.toFixed(2)}/hr`
      : "—";
  return `(${snap}) ${cur}`;
}

/** Stacked total: ($snapshot) on first line, $current on second. */
export function formatDualTotalCostLines(
  snapshotTotal: number | null | undefined,
  currentTotal: number | null | undefined,
): { snapshotLine: string; currentLine: string } {
  return {
    snapshotLine: `(${formatTotalDollars(snapshotTotal)})`,
    currentLine: formatTotalDollars(currentTotal),
  };
}
