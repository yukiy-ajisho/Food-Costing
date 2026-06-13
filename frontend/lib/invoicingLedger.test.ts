import {
  buildClosedPeriodSet,
  deleteBalanceImpactMessage,
  formatAdjustmentAmount,
  formatLedgerAmount,
  formatOrderAmount,
  formatPaymentReceived,
  isOrderLocked,
  isPaymentLocked,
  isAccountDateOpenForNewEntry,
  ledgerEntryAffectsCurrentBalance,
  ledgerTypeLabel,
  periodEndDate,
} from "./invoicingLedger";

describe("invoicingLedger", () => {
  it("detects locked order in closed period", () => {
    const closed = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-03" },
    ]);
    expect(
      isOrderLocked(
        { account_id: "a1", order_created_date: "2026-03-10" },
        closed,
      ),
    ).toBe(true);
    expect(
      isOrderLocked(
        { account_id: "a1", order_created_date: "2026-04-01" },
        closed,
      ),
    ).toBe(false);
  });

  it("formats ledger amounts with sign prefix only", () => {
    const fmt = (value: number) => `$${value.toFixed(2)}`;
    expect(formatLedgerAmount("order", 1200, fmt)).toBe("+$1200.00");
    expect(formatLedgerAmount("payment", 200, fmt)).toBe("−$200.00");
    expect(formatLedgerAmount("adjustment", 100, fmt, "increase")).toBe(
      "+$100.00",
    );
    expect(formatLedgerAmount("closing_balance", null, fmt)).toBe("—");
  });

  it("splits balance ledger amounts into dedicated columns", () => {
    const fmt = (value: number) => `$${value.toFixed(2)}`;
    expect(formatOrderAmount("order", 1200, fmt)).toBe("+$1200.00");
    expect(formatOrderAmount("payment", 200, fmt)).toBe("—");
    expect(formatOrderAmount("adjustment", 100, fmt)).toBe("—");
    expect(formatPaymentReceived("payment", 200, fmt)).toBe("−$200.00");
    expect(formatPaymentReceived("order", 1200, fmt)).toBe("—");
    expect(formatPaymentReceived("adjustment", 50, fmt)).toBe("—");
    expect(formatAdjustmentAmount("adjustment", 100, fmt, "increase")).toBe(
      "+$100.00",
    );
    expect(formatAdjustmentAmount("adjustment", 50, fmt, "decrease")).toBe(
      "−$50.00",
    );
    expect(formatAdjustmentAmount("payment", 200, fmt)).toBe("—");
    expect(formatAdjustmentAmount("order", 1200, fmt)).toBe("—");
  });

  it("labels closing balance type", () => {
    expect(ledgerTypeLabel("closing_balance")).toBe("closing balance");
  });

  it("detects locked payment by payment_date", () => {
    const closed = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-02" },
    ]);
    expect(
      isPaymentLocked(
        {
          account_id: "a1",
          payment_date: "2026-02-15",
        },
        closed,
      ),
    ).toBe(true);
    expect(
      isPaymentLocked(
        {
          account_id: "a1",
          payment_date: "2026-03-01",
        },
        closed,
      ),
    ).toBe(false);
  });

  it("computes period end dates", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
  });

  it("detects whether deleting a ledger entry affects current balance", () => {
    const closed = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-02" },
      { account_id: "a1", period: "2026-03" },
    ]);
    expect(
      ledgerEntryAffectsCurrentBalance("2026-03-31", closed, "a1"),
    ).toBe(false);
    expect(
      ledgerEntryAffectsCurrentBalance("2026-04-01", closed, "a1"),
    ).toBe(true);
    expect(ledgerEntryAffectsCurrentBalance("2026-04-01", new Map(), "a1")).toBe(
      true,
    );
  });

  it("formats delete balance impact copy", () => {
    expect(deleteBalanceImpactMessage(true)).toBe(
      "The current balance will be updated.",
    );
    expect(deleteBalanceImpactMessage(false)).toBe(
      "This won't change the current balance.",
    );
  });

  it("blocks new entries on or before the latest closed month", () => {
    const closed = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-05" },
      { account_id: "a1", period: "2026-07" },
    ]);
    expect(
      isAccountDateOpenForNewEntry("2026-07-31", closed, "a1", "America/New_York"),
    ).toBe(false);
    expect(
      isAccountDateOpenForNewEntry("2026-06-15", closed, "a1", "America/New_York"),
    ).toBe(false);
    expect(
      isAccountDateOpenForNewEntry("2026-08-01", closed, "a1", "America/New_York"),
    ).toBe(true);
    const mayOnly = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-05" },
    ]);
    expect(
      isAccountDateOpenForNewEntry("2026-05-31", mayOnly, "a1", "America/New_York"),
    ).toBe(false);
    expect(
      isAccountDateOpenForNewEntry("2026-06-01", mayOnly, "a1", "America/New_York"),
    ).toBe(true);
  });
});
