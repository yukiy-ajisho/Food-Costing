import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type MonthlyStatementPdfInput = {
  accountCompanyName: string;
  period: string;
  periodLabel: string;
  closingBalance: number;
  sellerCompanyName?: string;
};

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export async function buildMonthlyStatementPdf(
  input: MonthlyStatementPdfInput,
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

  draw("MONTHLY STATEMENT", true, 18);
  y -= 4;
  if (input.sellerCompanyName) {
    draw(`From: ${input.sellerCompanyName}`);
  }
  draw(`Account: ${input.accountCompanyName}`, true);
  draw(`Period: ${input.periodLabel} (${input.period})`);
  y -= 8;
  draw("Closing balance:", true);
  draw(formatMoney(input.closingBalance), true, 16);
  y -= 12;
  draw("This statement reflects the accounts receivable balance");
  draw("at the end of the period shown above.");
  draw("Sent from Food Costing.");

  return doc.save();
}
