import {
  buildRunningBalanceLedger,
  dateToPeriod,
  paymentEffectiveDate,
  periodEndDate,
  type ClosingBalanceRow,
} from "../../src/services/invoicing-ledger";

describe("invoicing-ledger", () => {
  it("derives period from date", () => {
    expect(dateToPeriod("2026-03-15")).toBe("2026-03");
  });

  it("computes period end date", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
  });

  it("uses payment_date when present", () => {
    expect(
      paymentEffectiveDate("2026-03-10", "2026-03-01T12:00:00Z"),
    ).toBe("2026-03-10");
    expect(
      paymentEffectiveDate(null, "2026-03-01T12:00:00Z"),
    ).toBe("2026-03-01");
  });

  it("builds running balance from closing snapshot and events", () => {
    const closing: ClosingBalanceRow = {
      id: "close-1",
      company_id: "c1",
      account_id: "a1",
      period: "2026-02",
      closing_balance: 8000,
      closed_at: "2026-02-28T23:59:59Z",
      created_by: null,
    };

    const rows = buildRunningBalanceLedger(closing, [
      {
        id: "o1",
        date: "2026-03-03",
        delta: 1200,
        type: "order",
        sortKey: "order:1:o1",
      },
      {
        id: "p1",
        date: "2026-03-08",
        delta: -2000,
        type: "payment",
        sortKey: "payment:1:p1",
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0].type).toBe("closing_balance");
    expect(rows[0].running_balance).toBe(8000);
    expect(rows[1].running_balance).toBe(9200);
    expect(rows[2].running_balance).toBe(7200);
  });

  it("excludes events on or before closed period end", () => {
    const closing: ClosingBalanceRow = {
      id: "close-1",
      company_id: "c1",
      account_id: "a1",
      period: "2026-02",
      closing_balance: 8000,
      closed_at: "2026-02-28T23:59:59Z",
      created_by: null,
    };

    const rows = buildRunningBalanceLedger(closing, [
      {
        id: "o-old",
        date: "2026-02-28",
        delta: 500,
        type: "order",
        sortKey: "order:0:o-old",
      },
      {
        id: "o-new",
        date: "2026-03-01",
        delta: 200,
        type: "order",
        sortKey: "order:1:o-new",
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1].id).toBe("o-new");
    expect(rows[1].running_balance).toBe(8200);
  });
});
