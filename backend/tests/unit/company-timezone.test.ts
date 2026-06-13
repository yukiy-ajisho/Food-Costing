import {
  currentCalendarPeriodInTz,
  formatYmdInTimeZone,
  isPeriodCalendarLocked,
  previousMonthPeriodInTz,
  shiftPeriod,
} from "../../src/lib/company-timezone";

const LA = "America/Los_Angeles";

describe("company-timezone", () => {
  it("formats calendar date in company timezone", () => {
    // 2026-03-01 07:59 UTC = still 2026-02-28 23:59 in LA (PST)
    const lateFebLa = new Date("2026-03-01T07:59:00Z");
    expect(formatYmdInTimeZone(lateFebLa, LA)).toBe("2026-02-28");
    expect(currentCalendarPeriodInTz(LA, lateFebLa)).toBe("2026-02");
  });

  it("returns previous month period in company timezone", () => {
    const marchLa = new Date("2026-03-01T10:00:00Z");
    expect(previousMonthPeriodInTz(LA, marchLa)).toBe("2026-02");
  });

  it("locks previous month once company TZ reaches the 1st", () => {
    const march1La = new Date("2026-03-01T10:00:00Z");
    expect(isPeriodCalendarLocked("2026-02", LA, march1La)).toBe(true);
    expect(isPeriodCalendarLocked("2026-01", LA, march1La)).toBe(false);
    expect(isPeriodCalendarLocked("2026-03", LA, march1La)).toBe(false);
  });

  it("does not lock previous month on last day of prior month in company TZ", () => {
    const feb28La = new Date("2026-03-01T07:59:00Z");
    expect(formatYmdInTimeZone(feb28La, LA)).toBe("2026-02-28");
    expect(isPeriodCalendarLocked("2026-02", LA, feb28La)).toBe(false);
  });

  it("shifts periods across year boundaries", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2025-12", 1)).toBe("2026-01");
  });
});
