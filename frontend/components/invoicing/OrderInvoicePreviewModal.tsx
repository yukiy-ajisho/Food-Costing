"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import DraggableBase, { type DraggableData } from "react-draggable";
import { X } from "lucide-react";
import { buildInvoicePreviewPdf } from "@/lib/invoicingPdf";
import {
  formatInvoiceDateDisplay,
  todayLocalDateYmd,
} from "@/lib/invoicingDateTime";
import { formatCurrency } from "@/lib/invoicingCalc";
import { invoicingAPI } from "@/lib/invoicing";
import {
  buildInvoiceEmailAttachmentFilename,
  buildInvoiceEmailBodyContent,
  buildInvoiceEmailSubject,
} from "@/lib/invoiceEmailContent";
import {
  previewPayloadToOrderLines,
  uint8ArrayToBase64,
  type GeneratePreviewPayload,
} from "@/lib/invoicingPreview";

export type {
  GeneratePreviewPayload,
  GeneratePreviewRow,
} from "@/lib/invoicingPreview";

type PreviewTab = "email" | "attached";

type PreviewDraggableProps = {
  nodeRef: RefObject<HTMLDivElement | null>;
  handle: string;
  cancel: string;
  position: { x: number; y: number };
  onStop: (e: MouseEvent, data: DraggableData) => void;
  children: ReactNode;
};

const Draggable =
  DraggableBase as unknown as ComponentType<PreviewDraggableProps>;

type Props = {
  isDark: boolean;
  payload: GeneratePreviewPayload;
  onClose: () => void;
  mode?: "generate" | "orders";
  orderId?: string;
  sentAt?: string | null;
  onSaved?: (emailWarning?: string) => void;
  onSent?: () => void;
};

