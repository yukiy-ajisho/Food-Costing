/** datetime-local value: YYYY-MM-DDTHH:mm (browser local, no seconds). */

const LOCAL_DATETIME_INPUT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function nowLocalDateTimeInputValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** Parse datetime-local into a Date (browser local wall clock). */
export function parseLocalDateTimeInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!LOCAL_DATETIME_INPUT_RE.test(trimmed)) return null;
  const [datePart, timePart] = trimmed.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

/** datetime-local → ISO UTC for API / DB (timestamptz). */
export function localDateTimeInputToIso(value: string): string | null {
  const dt = parseLocalDateTimeInput(value);
  if (!dt) return null;
  return dt.toISOString();
}

/** ISO UTC → datetime-local for <input type="datetime-local" />. */
export function isoToLocalDateTimeInput(iso: string): string {
  const trimmed = iso.trim();
  if (LOCAL_DATETIME_INPUT_RE.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function parseInvoiceDateTimeValue(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const local = parseLocalDateTimeInput(trimmed);
  if (local) return local;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Display on PDF / email: YYYY-MM-DD HH:mm in browser local time. */
export function formatInvoiceDateTimeDisplay(
  value: string | null | undefined,
): string {
  if (!value?.trim()) return "";
  const trimmed = value.trim();
  if (LOCAL_DATETIME_INPUT_RE.test(trimmed)) {
    const [datePart, timePart] = trimmed.split("T");
    return `${datePart} ${timePart}`;
  }
  const d = parseInvoiceDateTimeValue(trimmed);
  if (!d) return trimmed;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/** Invoice Box table: locale date + AM/PM time, space-separated (no comma). */
export function formatInvoiceDateTimeAmPm(
  value: string | null | undefined,
): string {
  if (!value?.trim()) return "";
  const d = parseInvoiceDateTimeValue(value.trim());
  if (!d) return value.trim();
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} ${timePart}`;
}

/** Calendar YYYY-MM-DD from datetime-local (invoice number date part). */
export function localDateYmdFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (LOCAL_DATETIME_INPUT_RE.test(trimmed)) return trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize invoice_date filter/sort comparisons to YYYY-MM-DD (local). */
export function invoiceDateCalendarYmd(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  return localDateYmdFromInput(value);
}
