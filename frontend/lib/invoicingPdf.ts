import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { GeneratePreviewPayload } from "@/lib/invoicingPreview";

export async function buildInvoicePreviewPdf(
  payload: GeneratePreviewPayload,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  const left = 50;

  const draw = (text: string, bold = false, size = 11) => {
    page.drawText(text, {
      x: left,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0, 0, 0),
    });
    y -= size + 6;
  };

  draw("INVOICE", true, 18);
  y -= 4;
  draw(`Delivery Site: ${payload.deliverySiteName}`);
  if (payload.orderReceivedDate) {
    draw(`Order Received: ${payload.orderReceivedDate}`);
  }
  if (payload.deliveryDate) {
    draw(`Delivery Date: ${payload.deliveryDate}`);
  }
  draw(`Invoice Date: ${payload.invoiceDate}`, true);
  y -= 8;

  const colName = left;
  const colUnit = 220;
  const colUnits = 320;
  const colCost = 380;
  const colSub = 470;

  page.drawText("Name", { x: colName, y, size: 10, font: fontBold });
  page.drawText("Unit Size", { x: colUnit, y, size: 10, font: fontBold });
  page.drawText("Units", { x: colUnits, y, size: 10, font: fontBold });
  page.drawText("Cost", { x: colCost, y, size: 10, font: fontBold });
  page.drawText("Sub total", { x: colSub, y, size: 10, font: fontBold });
  y -= 16;

  for (const row of payload.rows) {
    if (y < 80) break;
    const unitLabel = `${row.unitSize} ${row.unitSizeUnit}`;
    page.drawText(row.name.slice(0, 28), {
      x: colName,
      y,
      size: 10,
      font,
    });
    page.drawText(unitLabel, { x: colUnit, y, size: 10, font });
    page.drawText(String(row.units), { x: colUnits, y, size: 10, font });
    page.drawText(`$${row.costPerKg.toFixed(2)}/kg`, {
      x: colCost,
      y,
      size: 10,
      font,
    });
    page.drawText(`$${row.subTotal.toFixed(2)}`, {
      x: colSub,
      y,
      size: 10,
      font,
    });
    y -= 14;
  }

  y -= 8;
  draw(`Total: $${payload.totalAmount.toFixed(2)}`, true, 12);

  return doc.save();
}
