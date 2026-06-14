import { PDFDocument, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { GeneratePreviewPayload } from "@/lib/invoicingPreview";

const PAGE_SIZE: [number, number] = [612, 792];
const LEFT = 50;
const TOP_Y = 740;
const MIN_ROW_Y = 72;
const MIN_TOTAL_Y = 48;
const ROW_STEP = 14;

const COL = {
  name: LEFT,
  unit: 220,
  units: 320,
  cost: 380,
  sub: 470,
} as const;

export async function buildInvoicePreviewPdf(
  payload: GeneratePreviewPayload,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(PAGE_SIZE);
  let y = TOP_Y;

  const drawText = (
    text: string,
    x: number,
    options?: { bold?: boolean; size?: number },
  ) => {
    const size = options?.size ?? 10;
    page.drawText(text, {
      x,
      y,
      size,
      font: options?.bold ? fontBold : font,
      color: rgb(0, 0, 0),
    });
  };

  const drawLine = (text: string, bold = false, size = 11) => {
    drawText(text, LEFT, { bold, size });
    y -= size + 6;
  };

  const drawTableHeader = () => {
    drawText("Name", COL.name, { bold: true });
    drawText("Unit Size", COL.unit, { bold: true });
    drawText("Units", COL.units, { bold: true });
    drawText("Cost", COL.cost, { bold: true });
    drawText("Sub total", COL.sub, { bold: true });
    y -= 16;
  };

  const startContinuationPage = () => {
    page = doc.addPage(PAGE_SIZE);
    y = TOP_Y;
    drawTableHeader();
  };

  const ensureRowSpace = () => {
    if (y < MIN_ROW_Y) {
      startContinuationPage();
    }
  };

  const ensureTotalSpace = () => {
    if (y < MIN_TOTAL_Y) {
      startContinuationPage();
    }
  };

  drawLine("INVOICE", true, 18);
  y -= 4;
  if (payload.invoiceNumber) {
    drawLine(`Invoice #: ${payload.invoiceNumber}`, true);
  }
  drawLine(`Delivery Site: ${payload.deliverySiteName}`);
  if (payload.orderReceivedDate) {
    drawLine(`Order Received: ${payload.orderReceivedDate}`);
  }
  if (payload.deliveryDate) {
    drawLine(`Delivery Date: ${payload.deliveryDate}`);
  }
  drawLine(`Sent Date: ${payload.sentDateDisplay || "—"}`);
  y -= 8;

  drawTableHeader();

  for (const row of payload.rows) {
    ensureRowSpace();
    const unitLabel = `${row.unitSize} ${row.unitSizeUnit}`;
    drawText(row.name.slice(0, 28), COL.name);
    drawText(unitLabel, COL.unit);
    drawText(String(row.units), COL.units);
    drawText(`$${row.costPerKg.toFixed(2)}/kg`, COL.cost);
    drawText(`$${row.subTotal.toFixed(2)}`, COL.sub);
    y -= ROW_STEP;
  }

  ensureTotalSpace();
  y -= 8;
  drawLine(`Total: $${payload.totalAmount.toFixed(2)}`, true, 12);

  return doc.save();
}
