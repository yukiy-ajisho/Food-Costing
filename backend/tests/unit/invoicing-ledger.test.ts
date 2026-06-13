import {
  buildRunningBalanceLedger,
  computeCurrentBalanceFromEvents,
  dateToPeriod,
  paymentEffectiveDate,
  paymentLedgerDelta,
  periodEndDate,
  type ClosingBalanceRow,
} from "../../src/services/invoicing-ledger";

describe("invoicing-ledger", () => {
  it("computes signed payment ledger delta", () => {
    expect(paymentLedgerDelta("payment", 100, null)).toBe(-100);
    expect(paymentLedgerDelta("adjustment", 50, "decrease")).toBe(-50);
    expect(paymentLedgerDelta("adjustment", 50, "increase")).toBe(50);
  });

  it("derives period from date", () => {
    expect(dateToPeriod("2026-03-15")).toBe("2026-03");
  });

  it("computes period end date", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
  });

  it("uses payment_date for ledger period", () => {
    expect(paymentEffectiveDate("2026-03-10")).toBe("2026-03-10");
    expect(paymentEffectiveDate(" 2026-02-28 ")).toBe("2026-02-28");
  });

  it("anchors post-close running balance to closing snapshot", () => {
    const closing: ClosingBalanceRow = {
      id: "close-1",
      company_id: "c1",
      account_id: "a1",
      period: "2026-02",
      closing_balance: 8000,
      closed_at: "2026-02-28T23:59:59Z",
      created_by: null,
    };

    const events = [
      {
        id: "o1",
        date: "2026-03-03",
        delta: 1200,
        type: "order" as const,
        sortKey: "order:1:o1",
      },
      {
        id: "p1",
        date: "2026-03-08",
        delta: -2000,
        type: "payment" as const,
        sortKey: "payment:1:p1",
      },
    ];

    const rows = buildRunningBalanceLedger(closing, events);

    expect(rows).toHaveLength(2);
    expect(rows[0].running_balance).toBe(9200);
    expect(rows[1].running_balance).toBe(7200);
    expect(computeCurrentBalanceFromEvents(closing, events)).toBe(7200);
  });

  it("keeps closed-period events visible with historical running balance", () => {
    const closing: ClosingBalanceRow = {
      id: "close-1",
      company_id: "c1",
      account_id: "a1",
      period: "2026-02",
      closing_balance: 8000,
      closed_at: "2026-02-28T23:59:59Z",
      created_by: null,
    };

    const events = [
      {
        id: "o-old",
        date: "2026-02-28",
        delta: 500,
        type: "order" as const,
        sortKey: "order:0:o-old",
      },
      {
        id: "o-new",
        date: "2026-03-01",
        delta: 200,
        type: "order" as const,
        sortKey: "order:1:o-new",
      },
    ];

    const rows = buildRunningBalanceLedger(closing, events);

    expect(rows).toHaveLength(2);
    expect(rows[0].running_balance).toBe(500);
    expect(rows[1].running_balance).toBe(8200);
    expect(computeCurrentBalanceFromEvents(closing, events)).toBe(8200);
  });

  it("uses edited closing snapshot for post-close activity", () => {
    const closing: ClosingBalanceRow = {
      id: "close-1",
      company_id: "c1",
      account_id: "a1",
      period: "2026-06",
      closing_balance: 1000,
      closed_at: "2026-06-13T05:14:30Z",
      created_by: null,
    };

    const events = [
      {
        id: "o1",
        date: "2026-06-01",
        delta: 10.42,
        type: "order" as const,
        sortKey: "order:1:o1",
      },
      {
        id: "p1",
        date: "2026-10-21",
        delta: -1000,
        type: "payment" as const,
        sortKey: "payment:1:p1",
      },
    ];

    const rows = buildRunningBalanceLedger(closing, events);

    expect(rows[0].running_balance).toBe(10.42);
    expect(rows[1].running_balance).toBe(0);
    expect(computeCurrentBalanceFromEvents(closing, events)).toBe(0);
  });
});
