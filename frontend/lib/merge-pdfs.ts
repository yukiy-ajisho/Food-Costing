import { PDFDocument } from "pdf-lib";

/**
 * Merge multiple PDF files in order into one PDF (browser).
 * Used for invoice extract (single model input) and final Import upload.
 */
export async function mergePdfFiles(files: File[]): Promise<File> {
  if (files.length === 0) {
    throw new Error("No PDF files to merge");
  }
  if (files.length === 1) {
    return files[0];
  }
  const merged = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = doc.getPageIndices();
    const copied = await merged.copyPages(doc, indices);
    for (const page of copied) {
      merged.addPage(page);
    }
  }
  const out = await merged.save();
  const base =
    files[0]?.name.replace(/\.pdf$/i, "") || "invoice";
  const bytes = Uint8Array.from(out);
  return new File([bytes], `${base}-merged.pdf`, {
    type: "application/pdf",
  });
}
