import {
  buildInvoiceEmailAttachmentFilename,
  buildInvoiceEmailBodyContent,
  buildInvoiceEmailSubject,
  formatInvoiceEmailTotalAmount,
} from "./invoiceEmailContent";

describe("invoiceEmailContent", () => {
  it("builds subject like backend sendInvoiceEmail", () => {
    expect(
      buildInvoiceEmailSubject({
        invoiceNumber: "INV-001",
        deliverySiteName: "Cupertino",
      }),
    ).toBe("Invoice INV-001 for Cupertino");
  });

  it("builds attachment filename", () => {
    expect(buildInvoiceEmailAttachmentFilename("INV-001")).toBe("INV-001.pdf");
  });

  it("formats total amount like backend", () => {
    expect(formatInvoiceEmailTotalAmount(1234.5)).toBe("$1234.50");
  });

  it("builds body content fields", () => {
    expect(
      buildInvoiceEmailBodyContent({
        invoiceNumber: "INV-001",
        orderCreatedDate: "2026-05-31",
        totalAmount: 99,
      }),
    ).toEqual({
      invoiceNumber: "INV-001",
      orderCreatedDate: "2026-05-31",
      totalAmountLabel: "$99.00",
    });
  });
});
