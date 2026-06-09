"use client";

import type { ListPriceInputMode } from "@/lib/recipeCostReportCalc";

type PricingInputModeCellProps = {
  groupName: string;
  mode: ListPriceInputMode;
  priceLabel: "Wholesale" | "Retail";
  isDark: boolean;
  disabled?: boolean;
  onChange: (mode: ListPriceInputMode) => void;
};

export function PricingInputModeCell({
  groupName,
  mode,
  priceLabel,
  isDark,
  disabled = false,
  onChange,
}: PricingInputModeCellProps) {
  const labelCls = `text-[10px] leading-tight ${
    isDark ? "text-slate-400" : "text-gray-500"
  }`;
  const radioCls = disabled ? "opacity-50" : "";

  return (
    <div
      className={`flex flex-col gap-1.5 ${radioCls}`}
      role="radiogroup"
      aria-label={`${priceLabel} or LCOG% input mode`}
    >
      <label className={`flex cursor-pointer items-start gap-1 ${labelCls}`}>
        <input
          type="radio"
          name={groupName}
          className="mt-0.5 shrink-0"
          checked={mode === "price"}
          disabled={disabled}
          onChange={() => onChange("price")}
        />
        <span>
          {priceLabel} → LCOG%
        </span>
      </label>
      <label className={`flex cursor-pointer items-start gap-1 ${labelCls}`}>
        <input
          type="radio"
          name={groupName}
          className="mt-0.5 shrink-0"
          checked={mode === "lcog"}
          disabled={disabled}
          onChange={() => onChange("lcog")}
        />
        <span>
          LCOG% → {priceLabel}
        </span>
      </label>
    </div>
  );
}
