import {
  accountNeedsAutoClose,
  accountNeedsStatementWork,
} from "../../src/services/invoicing-cron-logic";

describe("invoicing-cron-logic", () => {
  it("skips auto-close before first ledger activity", () => {
    expect(accountNeedsAutoClose(false, false)).toBe(false);
  });

  it("runs auto-close when period is open and account has prior activity", () => {
    expect(accountNeedsAutoClose(false, true)).toBe(true);
  });

  it("does not re-close an already closed period", () => {
    expect(accountNeedsAutoClose(true, true)).toBe(false);
    expect(accountNeedsAutoClose(true, false)).toBe(false);
  });

  it("retries statements only when closed and unsent or failed", () => {
    expect(accountNeedsStatementWork(true, true, null)).toBe(true);
    expect(accountNeedsStatementWork(true, true, "failed")).toBe(true);
    expect(accountNeedsStatementWork(true, true, "sent")).toBe(false);
    expect(accountNeedsStatementWork(false, true, null)).toBe(false);
    expect(accountNeedsStatementWork(true, false, null)).toBe(false);
  });
});
