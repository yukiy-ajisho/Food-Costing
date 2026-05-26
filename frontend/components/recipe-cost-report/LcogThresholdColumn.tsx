"use client";

import { AlertTriangle, CircleAlert } from "lucide-react";
import { HeaderHoverHint } from "./HeaderHoverHint";
import {
  formatLcogThresholdHeaderLabel,
  getLcogThresholdCellState,
  type EffectiveLcogThresholds,
  type LcogThresholdCellState,
} from "@/lib/recipeCostReportLcogThreshold";

const compactInputCls = (isDark: boolean, invalid: boolean) =>
  `h-6 w-11 rounded border px-1 text-xs tabular-nums focus:outline-none focus:ring-2 ${
    invalid
      ? "border-red-500 focus:ring-red-500/40"
      : isDark
        ? "border-slate-600 bg-slate-900 text-slate-100 focus:ring-blue-500/40"
        : "border-gray-300 bg-white text-gray-900 focus:ring-blue-500/40"
  }`;

const labelCls = (isDark: boolean) =>
  `text-[10px] font-normal leading-none ${
    isDark ? "text-slate-400" : "text-gray-500"
  }`;

/** Edit toolbar: label above a g/kg-style toggle (not a text button). */
export function LcogThresholdColumnToggle({
  isDark,
  checked,
  onChange,
}: {
  isDark: boolean;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 pb-0.5">
      <span className={labelCls(isDark)}>caution/over</span>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
          aria-label="Show caution and over column"
        />
        <div
          className={`h-4 w-8 rounded-full after:absolute after:left-px after:top-px after:h-3 after:w-3 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-4 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-300 ${
            isDark ? "bg-slate-600" : "bg-gray-300"
          }`}
        />
      </label>
    </div>
  );
}

export function LcogThresholdHeaderCell({
  isEditMode,
  isDark,
  headerTooltip,
  cautionRaw,
  overRaw,
  savedCaution,
  savedOver,
  onCautionChange,
  onOverChange,
  cautionInvalid,
  overInvalid,
}: {
  isEditMode: boolean;
  isDark: boolean;
  headerTooltip?: string;
  cautionRaw: string;
  overRaw: string;
  savedCaution: number | null;
  savedOver: number | null;
  onCautionChange: (v: string) => void;
  onOverChange: (v: string) => void;
  cautionInvalid: boolean;
  overInvalid: boolean;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center normal-case">
      {isEditMode ? (
        <div className="flex items-end justify-center gap-1.5">
          <div className="flex flex-col items-center gap-px">
            <span className={labelCls(isDark)}>caution:</span>
            <input
              type="text"
              inputMode="decimal"
              value={cautionRaw}
              onChange={(e) => onCautionChange(e.target.value)}
              className={compactInputCls(isDark, cautionInvalid)}
              aria-label="Caution threshold percent"
              aria-invalid={cautionInvalid}
            />
          </div>
          <div className="flex flex-col items-center gap-px">
            <span className={labelCls(isDark)}>over:</span>
            <input
              type="text"
              inputMode="decimal"
              value={overRaw}
              onChange={(e) => onOverChange(e.target.value)}
              className={compactInputCls(isDark, overInvalid)}
              aria-label="Over threshold percent"
              aria-invalid={overInvalid}
            />
          </div>
        </div>
      ) : headerTooltip ? (
        <HeaderHoverHint hint={headerTooltip} isDark={isDark} multiline>
          <span className="cursor-default text-xs tabular-nums tracking-normal">
            {formatLcogThresholdHeaderLabel(savedCaution, savedOver)}
          </span>
        </HeaderHoverHint>
      ) : (
        <span className="text-xs tabular-nums tracking-normal">
          {formatLcogThresholdHeaderLabel(savedCaution, savedOver)}
        </span>
      )}
    </div>
  );
}

function ThresholdIndicator({ state }: { state: LcogThresholdCellState }) {
  if (state === "dash") {
    return <span className="text-inherit">—</span>;
  }
  if (state === "yellow") {
    return (
      <AlertTriangle
        className="h-5 w-5 shrink-0 text-yellow-500"
        aria-label="LCOG at or above caution"
      />
    );
  }
  if (state === "red") {
    return (
      <CircleAlert
        className="h-5 w-5 shrink-0 text-red-500"
        aria-label="LCOG at or above over"
      />
    );
  }
  return null;
}

export function LcogThresholdDataCell({
  lcogPercent,
  thresholds,
  mutedClass,
}: {
  lcogPercent: number | null | undefined;
  thresholds: Pick<EffectiveLcogThresholds, "caution" | "over">;
  mutedClass: string;
}) {
  const state = getLcogThresholdCellState(lcogPercent, thresholds);
  return (
    <td className={`px-4 py-2 text-center ${mutedClass}`}>
      <div className="flex min-h-[1.25rem] items-center justify-center">
        <ThresholdIndicator state={state} />
      </div>
    </td>
  );
}
