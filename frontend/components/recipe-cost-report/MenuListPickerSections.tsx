"use client";

import type { CSSProperties, ReactNode } from "react";

type Props = {
  directCount: number;
  franchiseCount: number;
  mutedClass: string;
  renderDirectRows: () => ReactNode;
  renderFranchiseRows: () => ReactNode;
};

const scrollListStyle: CSSProperties = { scrollbarGutter: "stable" };

function SectionBlock({
  title,
  mutedClass,
  listClassName,
  listStyle,
  children,
}: {
  title: string;
  mutedClass: string;
  listClassName: string;
  listStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <>
      <p
        className={`shrink-0 px-1 pb-1.5 text-xs font-medium uppercase tracking-wide ${mutedClass}`}
      >
        {title}
      </p>
      <ul className={listClassName} style={listStyle}>
        {children}
      </ul>
    </>
  );
}

/**
 * 50/50 line rule (CSS-driven, parent height H is fixed via flex-1 min-h-0):
 * - Direct zone: natural height when small; max 50% of H; scroll inside when over.
 * - Franchise zone: flex-1 uses all space Direct did not use (may borrow Direct's unused half).
 * - Direct never grows into Franchise's reserved bottom half when it overflows (max-h-[50%]).
 */
export function MenuListPickerSections({
  directCount,
  franchiseCount,
  mutedClass,
  renderDirectRows,
  renderFranchiseRows,
}: Props) {
  const showDirect = directCount > 0;
  const showFranchise = franchiseCount > 0;

  if (!showDirect && !showFranchise) {
    return (
      <ul
        className="min-h-0 flex-1 overflow-y-auto p-2"
        style={scrollListStyle}
      >
        <li className={`px-3 py-8 text-center text-sm ${mutedClass}`}>
          No lists yet
        </li>
      </ul>
    );
  }

  if (!showDirect || !showFranchise) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <SectionBlock
          title={showDirect ? "Direct" : "Franchise"}
          mutedClass={mutedClass}
          listClassName="min-h-0 flex-1 overflow-y-auto space-y-0.5"
          listStyle={scrollListStyle}
        >
          {showDirect ? renderDirectRows() : renderFranchiseRows()}
        </SectionBlock>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-2">
      <div className="flex min-h-0 max-h-[50%] shrink-0 flex-col overflow-hidden">
        <SectionBlock
          title="Direct"
          mutedClass={mutedClass}
          listClassName="min-h-0 flex-1 overflow-y-auto space-y-0.5"
          listStyle={scrollListStyle}
        >
          {renderDirectRows()}
        </SectionBlock>
      </div>

      {/* Franchise: everything below Direct (uses Direct's unused top-half space) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SectionBlock
          title="Franchise"
          mutedClass={mutedClass}
          listClassName="min-h-0 flex-1 overflow-y-auto space-y-0.5"
          listStyle={scrollListStyle}
        >
          {renderFranchiseRows()}
        </SectionBlock>
      </div>
    </div>
  );
}
