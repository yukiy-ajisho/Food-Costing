const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse invoice_date for storage (timestamptz / ISO UTC). */
export function parseRequiredInvoiceDateTime(
  value: unknown,
  field: string,
): string | { error: string } {
  if (value == null || String(value).trim() === "") {
    return { error: `${field} is required` };
  }
  const s = String(value).trim();

  if (LOCAL_DATETIME_RE.test(s)) {
    return { error: `${field} must be ISO 8601 UTC (send from client)` };
  }

  if (ISO_DATE_RE.test(s)) {
    return `${s}T00:00:00.000Z`;
  }

  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${field} is invalid` };
  }
  return parsed.toISOString();
}

/** Optional YYYY-MM-DD for invoice number (user's picked calendar date). */
export function parseOptionalInvoiceDateYmd(
  value: unknown,
): string | null | { error: string } {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  if (!ISO_DATE_RE.test(s)) {
    return { error: "invoice_date_ymd must be YYYY-MM-DD" };
  }
  return s;
}

export function resolveInvoiceNumberCalendarYmd(
  invoiceDateIso: string,
  invoiceDateYmd: string | null | undefined,
): string {
  if (invoiceDateYmd && ISO_DATE_RE.test(invoiceDateYmd)) {
    return invoiceDateYmd;
  }
  return invoiceDateIso.slice(0, 10);
}

/** Email / logs: YYYY-MM-DD HH:mm in UTC from stored ISO. */
export function formatInvoiceDateTimeDisplayUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
