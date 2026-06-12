import {
  buildClosedPeriodSet,
  formatLedgerAmount,
  isOrderLocked,
  isPaymentLocked,
  ledgerTypeLabel,
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
    expect(formatLedgerAmount("closing_balance", null, fmt)).toBe("—");
  });

  it("labels closing balance type", () => {
    expect(ledgerTypeLabel("closing_balance")).toBe("closing balance");
  });

  it("detects locked payment using payment_date fallback", () => {
    const closed = buildClosedPeriodSet([
      { account_id: "a1", period: "2026-02" },
    ]);
    expect(
      isPaymentLocked(
        {
          account_id: "a1",
          payment_date: null,
          created_at: "2026-02-15T10:00:00Z",
        },
        closed,
      ),
    ).toBe(true);
  });
});
