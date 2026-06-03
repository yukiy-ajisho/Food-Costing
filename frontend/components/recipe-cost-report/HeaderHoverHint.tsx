"use client";

import { getBodyCssZoom } from "@/lib/bodyCssZoom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const TOOLTIP_Z = 200;
const GAP_PX = 4;
const SAFE_PX = 8;

function tooltipSurfaceClass(isDark: boolean, multiline: boolean) {
  return `rounded-md border px-2 py-1 text-xs normal-case font-normal tracking-normal shadow-md backdrop-blur-sm ${
    multiline
      ? "max-w-[18rem] min-w-[13rem] whitespace-pre-line text-left"
      : "whitespace-nowrap"
  } ${
    isDark
      ? "border-slate-600/80 bg-slate-800/90 text-slate-200"
      : "border-gray-200/80 bg-white/95 text-gray-700"
  }`;
}

function hintClass(
  isDark: boolean,
  multiline: boolean,
  tooltipAlign: "center" | "end",
) {
  const position = multiline
    ? tooltipAlign === "end"
      ? "right-0 left-auto min-w-[13rem] max-w-[18rem] w-max whitespace-normal text-left"
      : "left-1/2 -translate-x-1/2 min-w-[13rem] max-w-[17rem] w-max whitespace-normal text-left"
    : tooltipAlign === "end"
      ? "right-0 left-auto whitespace-nowrap"
      : "left-0 whitespace-nowrap";
  return `pointer-events-none absolute top-[calc(100%+4px)] z-[200] rounded-md border px-2 py-1 text-xs normal-case font-normal tracking-normal shadow-md backdrop-blur-sm opacity-0 transition-opacity duration-100 group-hover/col-hint:opacity-100 ${position} ${
    isDark
      ? "border-slate-600/80 bg-slate-800/90 text-slate-200"
      : "border-gray-200/80 bg-white/95 text-gray-700"
  }`;
}

/** Column header hint — CSS hover (browser `title` has a long show delay). */
export function HeaderHoverHint({
  hint,
  isDark,
  className = "",
  multiline = false,
  tooltipAlign = "center",
  portaled = false,
  children,
}: {
  hint: string;
  isDark: boolean;
  className?: string;
  multiline?: boolean;
  /** Use `end` for right-edge headers so the tooltip opens leftward. */
  tooltipAlign?: "center" | "end";
  /** Render in document.body so table overflow does not clip the tooltip. */
  portaled?: boolean;
  children: ReactNode;
}) {
  const [hovering, setHovering] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!portaled || !hovering) {
      setCoords(null);
      return;
    }

    const update = () => {
      const trigger = triggerRef.current;
      const tip = tooltipRef.current;
      if (!trigger) return;

      const bodyZoom = getBodyCssZoom();
      const rect = trigger.getBoundingClientRect();
      const tipW = tip?.offsetWidth ?? (multiline ? 288 : 160);
      const tipH = tip?.offsetHeight ?? (multiline ? 120 : 28);
      const vv = window.visualViewport;
      const viewportW = (vv?.width ?? window.innerWidth) / bodyZoom;
      const viewportH = (vv?.height ?? window.innerHeight) / bodyZoom;

      // Fixed element inside zoomed body — same as PricingListPickerRow delete menu.
      const triggerTop = rect.top / bodyZoom;
      const triggerBottom = rect.bottom / bodyZoom;
      const triggerLeft = rect.left / bodyZoom;
      const triggerRight = rect.right / bodyZoom;
      const triggerWidth = rect.width / bodyZoom;

      let top = triggerBottom + GAP_PX;
      let left =
        tooltipAlign === "end"
          ? triggerRight - tipW
          : triggerLeft + triggerWidth / 2 - tipW / 2;

      left = Math.max(SAFE_PX, Math.min(left, viewportW - tipW - SAFE_PX));
      if (top + tipH > viewportH - SAFE_PX) {
        top = Math.max(SAFE_PX, triggerTop - GAP_PX - tipH);
      }
      top = Math.max(SAFE_PX, top);

      setCoords({ top, left });
    };

    update();
    const raf = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [hovering, portaled, tooltipAlign, multiline, hint]);

  if (portaled) {
    return (
      <>
        <span
          ref={triggerRef}
          className={`inline-flex ${className}`}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          {children}
        </span>
        {hovering && mounted
          ? createPortal(
              <div
                ref={tooltipRef}
                role="tooltip"
                className={`pointer-events-none fixed ${tooltipSurfaceClass(isDark, multiline)}`}
                style={{
                  top: coords?.top ?? 0,
                  left: coords?.left ?? 0,
                  visibility: coords ? "visible" : "hidden",
                  zIndex: TOOLTIP_Z,
                }}
              >
                {hint}
              </div>,
              document.body,
            )
          : null}
      </>
    );
  }

  return (
    <span className={`group/col-hint relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className={hintClass(isDark, multiline, tooltipAlign)}>
        {hint}
      </span>
    </span>
  );
}
