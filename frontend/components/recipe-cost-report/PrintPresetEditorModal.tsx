"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  countSelectedPrintColumns,
  EMPTY_PRINT_COLUMNS,
  PRINT_COLUMN_KEYS,
  printColumnLabel,
  type PrintColumnSelection,
  type PrintReportType,
} from "@/lib/recipeCostReportPrint";

type Props = {
  isDark: boolean;
  title: string;
  reportType: PrintReportType;
  initialName: string;
  initialColumns: PrintColumnSelection;
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string, columns: PrintColumnSelection) => void;
};

export function PrintPresetEditorModal({
  isDark,
  title,
  reportType,
  initialName,
  initialColumns,
  saving,
  onCancel,
  onSave,
}: Props) {
  const [name, setName] = useState(initialName);
  const [columns, setColumns] = useState<PrintColumnSelection>({
    ...initialColumns,
  });

  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const border = isDark ? "border-slate-700" : "border-gray-200";
  const shell = isDark
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-gray-200";
  const inputCls = `h-10 w-full rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;
  const btnPrimary =
    "inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const selectedCount = countSelectedPrintColumns(columns);
  const canSave = name.trim().length > 0 && selectedCount > 0 && !saving;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-preset-editor-title"
    >
      <div
        className={`flex w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-xl ${shell}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2
            id="print-preset-editor-title"
            className={`text-lg font-semibold ${textMain}`}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-lg p-1.5 ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
            aria-label="Cancel and go back"
          >
            <X className={`h-5 w-5 ${muted}`} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label
              htmlFor="preset-name"
              className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
            >
              Preset name
            </label>
            <input
              id="preset-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>

          <div>
            <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${muted}`}>
              Columns
            </p>
            <ul className="space-y-2">
              {PRINT_COLUMN_KEYS.map((key) => (
                <li key={key}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 text-sm ${textMain}`}
                  >
                    <input
                      type="checkbox"
                      checked={columns[key]}
                      onChange={(e) =>
                        setColumns((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {printColumnLabel(key, reportType)}
                  </label>
                </li>
              ))}
            </ul>
            {selectedCount === 0 ? (
              <p className={`mt-2 text-xs ${muted}`}>
                Select at least one column to save.
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={`flex shrink-0 justify-end border-t px-5 py-4 ${border}`}
        >
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave(name.trim(), columns)}
            className={btnPrimary}
          >
            {saving ? "Saving…" : "Save preset"}
          </button>
        </div>
      </div>
    </div>
  );
}
