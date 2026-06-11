import {
  allocateInvoiceNumber,
  formatInvoiceDateYyyymmdd,
} from "../../src/lib/invoicing-calc";

describe("invoicing-calc invoice numbers", () => {
  it("formats calendar date as YYYYMMDD", () => {
    expect(formatInvoiceDateYyyymmdd("2026-05-31")).toBe("20260531");
  });

  it("allocates first number of the day", async () => {
    const num = await allocateInvoiceNumber(
      "tenant-1",
      "2026-05-31",
      async () => [],
    );
    expect(num).toBe("20260531-0001");
  });

  it("increments suffix for same calendar date", async () => {
    const num = await allocateInvoiceNumber(
      "tenant-1",
      "2026-05-31",
      async () => ["20260531-0001", "20260531-0002"],
    );
    expect(num).toBe("20260531-0003");
  });

  it("ignores legacy delivery-site style numbers", async () => {
    const num = await allocateInvoiceNumber(
      "tenant-1",
      "2026-05-31",
      async () => ["MainKitchen250531", "MainKitchen250531-2"],
    );
    expect(num).toBe("20260531-0001");
  });
});
