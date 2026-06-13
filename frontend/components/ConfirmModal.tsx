"use client";

import type { ReactNode } from "react";

type Props = {
  isDark: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  confirmingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  isDark,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  confirming = false,
  confirmingLabel = "Working…",
  onCancel,
  onConfirm,
}: Props) {
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const btnSecondary = `inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;
  const btnDanger =
    "inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className={`w-full max-w-md rounded-xl border p-6 shadow-xl ${
          isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className={`text-lg font-semibold ${textMain}`}
        >
          {title}
        </h2>
        <div className={`mt-4 text-sm ${textMain}`}>{description}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className={btnSecondary}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className={btnDanger}
          >
            {confirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
