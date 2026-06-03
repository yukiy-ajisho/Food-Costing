"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Printer, X } from "lucide-react";
import type { CostBreakdown, ListMemberRow } from "@/lib/recipeCostReport";
import { recipeCostReportAPI } from "@/lib/recipeCostReport";
import type { FormatCostDisplayOptions } from "@/lib/recipeCostReportCalc";
import {
  columnsFromPreset,
  countSelectedPrintColumns,
  EMPTY_PRINT_COLUMNS,
  nextAvailablePresetSlot,
  PRINT_COLUMN_KEYS,
  printColumnLabel,
  printReportTypeLabel,
  type PrintColumnSelection,
  type PrintPreset,
  type PrintReportType,
} from "@/lib/recipeCostReportPrint";
import { PrintPresetEditorModal } from "./PrintPresetEditorModal";
import { PrintPreviewTable } from "./PrintPreviewTable";

type LayoutChoice = "default" | number;

type EditorState =
  | { mode: "add"; slot: number }
  | { mode: "edit"; slot: number; preset: PrintPreset };

type Props = {
  isDark: boolean;
  reportType: PrintReportType;
  listName: string;
  members: ListMemberRow[];
  costs: Record<string, CostBreakdown>;
  costDisplayOptions: FormatCostDisplayOptions;
  onClose: () => void;
};

const PRINT_BODY_CLASS = "print-recipe-cost-report";

