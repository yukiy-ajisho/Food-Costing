"use client";

import type { CostBasis } from "@/lib/recipeCostReport";

type Props = {
  groupName: string;
  basis: CostBasis;
  wholesaleSelectable: boolean;
  disabled?: boolean;
  textMain: string;
  onCorporate: () => void;
  onWholesale: () => void;
};

export function CostBasisRadios({
  groupName,
  basis,
  wholesaleSelectable,
  disabled = false,
  textMain,
  onCorporate,
  onWholesale,
}: Props) {
  return (
    <fieldset
      className="inline-flex items-center gap-2 border-0 p-0 m-0 text-xs"
      disabled={disabled}
    >
      <legend className="sr-only">Cost basis</legend>
      <label className={`flex items-center gap-1 ${textMain}`}>
        <input
          type="radio"
          name={groupName}
          checked={basis === "corporate"}
          disabled={disabled}
          onChange={onCorporate}
          className="h-3.5 w-3.5"
        />
        Corporate
      </label>
      <label
        className={`flex items-center gap-1 ${textMain} ${
          !wholesaleSelectable ? "opacity-50" : ""
        }`}
      >
        <input
          type="radio"
          name={groupName}
          checked={basis === "wholesale"}
          disabled={disabled || !wholesaleSelectable}
          onChange={onWholesale}
          className="h-3.5 w-3.5 disabled:cursor-not-allowed"
        />
        Wholesale
      </label>
    </fieldset>
  );
}
