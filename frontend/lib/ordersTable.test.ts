import type { OrderSummary } from "@/lib/invoicing";
import {
  EMPTY_ORDERS_FILTERS,
  filterOrdersRows,
  nextOrdersSortState,
  sentCalendarDate,
  sortOrdersRows,
} from "./ordersTable";

const SAMPLE: OrderSummary[] = [
  {
    id: "1",
    invoice_number: "20250601-0001",
    order_created_date: "2025-06-01",
    company_name: "Alpha Co",
    total_amount: 100,
    delivery_site_name: "Site A",
    first_invoice_sent_at: "2025-06-02",
  },
  {
    id: "2",
    invoice_number: "20250601-0002",
    order_created_date: "2025-06-01",
    company_name: "Beta Co",
    total_amount: 200,
    delivery_site_name: "Site B",
    first_invoice_sent_at: "2025-06-02",
  },
  {
    id: "3",
    invoice_number: "20250615-0001",
    order_created_date: "2025-06-15",
    company_name: "Alpha Co",
    total_amount: 50,
    delivery_site_name: "Site A",
    first_invoice_sent_at: null,
  },
  {
    id: "4",
    invoice_number: "20250701-0001",
    order_created_date: "2025-07-01",
    company_name: "Gamma Co",
    total_amount: 300,
    delivery_site_name: "Site C",
    first_invoice_sent_at: "2025-06-20",
  },
];

describe("ordersTable", () => {
  it("returns all rows when filters empty", () => {
    expect(filterOrdersRows(SAMPLE, EMPTY_ORDERS_FILTERS)).toHaveLength(4);
  });

  it("filters by date range", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      dateMin: "2025-06-01",
      dateMax: "2025-06-15",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("filters by company name", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      companyName: "Alpha Co",
    });
    expect(filtered).toHaveLength(2);
  });

  it("filters by amount range", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      amountMin: "100",
      amountMax: "200",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("filters by delivery site", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      deliverySite: "Site A",
    });
    expect(filtered).toHaveLength(2);
  });

  it("filters by sent date range", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      sentMin: "2025-06-02",
      sentMax: "2025-06-02",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("excludes unsent when sent filter active", () => {
    const filtered = filterOrdersRows(SAMPLE, {
      ...EMPTY_ORDERS_FILTERS,
      sentMin: "2025-06-01",
    });
    expect(filtered.some((r) => r.id === "3")).toBe(false);
  });

  it("sorts by date descending", () => {
    const sorted = sortOrdersRows(SAMPLE, {
      key: "date",
      ascending: false,
    });
    expect(sorted[0].id).toBe("4");
  });

  it("sorts by amount ascending", () => {
    const sorted = sortOrdersRows(SAMPLE, {
      key: "amount",
      ascending: true,
    });
    expect(sorted[0].total_amount).toBe(50);
  });

  it("toggles sort direction on same column", () => {
    expect(
      nextOrdersSortState({ key: "date", ascending: true }, "date"),
    ).toEqual({ key: "date", ascending: false });
    expect(
      nextOrdersSortState({ key: "date", ascending: false }, "amount"),
    ).toEqual({ key: "amount", ascending: true });
  });

  it("returns null for missing first_invoice_sent_at", () => {
    expect(sentCalendarDate(null)).toBeNull();
  });
});
