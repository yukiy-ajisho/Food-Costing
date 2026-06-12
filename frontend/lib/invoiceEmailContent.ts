import type { GeneratePreviewPayload } from "@/lib/invoicingPreview";

export function buildInvoiceEmailSubject(payload: {
  invoiceNumber: string;
  deliverySiteName: string;
}): string {
  return `Invoice ${payload.invoiceNumber} for ${payload.deliverySiteName}`;
}

export function buildInvoiceEmailAttachmentFilename(invoiceNumber: string): string {
  return `${invoiceNumber}.pdf`;
}

/** Matches `sendInvoiceEmail` HTML in backend/src/services/email.ts */
export function formatInvoiceEmailTotalAmount(totalAmount: number): string {
  return `$${totalAmount.toFixed(2)}`;
}

export type InvoiceEmailBodyContent = {
  invoiceNumber: string;
  orderCreatedDate: string;
  totalAmountLabel: string;
};

export function buildInvoiceEmailBodyContent(
  payload: Pick<
    GeneratePreviewPayload,
    "invoiceNumber" | "orderCreatedDate" | "totalAmount"
  >,
): InvoiceEmailBodyContent {
  return {
    invoiceNumber: payload.invoiceNumber,
    orderCreatedDate: payload.orderCreatedDate,
    totalAmountLabel: formatInvoiceEmailTotalAmount(payload.totalAmount),
  };
}
