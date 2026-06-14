import { PDFDocument } from "pdf-lib";
import { buildInvoicePreviewPdf } from "./invoicingPdf";
import type { GeneratePreviewPayload } from "./invoicingPreview";

function samplePayload(rowCount: number): GeneratePreviewPayload {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    itemId: `item-${index}`,
    name: `Product ${index + 1}`,
    unitSize: 100,
    unitSizeUnit: "g",
    units: 1,
    costPerKg: 10,
    subTotal: 1,
  }));

  return {
    listId: "list-1",
    deliverySiteId: "site-1",
    listName: "Weekly",
    deliverySiteName: "Main Kitchen",
    invoiceNumber: "INV-001",
    orderReceivedDate: "2026-05-01",
    deliveryDate: "2026-05-02",
    orderCreatedDate: "2026-05-01",
    sentDateDisplay: "May 1, 2026",
    rows,
    totalAmount: rowCount,
  };
}

describe("buildInvoicePreviewPdf", () => {
  it("keeps a single page for a short invoice", async () => {
    const bytes = await buildInvoicePreviewPdf(samplePayload(5));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("adds continuation pages when line items exceed one page", async () => {
    const bytes = await buildInvoicePreviewPdf(samplePayload(60));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("includes every line item across pages", async () => {
    const payload = samplePayload(75);
    const bytes = await buildInvoicePreviewPdf(payload);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(payload.rows).toHaveLength(75);
  });
});
