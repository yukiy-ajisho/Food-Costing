"use client";

import { CornerUpLeft, Loader2, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { LaborRole, RecipeSummaryTechnicalSheetLaborRow } from "@/lib/api";
import {
  effectiveLaborChoice,
  formatLaborCost,
  formatLaborMinutes,
  formatLaborWage,
  laborRoleForDisplay,
  resolveEditMinutesRadios,
  showLaborMinutesVersionSplit,
  type LaborUpdateDiffType,
  type LaborUpdateRowChoices,
  type LaborUpdateRowMeta,
} from "@/lib/technicalSheetLaborUpdateDisplay";
import type { PuChoice } from "@/lib/technicalSheetUpdateDisplay";
import {
  formatDualHourlyWage,
  formatDualPtDollars,
  formatDualTotalCostLines,
} from "@/lib/technicalSheetFormat";

export type LaborDraftRow = RecipeSummaryTechnicalSheetLaborRow & {
  isNew?: boolean;
};

function UpdateTripleHeader({
  title,
  isDark,
  showFinalColumn = true,
}: {
  title: string;
  isDark: boolean;
  showFinalColumn?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b px-2 py-1 font-semibold">{title}</div>
      <div
        className={`grid ${showFinalColumn ? "grid-cols-3" : "grid-cols-2"} text-[10px] font-medium ${isDark ? "text-slate-300" : "text-gray-600"}`}
      >
        <div className="border-r px-1 py-1">This version</div>
        <div className={`px-1 py-1 ${showFinalColumn ? "border-r" : ""}`}>
          Current
        </div>
        {showFinalColumn ? <div className="px-1 py-1">Final</div> : null}
      </div>
    </div>
  );
}

function VersionTripleCell({
  rowKey,
  radioGroup,
  isDark,
  showSplit,
  showFinalColumn = true,
  showRadios,
  effectiveChoice,
  onChoiceChange,
  sheetContent,
  liveContent,
  mergedContent,
  finalContent,
}: {
  rowKey: string;
  radioGroup: string;
  isDark: boolean;
  showSplit: boolean;
  showFinalColumn?: boolean;
  showRadios: boolean;
  effectiveChoice: PuChoice;
  onChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  sheetContent: ReactNode;
  liveContent: ReactNode;
  mergedContent: ReactNode;
  finalContent: ReactNode;
}) {
  const cellClass = `flex items-center justify-end gap-0.5 border-r px-1 py-1 ${
    isDark ? "text-slate-200" : "text-gray-800"
  }`;
  const radioName = `labor-choice-${radioGroup}-${rowKey}`;
  const mergedCellClass = `flex items-center justify-center px-1 py-1 ${
    isDark ? "text-slate-200" : "text-gray-800"
  }`;
  const gridCols = showFinalColumn ? "grid-cols-3" : "grid-cols-2";
  const liveCellClass = showFinalColumn
    ? cellClass
    : `${cellClass.replace(" border-r", "")} px-1 py-1`;

  return (
    <div className={`grid ${gridCols} text-right`}>
      {showSplit ? (
        <>
          <div className={cellClass}>
            {showRadios ? (
              <input
                type="radio"
                name={radioName}
                checked={effectiveChoice === "sheet"}
                onChange={() => onChoiceChange?.(rowKey, "sheet")}
                className="h-3 w-3 shrink-0"
              />
            ) : null}
            <span>{sheetContent}</span>
          </div>
          <div className={liveCellClass}>
            {showRadios ? (
              <input
                type="radio"
                name={radioName}
                checked={effectiveChoice === "live"}
                onChange={() => onChoiceChange?.(rowKey, "live")}
                className="h-3 w-3 shrink-0"
              />
            ) : null}
            <span>{liveContent}</span>
          </div>
          {showFinalColumn ? (
            <div className="px-1 py-1 text-right">{finalContent}</div>
          ) : null}
        </>
      ) : showFinalColumn ? (
        <>
          <div className={`col-span-2 border-r ${mergedCellClass}`}>
            <span>{mergedContent}</span>
          </div>
          <div className="px-1 py-1 text-right">{finalContent}</div>
        </>
      ) : (
        <div className={`col-span-2 ${mergedCellClass}`}>
          <span>{mergedContent}</span>
        </div>
      )}
    </div>
  );
}

function technicalSheetTableHeaderClass(isDark: boolean): string {
  return isDark ? "bg-slate-950 text-slate-200" : "bg-gray-300 text-gray-900";
}

function technicalSheetTableBodyRowClass(isDark: boolean): string {
  return isDark ? "bg-slate-900 text-slate-200" : "bg-white text-gray-900";
}

function technicalSheetPanelBackgroundClass(isDark: boolean): string {
  return isDark ? "bg-slate-800" : "bg-gray-50";
}

function technicalSheetActionColumnCellClass(isDark: boolean): string {
  return `w-8 border-0 p-0 pl-1 align-middle text-center ${technicalSheetPanelBackgroundClass(isDark)}`;
}

function laborRowClass(diffType: LaborUpdateDiffType, isDark: boolean): string {
  if (diffType === "added") return isDark ? "bg-green-950/40" : "bg-green-50";
  if (diffType === "removed") return isDark ? "bg-red-950/40" : "bg-red-50";
  if (diffType === "changed") {
    return isDark ? "bg-amber-950/40" : "bg-amber-50";
  }
  return technicalSheetTableBodyRowClass(isDark);
}

function laborRowClassForDisplay(
  diffType: LaborUpdateDiffType,
  isDark: boolean,
  rowKey: string,
  restoredRemovedKeys?: ReadonlySet<string>,
): string {
  if (
    diffType === "removed" &&
    restoredRemovedKeys &&
    !restoredRemovedKeys.has(rowKey)
  ) {
    return isDark ? "bg-red-950/40" : "bg-red-50";
  }
  return laborRowClass(
    diffType === "removed" ? "unchanged" : diffType,
    isDark,
  );
}

function isRemovedLaborPendingRestore(
  diffType: LaborUpdateDiffType | undefined,
  rowKey: string,
  restoredRemovedKeys?: ReadonlySet<string>,
): boolean {
  return (
    diffType === "removed" &&
    !!restoredRemovedKeys &&
    !restoredRemovedKeys.has(rowKey)
  );
}

function RoleEditor({
  value,
  laborRoles,
  isDark,
  compact,
  onChange,
}: {
  value: string;
  laborRoles: LaborRole[];
  isDark: boolean;
  compact?: boolean;
  onChange: (role: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${compact ? "max-w-[7rem]" : "w-full"} rounded border px-1 py-0.5 text-xs ${
        isDark
          ? "border-slate-600 bg-slate-900 text-slate-100"
          : "border-gray-300 bg-white text-gray-900"
      }`}
    >
      <option value="">Select role...</option>
      {laborRoles.map((role) => (
        <option key={role.id} value={role.name}>
          {role.name}
        </option>
      ))}
    </select>
  );
}

function MinutesEditor({
  minutes,
  isDark,
  compact,
  onChange,
}: {
  minutes: number;
  isDark: boolean;
  compact?: boolean;
  onChange: (minutes: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={minutes > 0 ? minutes : ""}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={`${compact ? "w-14" : "w-16"} rounded border px-1 py-0.5 text-right text-xs ${
        isDark
          ? "border-slate-600 bg-slate-900 text-slate-100"
          : "border-gray-300 bg-white text-gray-900"
      }`}
    />
  );
}

export function StandardTechnicalSheetLaborTable({
  rows,
  isDark,
  editable,
  laborRoles,
  updateMode,
  updateEditMode,
  updateMetaByRowKey,
  pairedRemovedKeys,
  restoredRemovedKeys,
  onRestoreRemoved,
  updateRowChoices,
  onMinutesChoiceChange,
  onRoleChange,
  onMinutesChange,
  onRemoveRow,
  onAddLaborRow,
  priceMode = "latest",
  snapshotCostByRowKey,
  priceLoading,
}: {
  rows: LaborDraftRow[];
  isDark: boolean;
  editable?: boolean;
  laborRoles: LaborRole[];
  updateMode?: boolean;
  updateEditMode?: boolean;
  updateMetaByRowKey?: Map<string, LaborUpdateRowMeta>;
  pairedRemovedKeys?: Set<string>;
  restoredRemovedKeys?: Set<string>;
  onRestoreRemoved?: (rowKey: string) => void;
  updateRowChoices?: Map<string, LaborUpdateRowChoices>;
  onMinutesChoiceChange?: (rowKey: string, choice: PuChoice) => void;
  onRoleChange?: (rowKey: string, role: string) => void;
  onMinutesChange?: (rowKey: string, minutes: number) => void;
  onRemoveRow?: (rowKey: string) => void;
  onAddLaborRow?: () => void;
  priceMode?: "latest" | "snapshot" | "both";
  snapshotCostByRowKey?: Map<
    string,
    { hourly_wage: number | null; cost: number | null }
  >;
  priceLoading?: boolean;
}) {
  const showBothPrices = priceMode === "both" && snapshotCostByRowKey != null;
  const showUpdateTriple =
    updateMode && updateMetaByRowKey && updateRowChoices;
  const showFinalColumn = !!updateEditMode;
  const updateCompareMinW = showFinalColumn ? "min-w-[220px]" : "min-w-[160px]";
  const showActionColumn =
    (!!editable && !!onRemoveRow) || (!!showUpdateTriple && !!onRestoreRemoved);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className={technicalSheetTableHeaderClass(isDark)}>
              <th className="border px-2 py-1 text-left min-w-[120px]">Role</th>
              <th
                className={
                  showUpdateTriple
                    ? `border px-0 py-0 text-center align-bottom ${updateCompareMinW}`
                    : "border px-2 py-1 text-right min-w-[100px]"
                }
              >
                {showUpdateTriple ? (
                  <UpdateTripleHeader
                    title="Minutes"
                    isDark={isDark}
                    showFinalColumn={showFinalColumn}
                  />
                ) : (
                  "Minutes"
                )}
              </th>
              <th className="border px-2 py-1 text-right">Hourly Wage</th>
              <th className="border px-2 py-1 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowKey = row.row_key;
              const meta = updateMetaByRowKey?.get(rowKey);
              const diffType = meta?.diffType ?? "unchanged";
              const storedChoices = updateRowChoices?.get(rowKey);
              const effectiveMinutesChoice = effectiveLaborChoice(
                diffType,
                storedChoices?.minutes,
              );
              const showMinutesSplit = meta
                ? showLaborMinutesVersionSplit(diffType, meta)
                : false;
              const minutesRadioResolve =
                updateEditMode &&
                meta &&
                showLaborMinutesVersionSplit(diffType, meta)
                  ? resolveEditMinutesRadios(
                      meta,
                      diffType,
                      row.minutes,
                      storedChoices?.minutes,
                    )
                  : null;
              const showMinutesRadios =
                !!onMinutesChoiceChange && !!minutesRadioResolve?.showRadios;
              const minutesChoiceForRadios = minutesRadioResolve?.showRadios
                ? minutesRadioResolve.displayChoice
                : effectiveMinutesChoice;
              const useUpdateTriple =
                !!showUpdateTriple &&
                (meta != null || (updateEditMode && editable && row.isNew));
              const isRemovedPendingRestore = isRemovedLaborPendingRestore(
                diffType,
                rowKey,
                restoredRemovedKeys,
              );
              const canRestoreRemoved =
                !!onRestoreRemoved &&
                meta != null &&
                isRemovedPendingRestore &&
                (pairedRemovedKeys == null || !pairedRemovedKeys.has(rowKey));

              const displayRole =
                meta != null ? laborRoleForDisplay(meta) : row.labor_role;
              const finalMinutes =
                meta != null
                  ? effectiveMinutesChoice === "live"
                    ? meta.liveMinutes
                    : meta.sheetMinutes
                  : row.minutes;

              const showMinutesFinalEdit =
                updateEditMode &&
                editable &&
                onMinutesChange &&
                !isRemovedPendingRestore;

              const showRoleEdit =
                editable && onRoleChange && !isRemovedPendingRestore;

              const roleDisplay = displayRole?.trim() || "—";
              const minutesDisplay = formatLaborMinutes(finalMinutes);
              const wageDisplay = formatLaborWage(row.hourly_wage);
              const costDisplay = formatLaborCost(row.cost);

              const minutesFinalContent = showMinutesFinalEdit ? (
                <MinutesEditor
                  minutes={row.minutes}
                  isDark={isDark}
                  compact
                  onChange={(m) => onMinutesChange!(rowKey, m)}
                />
              ) : (
                <span className="text-xs">{minutesDisplay}</span>
              );

              const rowBgClass = showUpdateTriple
                ? laborRowClassForDisplay(
                    diffType,
                    isDark,
                    rowKey,
                    restoredRemovedKeys,
                  )
                : technicalSheetTableBodyRowClass(isDark);

              return (
                <tr
                  key={rowKey}
                  className={isDark ? "text-slate-200" : "text-gray-900"}
                >
                  <td className={`border px-2 py-1 align-top ${rowBgClass}`}>
                    {showRoleEdit ? (
                      <RoleEditor
                        value={row.labor_role}
                        laborRoles={laborRoles}
                        isDark={isDark}
                        onChange={(r) => onRoleChange!(rowKey, r)}
                      />
                    ) : (
                      <span className="text-xs">{roleDisplay}</span>
                    )}
                  </td>
                  <td
                    className={
                      useUpdateTriple
                        ? `border px-0 py-0 align-middle ${rowBgClass}`
                        : `border px-2 py-1 text-right ${rowBgClass}`
                    }
                  >
                    {useUpdateTriple ? (
                      <VersionTripleCell
                        rowKey={rowKey}
                        radioGroup="minutes"
                        isDark={isDark}
                        showSplit={showMinutesSplit}
                        showFinalColumn={showFinalColumn}
                        showRadios={showMinutesRadios}
                        effectiveChoice={minutesChoiceForRadios}
                        onChoiceChange={onMinutesChoiceChange}
                        sheetContent={
                          <span className="text-xs">
                            {formatLaborMinutes(meta?.sheetMinutes)}
                          </span>
                        }
                        liveContent={
                          <span className="text-xs">
                            {formatLaborMinutes(meta?.liveMinutes)}
                          </span>
                        }
                        mergedContent={
                          <span className="text-xs">{minutesDisplay}</span>
                        }
                        finalContent={minutesFinalContent}
                      />
                    ) : editable && onMinutesChange && !isRemovedPendingRestore ? (
                      <MinutesEditor
                        minutes={row.minutes}
                        isDark={isDark}
                        onChange={(m) => onMinutesChange(rowKey, m)}
                      />
                    ) : (
                      <span className="text-xs">{minutesDisplay}</span>
                    )}
                  </td>
                  <td className={`border px-2 py-1 text-right ${rowBgClass}`}>
                    {priceLoading ? (
                      <Loader2 className="inline h-3 w-3 animate-spin" />
                    ) : showBothPrices ? (
                      formatDualHourlyWage(
                        snapshotCostByRowKey.get(rowKey)?.hourly_wage,
                        row.hourly_wage,
                      )
                    ) : (
                      wageDisplay
                    )}
                  </td>
                  <td className={`border px-2 py-1 text-right ${rowBgClass}`}>
                    {priceLoading ? (
                      <Loader2 className="inline h-3 w-3 animate-spin" />
                    ) : showBothPrices ? (
                      formatDualPtDollars(
                        snapshotCostByRowKey.get(rowKey)?.cost,
                        row.cost,
                      )
                    ) : (
                      costDisplay
                    )}
                  </td>
                  {showActionColumn ? (
                    <td className={technicalSheetActionColumnCellClass(isDark)}>
                      {canRestoreRemoved ? (
                        <button
                          type="button"
                          onClick={() => onRestoreRemoved!(rowKey)}
                          className={
                            isDark
                              ? "text-blue-400 hover:text-blue-300"
                              : "text-blue-600 hover:text-blue-700"
                          }
                          title="Restore labor"
                          aria-label="Restore labor"
                        >
                          <CornerUpLeft className="mx-auto h-4 w-4" />
                        </button>
                      ) : editable && onRemoveRow ? (
                        <button
                          type="button"
                          onClick={() => onRemoveRow(rowKey)}
                          className="text-red-500 hover:text-red-600"
                          title="Remove row"
                          aria-label="Remove row"
                        >
                          <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && onAddLaborRow ? (
        <button
          type="button"
          onClick={onAddLaborRow}
          className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
            isDark
              ? "text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
              : "text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">Add labor</span>
        </button>
      ) : null}
    </div>
  );
}

export function formatLaborDualWageLines(
  snapshotWage: number | null | undefined,
  currentWage: number | null | undefined,
): { snapshotLine: string; currentLine: string } {
  const snap =
    snapshotWage != null && Number.isFinite(snapshotWage)
      ? `$${snapshotWage.toFixed(2)}/hr`
      : "—";
  const cur =
    currentWage != null && Number.isFinite(currentWage)
      ? `$${currentWage.toFixed(2)}/hr`
      : "—";
  return { snapshotLine: `(${snap})`, currentLine: cur };
}

export { formatDualTotalCostLines };