export function PrintModal({
  isDark,
  reportType,
  listName,
  members,
  costs,
  costDisplayOptions,
  onClose,
}: Props) {
  const [presets, setPresets] = useState<PrintPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [layoutChoice, setLayoutChoice] = useState<LayoutChoice>("default");
  const [defaultColumns, setDefaultColumns] = useState<PrintColumnSelection>({
    ...EMPTY_PRINT_COLUMNS,
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);

  const loadPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const { presets: rows } =
        await recipeCostReportAPI.listPrintPresets(reportType);
      setPresets(rows);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load print presets");
    } finally {
      setLoadingPresets(false);
    }
  }, [reportType]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    return () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
    };
  }, []);

  const selectedPreset = useMemo(
    () =>
      typeof layoutChoice === "number"
        ? presets.find((p) => p.preset_slot === layoutChoice)
        : undefined,
    [layoutChoice, presets],
  );

  const effectiveColumns = useMemo((): PrintColumnSelection => {
    if (layoutChoice === "default") return defaultColumns;
    return columnsFromPreset(selectedPreset);
  }, [layoutChoice, defaultColumns, selectedPreset]);

  const canPrint = countSelectedPrintColumns(effectiveColumns) > 0;
  const addSlot = nextAvailablePresetSlot(presets);

  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const border = isDark ? "border-slate-700" : "border-gray-200";
  const shell = isDark
    ? "bg-slate-800 border-slate-700"
    : "bg-white border-gray-200";
  const panelBg = isDark ? "bg-slate-900/40" : "bg-gray-50";
  const btnPrimary =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnSecondary = `inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;
  const addLinkCls = `inline-flex items-center gap-1 text-sm font-medium ${
    isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"
  }`;

  const handlePrint = () => {
    if (!canPrint) return;
    document.body.classList.add(PRINT_BODY_CLASS);
    const cleanup = () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
      window.removeEventListener("afterprint", cleanup);
      onClose();
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  const handleSavePreset = async (
    slot: number,
    name: string,
    columns: PrintColumnSelection,
  ) => {
    setSavingPreset(true);
    try {
      const { preset } = await recipeCostReportAPI.savePrintPreset(slot, {
        report_type: reportType,
        name,
        columns,
      });
      setPresets((prev) => {
        const rest = prev.filter((p) => p.preset_slot !== slot);
        return [...rest, preset].sort(
          (a, b) => a.preset_slot - b.preset_slot,
        );
      });
      setLayoutChoice(slot);
      setEditor(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const checkboxDisabled = layoutChoice !== "default";

  return (
    <>
      <style>{`
        @media print {
          body.${PRINT_BODY_CLASS} * {
            visibility: hidden;
          }
          body.${PRINT_BODY_CLASS} #recipe-cost-print-sheet,
          body.${PRINT_BODY_CLASS} #recipe-cost-print-sheet * {
            visibility: visible;
          }
          body.${PRINT_BODY_CLASS} #recipe-cost-print-sheet {
            position: fixed;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0;
            border: none;
            background: white;
          }
          body.${PRINT_BODY_CLASS} .print-modal-backdrop {
            position: static;
            inset: auto;
            padding: 0;
            background: transparent;
          }
          body.${PRINT_BODY_CLASS} .print-modal-shell {
            max-height: none;
            overflow: visible;
            border: none;
            box-shadow: none;
            background: transparent;
          }
          body.${PRINT_BODY_CLASS} .print-dialog-chrome {
            display: none !important;
          }
        }
      `}</style>

      <div
        className="print-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-modal-title"
      >
        <div
          className={`print-modal-shell flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-xl ${shell}`}
        >
          <div
            className={`print-dialog-chrome flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
          >
            <div>
              <h2
                id="print-modal-title"
                className={`text-lg font-semibold ${textMain}`}
              >
                Print
              </h2>
              <p className={`text-sm ${muted}`}>List: {listName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`rounded-lg p-1.5 ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
              aria-label="Close"
            >
              <X className={`h-5 w-5 ${muted}`} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              className={`print-dialog-chrome w-[17rem] shrink-0 overflow-y-auto border-r px-4 py-4 ${border} ${panelBg}`}
            >
              <p
                className={`mb-2 text-xs font-medium uppercase tracking-wide ${muted}`}
              >
                Layout
              </p>

              {loadingPresets ? (
                <div className={`flex items-center gap-2 py-2 text-sm ${muted}`}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading presets…
                </div>
              ) : (
                <fieldset className="space-y-2">
                  <label
                    className={`flex cursor-pointer items-center gap-2 text-sm ${textMain}`}
                  >
                    <input
                      type="radio"
                      name="print-layout"
                      checked={layoutChoice === "default"}
                      onChange={() => setLayoutChoice("default")}
                    />
                    Default
                  </label>
                  {presets.map((preset) => (
                    <div
                      key={preset.preset_slot}
                      className="flex items-center gap-1"
                    >
                      <label
                        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                      >
                        <input
                          type="radio"
                          name="print-layout"
                          checked={layoutChoice === preset.preset_slot}
                          onChange={() => setLayoutChoice(preset.preset_slot)}
                        />
                        <span className="truncate">{preset.name}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setEditor({
                            mode: "edit",
                            slot: preset.preset_slot,
                            preset,
                          })
                        }
                        className={`shrink-0 rounded p-1 ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-200"}`}
                        aria-label={`Edit preset ${preset.name}`}
                      >
                        <Pencil className={`h-3.5 w-3.5 ${muted}`} />
                      </button>
                    </div>
                  ))}
                </fieldset>
              )}

              {addSlot != null ? (
                <button
                  type="button"
                  onClick={() => setEditor({ mode: "add", slot: addSlot })}
                  className={`${addLinkCls} mt-4`}
                >
                  <Plus className="h-4 w-4" />
                  Add preset
                </button>
              ) : null}

              <p
                className={`mb-2 mt-5 text-xs font-medium uppercase tracking-wide ${muted}`}
              >
                Columns
              </p>
              <ul className="space-y-2">
                {PRINT_COLUMN_KEYS.map((key) => (
                  <li key={key}>
                    <label
                      className={`flex items-center gap-2 text-sm ${
                        checkboxDisabled ? "cursor-default opacity-80" : "cursor-pointer"
                      } ${textMain}`}
                    >
                      <input
                        type="checkbox"
                        checked={
                          layoutChoice === "default"
                            ? defaultColumns[key]
                            : (selectedPreset?.columns[key] ?? false)
                        }
                        disabled={checkboxDisabled}
                        onChange={(e) =>
                          setDefaultColumns((prev) => ({
                            ...prev,
                            [key]: e.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 disabled:cursor-default"
                      />
                      {printColumnLabel(key, reportType)}
                    </label>
                  </li>
                ))}
              </ul>
              {!canPrint ? (
                <p className={`mt-3 text-xs ${muted}`}>
                  Select at least one column to print.
                </p>
              ) : null}
            </div>

            <div
              className={`min-w-0 flex-1 overflow-y-auto p-4 ${isDark ? "bg-slate-800" : "bg-white"}`}
            >
              <p
                className={`print-dialog-chrome mb-3 text-xs font-medium uppercase tracking-wide ${muted}`}
              >
                Preview
              </p>
              <div
                id="recipe-cost-print-sheet"
                className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900 print:rounded-none print:border-0 print:p-0"
              >
                <PrintPreviewTable
                  listName={listName}
                  reportType={reportType}
                  members={members}
                  costs={costs}
                  columns={effectiveColumns}
                  costDisplayOptions={costDisplayOptions}
                  compact
                />
                <p className="mt-4 hidden text-xs text-gray-500 print:block">
                  {printReportTypeLabel(reportType)} · {listName} · Printed{" "}
                  {new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          <div
            className={`print-dialog-chrome flex shrink-0 justify-end gap-3 border-t px-5 py-4 ${border}`}
          >
            <button type="button" onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!canPrint}
              onClick={handlePrint}
              className={btnPrimary}
            >
              <Printer className="h-4 w-4 shrink-0" />
              Print
            </button>
          </div>
        </div>
      </div>

      {editor ? (
        <PrintPresetEditorModal
          isDark={isDark}
          title={editor.mode === "add" ? "Add preset" : "Edit preset"}
          reportType={reportType}
          initialName={
            editor.mode === "edit"
              ? editor.preset.name
              : `Preset ${editor.slot}`
          }
          initialColumns={
            editor.mode === "edit"
              ? editor.preset.columns
              : { ...EMPTY_PRINT_COLUMNS }
          }
          saving={savingPreset}
          onCancel={() => setEditor(null)}
          onSave={(name, columns) =>
            void handleSavePreset(editor.slot, name, columns)
          }
        />
      ) : null}
    </>
  );
}
