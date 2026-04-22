"use client";

import { useState } from "react";
import { ocrTestAPI } from "@/lib/api";

export default function OcrTestPage() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [modelText, setModelText] = useState("");
  const [structured, setStructured] = useState<unknown>(null);

  const onExtract = async () => {
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }
    setLoading(true);
    setError(null);
    setRawText("");
    setModelText("");
    setStructured(null);

    try {
      const result = await ocrTestAPI.extractPdf(file);
      setRawText(result.raw_text || "");
      setModelText(result.model_text || "");
      setStructured(result.structured_json ?? null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">OCR Test (PDF + Gemini Flash)</h1>
        <p className="text-gray-600">
          Experimental playground for Gemini + PDF in this app. Production invoice
          import uses the same <code className="text-sm">/ocr-test/extract</code>{" "}
          pipeline from Vendor Items → Import invoice.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Open OCR Modal
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-lg bg-white shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Invoice OCR Test</h2>
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                  }}
                />
                <button
                  onClick={onExtract}
                  disabled={loading}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "Extracting..." : "Extract"}
                </button>
              </div>

              {error && (
                <div className="rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded p-3">
                  <h3 className="font-medium mb-2">OCR Text</h3>
                  <pre className="text-xs whitespace-pre-wrap break-words max-h-96 overflow-auto">
                    {rawText || "(empty)"}
                  </pre>
                </div>
                <div className="border rounded p-3">
                  <h3 className="font-medium mb-2">Structured JSON</h3>
                  <pre className="text-xs whitespace-pre-wrap break-words max-h-96 overflow-auto">
                    {structured ? JSON.stringify(structured, null, 2) : "null"}
                  </pre>
                </div>
              </div>

              <div className="border rounded p-3">
                <h3 className="font-medium mb-2">Raw Model Output (Debug)</h3>
                <pre className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">
                  {modelText || "(empty)"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
