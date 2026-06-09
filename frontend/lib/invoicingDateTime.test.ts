import {
  formatInvoiceDateTimeAmPm,
  formatInvoiceDateTimeDisplay,
  localDateTimeInputToIso,
  localDateYmdFromInput,
  parseLocalDateTimeInput,
} from "./invoicingDateTime";

describe("invoicingDateTime", () => {
  it("formats datetime-local for display", () => {
    expect(formatInvoiceDateTimeDisplay("2026-05-31T14:30")).toBe(
      "2026-05-31 14:30",
    );
  });

  it("extracts calendar ymd from datetime-local", () => {
    expect(localDateYmdFromInput("2026-05-31T14:30")).toBe("2026-05-31");
  });

  it("converts datetime-local to ISO UTC", () => {
    const iso = localDateTimeInputToIso("2026-05-31T14:30");
    expect(iso).toBeTruthy();
    const roundTrip = parseLocalDateTimeInput("2026-05-31T14:30");
    expect(roundTrip?.toISOString()).toBe(iso);
  });

  it("formats AM/PM display without comma", () => {
    const formatted = formatInvoiceDateTimeAmPm("2026-05-31T14:30");
    expect(formatted).not.toContain(",");
    expect(formatted).toMatch(/PM|AM/);
  });
});
