import type { BoxInvoiceSummary } from "@/lib/invoicing";
import {
  EMPTY_INVOICE_BOX_FILTERS,
  filterInvoiceBoxRows,
  nextInvoiceBoxSortState,
  sentCalendarDate,
  sortInvoiceBoxRows,
} from "./invoiceBoxTable";

function row(
  partial: Partial<BoxInvoiceSummary> & Pick<BoxInvoiceSummary, "id" | "invoice_number">,
): BoxInvoiceSummary {
  return {
    invoice_date: "2025-06-01",
    company_name: "Acme",
    total_amount: 100,
    delivery_site_name: "Site A",
    sent_at: "2025-06-02T10:00:00.000Z",
    ...partial,
  };
}

const SAMPLE: BoxInvoiceSummary[] = [
  row({
    id: "1",
    invoice_number: "INV-001",
    invoice_date: "2025-06-01",
    company_name: "Acme",
    total_amount: 100,
    delivery_site_name: "Site A",
    sent_at: "2025-06-02T10:00:00.000Z",
  }),
  row({
    id: "2",
    invoice_number: "INV-002",
    invoice_date: "2025-06-15",
    company_name: "Beta",
    total_amount: 250,
    delivery_site_name: "Site B",
    sent_at: null,
  }),
  row({
    id: "3",
    invoice_number: "INV-003",
    invoice_date: "2025-07-01",
    company_name: "Acme",
    total_amount: 50,
    delivery_site_name: "Site A",
    sent_at: "2025-06-20T08:00:00.000Z",
  }),
];

describe("invoiceBoxTable filters", () => {
  it("returns all rows when filters are empty", () => {
    expect(filterInvoiceBoxRows(SAMPLE, EMPTY_INVOICE_BOX_FILTERS)).toHaveLength(3);
  });

  it("filters invoice date min only (>=)", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      dateMin: "2025-06-15",
    });
    expect(filtered.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("filters invoice date max only (<=)", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      dateMax: "2025-06-15",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("filters invoice date range inclusive", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      dateMin: "2025-06-01",
      dateMax: "2025-06-15",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("filters amount min and max", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      amountMin: "100",
      amountMax: "200",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1"]);
  });

  it("filters company name (single select)", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      companyName: "Acme",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("filters delivery site (single select)", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      deliverySite: "Site B",
    });
    expect(filtered.map((r) => r.id)).toEqual(["2"]);
  });

  it("excludes unsent rows when sent filter is active", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      sentMin: "2025-06-01",
    });
    expect(filtered.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("combines range and select filters with AND", () => {
    const filtered = filterInvoiceBoxRows(SAMPLE, {
      ...EMPTY_INVOICE_BOX_FILTERS,
      companyName: "Acme",
      amountMax: "75",
    });
    expect(filtered.map((r) => r.id)).toEqual(["3"]);
  });
});

describe("invoiceBoxTable sort", () => {
  it("sorts by amount ascending", () => {
    const sorted = sortInvoiceBoxRows(SAMPLE, {
      key: "amount",
      ascending: true,
    });
    expect(sorted.map((r) => r.id)).toEqual(["3", "1", "2"]);
  });

  it("sorts by date descending", () => {
    const sorted = sortInvoiceBoxRows(SAMPLE, {
      key: "date",
      ascending: false,
    });
    expect(sorted.map((r) => r.id)).toEqual(["3", "2", "1"]);
  });

  it("toggles ascending when same column clicked again", () => {
    expect(
      nextInvoiceBoxSortState({ key: "date", ascending: true }, "date"),
    ).toEqual({ key: "date", ascending: false });
    expect(
      nextInvoiceBoxSortState({ key: "date", ascending: false }, "amount"),
    ).toEqual({ key: "amount", ascending: true });
  });
});

describe("sentCalendarDate", () => {
  it("returns null for missing sent_at", () => {
    expect(sentCalendarDate(null)).toBeNull();
  });

  it("uses local calendar date", () => {
    const local = sentCalendarDate("2025-06-02T02:30:00.000Z");
    const expected = (() => {
      const d = new Date("2025-06-02T02:30:00.000Z");
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    expect(local).toBe(expected);
  });
});