export function OrderInvoicePreviewModal({
  isDark,
  payload,
  onClose,
  mode = "generate",
  orderId,
  sentAt,
  onSaved,
  onSent,
}: Props) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewTab>("attached");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "save" | "save-and-send" | "send" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actionBusy = pendingAction !== null;

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const panel = isDark
    ? "bg-slate-800 text-slate-100"
    : "bg-white text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";

  const totalLabel = useMemo(
    () => formatCurrency(payload.totalAmount),
    [payload.totalAmount],
  );

  const emailSubject = useMemo(
    () => buildInvoiceEmailSubject(payload),
    [payload],
  );
  const emailBody = useMemo(
    () => buildInvoiceEmailBodyContent(payload),
    [payload],
  );
  const emailAttachmentName = useMemo(
    () => buildInvoiceEmailAttachmentFilename(payload.invoiceNumber),
    [payload.invoiceNumber],
  );

  const muted = isDark ? "text-slate-400" : "text-gray-500";

  const segmentTabs: { id: PreviewTab; label: string }[] = [
    { id: "email", label: "Email Content" },
    { id: "attached", label: "Attached Invoice" },
  ];

  const buildPdfForAction = async (forSend: boolean) => {
    const pdfPayload = forSend
      ? {
          ...payload,
          sentDateDisplay: formatInvoiceDateDisplay(todayLocalDateYmd()),
        }
      : payload;
    return buildInvoicePreviewPdf(pdfPayload);
  };

  const handleSave = async (send: boolean) => {
    setPendingAction(send ? "save-and-send" : "save");
    setActionError(null);
    try {
      const bytes = await buildPdfForAction(send);
      const pdfBase64 = uint8ArrayToBase64(bytes);
      const sentDateYmd = todayLocalDateYmd();
      const result = await invoicingAPI.createOrder({
        list_id: payload.listId,
        delivery_site_id: payload.deliverySiteId,
        order_received_date: payload.orderReceivedDate || null,
        delivery_date: payload.deliveryDate || null,
        order_created_date: payload.orderCreatedDate,
        invoice_number: payload.invoiceNumber || undefined,
        total_amount: payload.totalAmount,
        lines: previewPayloadToOrderLines(payload),
        send,
        pdf_base64: send ? pdfBase64 : undefined,
        ...(send ? { first_invoice_sent_at: sentDateYmd } : {}),
      });
      onSaved?.(result.email_error);
      onClose();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed to save order");
    } finally {
      setPendingAction(null);
    }
  };

  const handleSend = async () => {
    if (!orderId) return;
    setPendingAction("send");
    setActionError(null);
    try {
      const sentDateYmd = todayLocalDateYmd();
      const bytes = await buildPdfForAction(true);
      const pdfBase64 = uint8ArrayToBase64(bytes);
      await invoicingAPI.sendOrderInvoice(orderId, pdfBase64, sentDateYmd);
      onSent?.();
      onClose();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed to send invoice");
    } finally {
      setPendingAction(null);
    }
  };

  const sentLabel =
    sentAt != null
      ? `Sent ${formatInvoiceDateDisplay(sentAt) || sentAt}`
      : "Not sent";

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-[60] flex flex-col px-14 pt-[5.5rem] pb-5">
        <Draggable
          nodeRef={nodeRef}
          handle=".invoice-preview-drag-handle"
          cancel=".invoice-preview-no-drag, input, textarea, select, button, label, a, [role='button']"
          position={position}
          onStop={(_e: MouseEvent, data: DraggableData) =>
            setPosition({ x: data.x, y: data.y })
          }
        >
          <div
            ref={nodeRef}
            className={`pointer-events-auto mx-auto flex h-full w-full min-h-0 max-w-[94rem] flex-col overflow-hidden rounded-lg shadow-xl ${panel}`}
            role="dialog"
            aria-modal="true"
          >
            <div className={`shrink-0 border-b px-5 py-4 ${border}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-10">
                    <h2 className="invoice-preview-drag-handle cursor-move text-lg font-semibold">
                      {mode === "orders" ? "Invoice" : "Invoice Preview"}
                    </h2>
                    <div
                      role="tablist"
                      aria-label="Invoice preview sections"
                      className={`invoice-preview-no-drag inline-flex items-center gap-3 rounded-lg border p-1.5 ${
                        isDark
                          ? "border-slate-600 bg-slate-900/80"
                          : "border-gray-200 bg-gray-100"
                      }`}
                    >
                      {segmentTabs.map(({ id, label }) => {
                        const active = activeTab === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setActiveTab(id)}
                            className={`rounded-md px-5 py-1.5 text-sm font-medium transition-all ${
                              active
                                ? isDark
                                  ? "bg-slate-700 text-white shadow-sm"
                                  : "bg-white text-gray-900 shadow-sm"
                                : isDark
                                  ? "text-slate-400 hover:text-slate-200"
                                  : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p
                    className={`invoice-preview-drag-handle mt-1 cursor-move text-sm ${muted}`}
                  >
                    {payload.invoiceNumber
                      ? `Invoice # ${payload.invoiceNumber} · `
                      : ""}
                    {payload.listName} · {payload.deliverySiteName} · Total{" "}
                    {totalLabel}
                    {mode === "orders" ? ` · ${sentLabel}` : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="invoice-preview-no-drag shrink-0"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {actionError ? (
              <div className="mx-5 mt-4 shrink-0 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {actionError}
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
              {activeTab === "email" ? (
                <div
                  className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border ${border} ${
                    isDark ? "bg-slate-900" : "bg-gray-50"
                  }`}
                >
                  <div
                    className={`shrink-0 border-b px-4 py-3 text-sm ${border} ${
                      isDark ? "bg-slate-800" : "bg-white"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium uppercase tracking-wide ${muted}`}
                    >
                      Subject
                    </div>
                    <div className="mt-1 font-medium">{emailSubject}</div>
                  </div>
                  <div
                    className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed ${
                      isDark
                        ? "bg-slate-800 text-slate-100"
                        : "bg-white text-gray-900"
                    }`}
                  >
                    <p>
                      Please find attached invoice{" "}
                      <strong>{emailBody.invoiceNumber}</strong>.
                    </p>
                    <p className="mt-4">
                      Order date: {emailBody.orderCreatedDate}
                      <br />
                      Total amount: {emailBody.totalAmountLabel}
                    </p>
                    <p className="mt-4">
                      This message was sent from Food Costing.
                    </p>
                  </div>
                  <div
                    className={`shrink-0 border-t px-4 py-3 text-sm ${border} ${
                      isDark ? "bg-slate-800" : "bg-white"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium uppercase tracking-wide ${muted}`}
                    >
                      Attachment
                    </div>
                    <div className="mt-1 font-medium">
                      {emailAttachmentName}
                    </div>
                  </div>
                </div>
              ) : (
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
              )}
            </div>

            <div
              className={`invoice-preview-no-drag flex shrink-0 justify-end gap-3 border-t px-5 py-4 ${border}`}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={actionBusy}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  isDark
                    ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {mode === "orders" ? "Close" : "Cancel"}
              </button>
              {mode === "generate" ? (
                <>
                  <button
                    type="button"
                    disabled={actionBusy || !pdfBytes}
                    onClick={() => void handleSave(false)}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {pendingAction === "save" ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy || !pdfBytes}
                    onClick={() => void handleSave(true)}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {pendingAction === "save-and-send"
                      ? "Sending…"
                      : "Save and Send"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={actionBusy || !pdfBytes}
                  onClick={() => void handleSend()}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {pendingAction === "send"
                    ? "Sending…"
                    : sentAt
                      ? "Send again"
                      : "Send"}
                </button>
              )}
            </div>
          </div>
        </Draggable>
      </div>
    </>,
    document.body,
  );
}
