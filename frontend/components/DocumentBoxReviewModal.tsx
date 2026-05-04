"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  documentInboxAPI,
  DOCUMENT_INBOX_TYPE_VALUES,
  type DocumentBoxRow,
  type DocumentInboxDocumentType,
} from "@/lib/api/document-inbox";

type InboxRow = Extract<DocumentBoxRow, { kind: "inbox" }>;

const TYPE_LABELS: Record<DocumentInboxDocumentType, string> = {
  invoice: "invoice",
  company_requirement: "company_requirement",
  tenant_requirement: "tenant_requirement",
  employee_requirement: "employee_requirement",
};

interface DocumentBoxReviewModalProps {
  open: boolean;
  onClose: () => void;
  row: InboxRow | null;
  onStartInvoiceImport: (row: InboxRow) => void;
  onRemoved: () => void;
}

export function DocumentBoxReviewModal({
  open,
  onClose,
  row,
  onStartInvoiceImport,
  onRemoved,
}: DocumentBoxReviewModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [docType, setDocType] = useState<DocumentInboxDocumentType | "">("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [classifyBusy, setClassifyBusy] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  const border = isDark ? "border-slate-600" : "border-gray-200";
  const shell = isDark
    ? "bg-slate-800 border-slate-600 text-slate-100"
    : "bg-white border-gray-200 text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";

  useEffect(() => {
    if (!open || !row) {
      setPreviewUrl(null);
      setDocType("");
      setClassifyError(null);
      return;
    }
    setDocType((row.document_type as DocumentInboxDocumentType) ?? "");
    setClassifyError(null);
    let cancelled = false;
    setLoadingUrl(true);
    void (async () => {
      try {
        const { url } = await documentInboxAPI.getDocumentUrl(row.value);
        if (!cancelled) setPreviewUrl(url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      } finally {
        if (!cancelled) setLoadingUrl(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row]);

  const onSelectType = useCallback(
    async (next: DocumentInboxDocumentType) => {
      if (!row) return;
      setClassifyError(null);
      setDocType(next);
      if (next === "invoice") {
        return;
      }
      setClassifyBusy(true);
      try {
        await documentInboxAPI.classify(row.id, next);
      } catch (e) {
        setClassifyError(
          e instanceof Error ? e.message : "Failed to save classification",
        );
      } finally {
        setClassifyBusy(false);
      }
    },
    [row],
  );

  const onRemove = useCallback(async () => {
    if (!row || removeBusy) return;
    const ok = window.confirm(
      `Remove "${row.file_name}" permanently from Uploaded Document Box?`,
    );
    if (!ok) return;

    setClassifyError(null);
    setRemoveBusy(true);
    try {
      await documentInboxAPI.remove(row.id);
      onRemoved();
      onClose();
    } catch (e) {
      setClassifyError(e instanceof Error ? e.message : "Failed to remove file");
    } finally {
      setRemoveBusy(false);
    }
  }, [row, removeBusy, onRemoved, onClose]);

  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`flex max-h-[92vh] w-full max-w-[min(100vw-2rem,1200px)] flex-col rounded-xl border shadow-xl ${shell}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2 className="text-lg font-semibold">Review</h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5 md:flex-row">
          <div
            className={`flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-lg border md:min-h-[480px] ${border}`}
          >
            {loadingUrl ? (
              <div
                className={`flex flex-1 items-center justify-center ${muted}`}
              >
                Loading preview…
              </div>
            ) : previewUrl ? (
              <iframe
                title="Document preview"
                src={previewUrl}
                className="h-full min-h-[280px] w-full flex-1 border-0 md:min-h-0"
              />
            ) : (
              <div
                className={`flex flex-1 items-center justify-center ${muted}`}
              >
                Preview unavailable
              </div>
            )}
          </div>

          <div className="flex w-full shrink-0 flex-col gap-4 md:w-72">
            <p className={`text-sm ${muted}`}>{row.file_name}</p>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Document type
              </legend>
              {DOCUMENT_INBOX_TYPE_VALUES.map((v) => (
                <label
                  key={v}
                  className={`flex cursor-pointer items-center gap-2 text-sm ${
                    classifyBusy && v !== "invoice" ? "opacity-60" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="document_type"
                    checked={docType === v}
                    disabled={classifyBusy && v !== "invoice"}
                    onChange={() => void onSelectType(v)}
                    className="shrink-0"
                  />
                  <span>{TYPE_LABELS[v]}</span>
                </label>
              ))}
            </fieldset>

            {classifyError ? (
              <p className="text-sm text-red-500">{classifyError}</p>
            ) : null}

            {docType === "invoice" ? (
              <button
                type="button"
                disabled={classifyBusy || removeBusy}
                onClick={() => onStartInvoiceImport(row)}
                className={`mt-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                  isDark
                    ? "bg-blue-700 hover:bg-blue-600"
                    : "bg-blue-600 hover:bg-blue-700"
                } disabled:opacity-50`}
              >
                Import invoice
              </button>
            ) : docType ? (
              <p className={`text-sm ${muted}`}>
                Attach this file from the corresponding requirements screen
                (company / tenant / employee). Inbox will clear when linking is
                implemented.
              </p>
            ) : null}

          </div>
        </div>

        <div
          className={`flex shrink-0 justify-end border-t px-5 py-3 ${border}`}
        >
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={classifyBusy || removeBusy}
            className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
              isDark ? "bg-red-700 hover:bg-red-600" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {removeBusy ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
