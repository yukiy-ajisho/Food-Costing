/**
 * Maps a calendar date (YYYY-MM-DD) to a timestamptz for price_events.created_at:
 * that date at 00:00:00.000 UTC. Returns null if the string is not a valid date part.
 */
export function utcMidnightIsoFromYyyyMmDd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return `${t}T00:00:00.000Z`;
}
