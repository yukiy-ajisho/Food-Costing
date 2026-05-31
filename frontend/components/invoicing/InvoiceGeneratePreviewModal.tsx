"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { buildInvoicePreviewPdf } from "@/lib/invoicingPdf";
import { formatCurrency } from "@/lib/invoicingCalc";
import { invoicingAPI } from "@/lib/invoicing";
import {
  previewPayloadToBoxLines,
  uint8ArrayToBase64,
  type GeneratePreviewPayload,
} from "@/lib/invoicingPreview";

export type { GeneratePreviewPayload, GeneratePreviewRow } from "@/lib/invoicingPreview";

type Props = {
  isDark: boolean;
  payload: GeneratePreviewPayload;
  onClose: () => void;
  mode?: "generate" | "box";
  invoiceId?: string;
  sentAt?: string | null;
  onSaved?: (emailWarning?: string) => void;
  onSent?: () => void;
};

export function InvoiceGeneratePreviewModal({
  isDark,
  payload,
  onClose,
  mode = "generate",
  invoiceId,
  sentAt,
  onSaved,
  onSent,
}: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void buildInvoicePreviewPdf(payload)
      .then((bytes) => {
        if (cancelled) return;
        setPdfBytes(bytes);
        const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPdfError(e instanceof Error ? e.message : "Failed to build PDF");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [payload]);

  const panel = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";

  const totalLabel = useMemo(
    () => formatCurrency(payload.totalAmount),
    [payload.totalAmount],
  );

  const handleSave = async (send: boolean) => {
    if (!pdfBytes) return;
    setSaving(true);
    setActionError(null);
    try {
      const pdfBase64 = uint8ArrayToBase64(pdfBytes);
      const result = await invoicingAPI.createBoxInvoice({
        list_id: payload.listId,
        delivery_site_id: payload.deliverySiteId,
        order_received_date: payload.orderReceivedDate || null,
        delivery_date: payload.deliveryDate || null,
        invoice_date: payload.invoiceDate,
        total_amount: payload.totalAmount,
        lines: previewPayloadToBoxLines(payload),
        send,
        pdf_base64: send ? pdfBase64 : undefined,
      });
      onSaved?.(result.email_error);
      onClose();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed to save invoice");
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!pdfBytes || !invoiceId) return;
    setSaving(true);
    setActionError(null);
    try {
      const pdfBase64 = uint8ArrayToBase64(pdfBytes);
      await invoicingAPI.sendBoxInvoice(invoiceId, pdfBase64);
      onSent?.();
      onClose();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed to send invoice");
    } finally {
      setSaving(false);
    }
  };

  const sentLabel =
    sentAt != null
      ? `Sent ${new Date(sentAt).toLocaleString()}`
      : "Not sent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-1.5 sm:p-2">
      <div
        className={`flex h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg shadow-xl sm:h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-1.5rem)] sm:max-h-[calc(100vh-1.5rem)] sm:max-w-[calc(100vw-1.5rem)] ${panel}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <div>
            <h2 className="text-lg font-semibold">
              {mode === "box" ? "Invoice" : "Invoice preview"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {payload.listName} · {payload.deliverySiteName} · Total{" "}
              {totalLabel}
              {mode === "box" ? ` · ${sentLabel}` : null}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {actionError ? (
          <div className="mx-5 mt-4 shrink-0 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {actionError}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-slate-600 dark:bg-slate-900">
            {pdfError ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-600">
                {pdfError}
              </div>
            ) : pdfUrl ? (
              <iframe
                title="Invoice PDF preview"
                src={pdfUrl}
                className="h-full min-h-0 w-full flex-1 border-0"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
                Building PDF…
              </div>
            )}
          </div>
        </div>

        <div
          className={`flex shrink-0 justify-end gap-3 border-t px-5 py-4 ${border}`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              isDark
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {mode === "box" ? "Close" : "Cancel"}
          </button>
          {mode === "generate" ? (
            <>
              <button
                type="button"
                disabled={saving || !pdfBytes}
                onClick={() => void handleSave(false)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving || !pdfBytes}
                onClick={() => void handleSave(true)}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Sending…" : "Save and Send"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={saving || !pdfBytes}
              onClick={() => void handleSend()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Sending…" : sentAt ? "Send again" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
