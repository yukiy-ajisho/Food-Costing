"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type PortaledMenuStyle = {
  top: number;
  left: number;
};

function bodyZoom(): number {
  const raw = Number(window.getComputedStyle(document.body).zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Position a fixed menu under a header trigger; portaled to body to avoid table overflow scroll. */
export function usePortaledHeaderMenu(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<PortaledMenuStyle | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    const GAP_PX = 4;
    const SAFE_PX = 8;

    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const zoom = bodyZoom();
      const rect = trigger.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      const vv = window.visualViewport;
      const viewportH = (vv?.height ?? window.innerHeight) / zoom;

      const triggerTop = rect.top / zoom;
      const triggerBottom = rect.bottom / zoom;
      const triggerLeft = rect.left / zoom;

      let top = triggerBottom + GAP_PX;
      if (menuHeight > 0 && top + menuHeight > viewportH - SAFE_PX) {
        top = Math.max(SAFE_PX, triggerTop - GAP_PX - menuHeight);
      }

      setMenuStyle({
        top: Math.max(SAFE_PX, top),
        left: Math.max(SAFE_PX, triggerLeft),
      });
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
  }, [open]);

  return { triggerRef, menuRef, mounted, menuStyle };
}

export function isOutsidePortaledMenu(
  target: Node,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
): boolean {
  return (
    !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)
  );
}
