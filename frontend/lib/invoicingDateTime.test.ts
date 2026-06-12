import {
  formatInvoiceDateDisplay,
  invoiceDateCalendarYmd,
  todayLocalDateYmd,
} from "./invoicingDateTime";

describe("invoicingDateTime", () => {
  it("returns today as YYYY-MM-DD", () => {
    expect(todayLocalDateYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats date strings for display", () => {
    expect(formatInvoiceDateDisplay("2026-05-31")).toBe("2026-05-31");
    expect(formatInvoiceDateDisplay("2026-05-31T14:30:00.000Z")).toBe(
      "2026-05-31",
    );
  });

  it("normalizes calendar ymd for filters", () => {
    expect(invoiceDateCalendarYmd("2026-05-31")).toBe("2026-05-31");
  });
});
