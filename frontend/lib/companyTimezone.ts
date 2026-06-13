export type InvoicingTimezoneOption = {
  value: string;
  label: string;
};

export type InvoicingTimezoneOptionGroup = {
  label: string;
  options: InvoicingTimezoneOption[];
};

/** Major IANA timezones for invoicing. Keep ALLOWED_COMPANY_TIMEZONES in backend in sync. */
export const INVOICING_TIMEZONE_OPTION_GROUPS: InvoicingTimezoneOptionGroup[] =
  [
    {
      label: "United States",
      options: [
        {
          value: "America/Los_Angeles",
          label: "America/Los_Angeles (Pacific)",
        },
        { value: "America/Denver", label: "America/Denver (Mountain)" },
        {
          value: "America/Phoenix",
          label: "America/Phoenix (Arizona — no DST)",
        },
        { value: "America/Chicago", label: "America/Chicago (Central)" },
        { value: "America/New_York", label: "America/New_York (Eastern)" },
        { value: "America/Anchorage", label: "America/Anchorage (Alaska)" },
        { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii)" },
        {
          value: "America/Puerto_Rico",
          label: "America/Puerto_Rico (Atlantic)",
        },
      ],
    },
    {
      label: "Canada",
      options: [
        { value: "America/Toronto", label: "America/Toronto (Eastern)" },
        { value: "America/Vancouver", label: "America/Vancouver (Pacific)" },
        { value: "America/Edmonton", label: "America/Edmonton (Mountain)" },
        { value: "America/Winnipeg", label: "America/Winnipeg (Central)" },
        { value: "America/Halifax", label: "America/Halifax (Atlantic)" },
        {
          value: "America/St_Johns",
          label: "America/St_Johns (Newfoundland)",
        },
      ],
    },
    {
      label: "Mexico & Central America",
      options: [
        {
          value: "America/Mexico_City",
          label: "America/Mexico_City (Central)",
        },
        { value: "America/Tijuana", label: "America/Tijuana (Pacific)" },
        { value: "America/Cancun", label: "America/Cancun (Eastern)" },
        {
          value: "America/Guatemala",
          label: "America/Guatemala (Central America)",
        },
        { value: "America/Panama", label: "America/Panama" },
        { value: "America/Costa_Rica", label: "America/Costa_Rica" },
      ],
    },
    {
      label: "South America",
      options: [
        { value: "America/Sao_Paulo", label: "America/Sao_Paulo (Brazil)" },
        {
          value: "America/Buenos_Aires",
          label: "America/Buenos_Aires (Argentina)",
        },
        { value: "America/Santiago", label: "America/Santiago (Chile)" },
        { value: "America/Bogota", label: "America/Bogota (Colombia)" },
        { value: "America/Lima", label: "America/Lima (Peru)" },
        { value: "America/Caracas", label: "America/Caracas (Venezuela)" },
        { value: "America/La_Paz", label: "America/La_Paz (Bolivia)" },
        {
          value: "America/Montevideo",
          label: "America/Montevideo (Uruguay)",
        },
      ],
    },
    {
      label: "Europe",
      options: [
        { value: "Europe/London", label: "Europe/London (UK)" },
        { value: "Europe/Dublin", label: "Europe/Dublin (Ireland)" },
        { value: "Europe/Lisbon", label: "Europe/Lisbon (Portugal)" },
        {
          value: "Atlantic/Reykjavik",
          label: "Atlantic/Reykjavik (Iceland)",
        },
        { value: "Europe/Paris", label: "Europe/Paris (France)" },
        { value: "Europe/Berlin", label: "Europe/Berlin (Germany)" },
        {
          value: "Europe/Amsterdam",
          label: "Europe/Amsterdam (Netherlands)",
        },
        { value: "Europe/Brussels", label: "Europe/Brussels (Belgium)" },
        { value: "Europe/Madrid", label: "Europe/Madrid (Spain)" },
        { value: "Europe/Rome", label: "Europe/Rome (Italy)" },
        { value: "Europe/Zurich", label: "Europe/Zurich (Switzerland)" },
        { value: "Europe/Vienna", label: "Europe/Vienna (Austria)" },
        { value: "Europe/Stockholm", label: "Europe/Stockholm (Sweden)" },
        { value: "Europe/Oslo", label: "Europe/Oslo (Norway)" },
        { value: "Europe/Copenhagen", label: "Europe/Copenhagen (Denmark)" },
        { value: "Europe/Helsinki", label: "Europe/Helsinki (Finland)" },
        { value: "Europe/Warsaw", label: "Europe/Warsaw (Poland)" },
        { value: "Europe/Prague", label: "Europe/Prague (Czechia)" },
        { value: "Europe/Budapest", label: "Europe/Budapest (Hungary)" },
        { value: "Europe/Bucharest", label: "Europe/Bucharest (Romania)" },
        { value: "Europe/Athens", label: "Europe/Athens (Greece)" },
        { value: "Europe/Istanbul", label: "Europe/Istanbul (Turkey)" },
        { value: "Europe/Moscow", label: "Europe/Moscow (Russia)" },
        { value: "Europe/Kyiv", label: "Europe/Kyiv (Ukraine)" },
      ],
    },
    {
      label: "Middle East",
      options: [
        { value: "Asia/Dubai", label: "Asia/Dubai (UAE)" },
        { value: "Asia/Riyadh", label: "Asia/Riyadh (Saudi Arabia)" },
        { value: "Asia/Kuwait", label: "Asia/Kuwait" },
        { value: "Asia/Qatar", label: "Asia/Qatar" },
        { value: "Asia/Bahrain", label: "Asia/Bahrain" },
        { value: "Asia/Muscat", label: "Asia/Muscat (Oman)" },
        { value: "Asia/Jerusalem", label: "Asia/Jerusalem (Israel)" },
        { value: "Asia/Beirut", label: "Asia/Beirut (Lebanon)" },
        { value: "Asia/Amman", label: "Asia/Amman (Jordan)" },
        { value: "Asia/Baghdad", label: "Asia/Baghdad (Iraq)" },
        { value: "Asia/Tehran", label: "Asia/Tehran (Iran)" },
      ],
    },
    {
      label: "Africa",
      options: [
        { value: "Africa/Cairo", label: "Africa/Cairo (Egypt)" },
        {
          value: "Africa/Johannesburg",
          label: "Africa/Johannesburg (South Africa)",
        },
        { value: "Africa/Lagos", label: "Africa/Lagos (Nigeria)" },
        { value: "Africa/Nairobi", label: "Africa/Nairobi (Kenya)" },
        { value: "Africa/Casablanca", label: "Africa/Casablanca (Morocco)" },
        { value: "Africa/Accra", label: "Africa/Accra (Ghana)" },
        {
          value: "Africa/Addis_Ababa",
          label: "Africa/Addis_Ababa (Ethiopia)",
        },
      ],
    },
    {
      label: "South Asia",
      options: [
        { value: "Asia/Kolkata", label: "Asia/Kolkata (India)" },
        { value: "Asia/Karachi", label: "Asia/Karachi (Pakistan)" },
        { value: "Asia/Dhaka", label: "Asia/Dhaka (Bangladesh)" },
        { value: "Asia/Colombo", label: "Asia/Colombo (Sri Lanka)" },
        { value: "Asia/Kathmandu", label: "Asia/Kathmandu (Nepal)" },
      ],
    },
    {
      label: "Southeast Asia",
      options: [
        { value: "Asia/Bangkok", label: "Asia/Bangkok (Thailand)" },
        {
          value: "Asia/Ho_Chi_Minh",
          label: "Asia/Ho_Chi_Minh (Vietnam)",
        },
        {
          value: "Asia/Jakarta",
          label: "Asia/Jakarta (Indonesia — Western)",
        },
        {
          value: "Asia/Makassar",
          label: "Asia/Makassar (Indonesia — Central)",
        },
        { value: "Asia/Singapore", label: "Asia/Singapore" },
        { value: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur (Malaysia)" },
        { value: "Asia/Manila", label: "Asia/Manila (Philippines)" },
        { value: "Asia/Yangon", label: "Asia/Yangon (Myanmar)" },
      ],
    },
    {
      label: "East Asia",
      options: [
        { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong" },
        { value: "Asia/Shanghai", label: "Asia/Shanghai (China)" },
        { value: "Asia/Taipei", label: "Asia/Taipei (Taiwan)" },
        { value: "Asia/Tokyo", label: "Asia/Tokyo (Japan)" },
        { value: "Asia/Seoul", label: "Asia/Seoul (South Korea)" },
        { value: "Asia/Ulaanbaatar", label: "Asia/Ulaanbaatar (Mongolia)" },
      ],
    },
    {
      label: "Australia & Pacific",
      options: [
        {
          value: "Australia/Sydney",
          label: "Australia/Sydney (Eastern)",
        },
        {
          value: "Australia/Melbourne",
          label: "Australia/Melbourne (Victoria)",
        },
        {
          value: "Australia/Brisbane",
          label: "Australia/Brisbane (Queensland)",
        },
        { value: "Australia/Perth", label: "Australia/Perth (Western)" },
        { value: "Australia/Adelaide", label: "Australia/Adelaide (Central)" },
        {
          value: "Australia/Darwin",
          label: "Australia/Darwin (Northern Territory)",
        },
        { value: "Pacific/Auckland", label: "Pacific/Auckland (New Zealand)" },
        { value: "Pacific/Fiji", label: "Pacific/Fiji" },
        { value: "Pacific/Guam", label: "Pacific/Guam" },
      ],
    },
  ];

export const INVOICING_TIMEZONE_OPTIONS: InvoicingTimezoneOption[] =
  INVOICING_TIMEZONE_OPTION_GROUPS.flatMap((group) => group.options);

const TIMEZONE_LABEL_BY_VALUE = new Map<string, string>(
  INVOICING_TIMEZONE_OPTIONS.map((opt) => [opt.value, opt.label]),
);

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

/**
 * Previous calendar month is locked once company TZ has reached the 1st of the current month.
 * Keep in sync with backend/src/lib/company-timezone.ts.
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

/** Display label for a stored IANA timezone, or "Not set" when unset. */
export function formatInvoicingTimezoneLabel(
  timezone: string | null | undefined,
): string {
  const tz = timezone?.trim();
  if (!tz) return "Not set";
  return TIMEZONE_LABEL_BY_VALUE.get(tz) ?? tz;
}
