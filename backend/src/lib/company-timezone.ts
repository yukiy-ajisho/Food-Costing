import { supabase } from "../config/supabase";

export const DEFAULT_COMPANY_TIMEZONE = "America/Los_Angeles";

/** Keep in sync with frontend/lib/companyTimezone.ts INVOICING_TIMEZONE_OPTIONS */
export const ALLOWED_COMPANY_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Mexico_City",
  "America/Tijuana",
  "America/Cancun",
  "America/Guatemala",
  "America/Panama",
  "America/Costa_Rica",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Bogota",
  "America/Lima",
  "America/Caracas",
  "America/La_Paz",
  "America/Montevideo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Atlantic/Reykjavik",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Helsinki",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Budapest",
  "Europe/Bucharest",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Jerusalem",
  "Asia/Beirut",
  "Asia/Amman",
  "Asia/Baghdad",
  "Asia/Tehran",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Casablanca",
  "Africa/Accra",
  "Africa/Addis_Ababa",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Asia/Kathmandu",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Yangon",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Ulaanbaatar",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Guam",
] as const;

const ALLOWED_COMPANY_TIMEZONE_SET = new Set<string>(
  ALLOWED_COMPANY_TIMEZONES,
);

export function normalizeCompanyTimezoneInput(value: unknown): string | null {
  if (value == null || typeof value !== "string") {
    return null;
  }
  const tz = value.trim();
  if (!tz || !ALLOWED_COMPANY_TIMEZONE_SET.has(tz)) {
    return null;
  }
  return tz;
}

/** Calendar YYYY-MM-DD in an IANA timezone. */
export function formatYmdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function currentCalendarPeriodInTz(
  timeZone: string,
  now: Date = new Date(),
): string {
  return formatYmdInTimeZone(now, timeZone).slice(0, 7);
}

export function shiftPeriod(period: string, deltaMonths: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) {
    throw new Error(`Invalid period: ${period}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid period: ${period}`);
  }
  const absolute = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(absolute / 12);
  const nextMonth = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

/** Previous calendar month (YYYY-MM) in company timezone. */
export function previousMonthPeriodInTz(
  timeZone: string,
  now: Date = new Date(),
): string {
  return shiftPeriod(currentCalendarPeriodInTz(timeZone, now), -1);
}

/**
 * §14-5: previous month is locked once company TZ has reached the 1st of the current month.
 */
export function isPeriodCalendarLocked(
  period: string,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const currentPeriod = currentCalendarPeriodInTz(timeZone, now);
  const previousPeriod = shiftPeriod(currentPeriod, -1);
  if (period !== previousPeriod) {
    return false;
  }
  const todayYmd = formatYmdInTimeZone(now, timeZone);
  return todayYmd >= `${currentPeriod}-01`;
}

export async function getCompanyTimezoneIfSet(
  companyId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const tz = data?.timezone?.trim();
  return tz || null;
}

export async function getCompanyTimezone(companyId: string): Promise<string> {
  const tz = await getCompanyTimezoneIfSet(companyId);
  return tz || DEFAULT_COMPANY_TIMEZONE;
}
