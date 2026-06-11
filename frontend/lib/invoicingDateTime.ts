/** Today's calendar date in local timezone: YYYY-MM-DD. */
export function todayLocalDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize invoice_date to YYYY-MM-DD for display and filters. */
export function formatInvoiceDateDisplay(
  value: string | null | undefined,
): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize invoice_date filter/sort comparisons to YYYY-MM-DD. */
export function invoiceDateCalendarYmd(
  value: string | null | undefined,
): string | null {
  const formatted = formatInvoiceDateDisplay(value);
  return formatted || null;
}
