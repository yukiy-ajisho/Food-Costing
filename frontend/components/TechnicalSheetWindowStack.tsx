"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import DraggableBase, { type DraggableData } from "react-draggable";
import { StandardTechnicalSheetView } from "@/components/StandardTechnicalSheetView";

type SheetDraggableProps = {
  nodeRef: RefObject<HTMLDivElement | null>;
  handle: string;
  cancel: string;
  position: { x: number; y: number };
  onStop: (e: MouseEvent, data: DraggableData) => void;
  bounds: string;
  children: ReactNode;
};

const Draggable = DraggableBase as unknown as ComponentType<SheetDraggableProps>;

const CASCADE_OFFSET = 24;
const MAX_CASCADE_OFFSET = 240;
const BASE_Z = 120;

export type TechnicalSheetWindowEntry = {
  windowId: string;
  sourceItemId: string;
  baseRecipeName: string;
  x: number;
  y: number;
  zIndex: number;
};

function newWindowId(): string {
  return `tsw-${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`;
}

function cascadePosition(index: number): { x: number; y: number } {
  const offset = Math.min(index * CASCADE_OFFSET, MAX_CASCADE_OFFSET);
  return { x: offset, y: offset };
}

export function useTechnicalSheetWindows() {
  const [windows, setWindows] = useState<TechnicalSheetWindowEntry[]>([]);
  const [costRefreshGeneration, setCostRefreshGeneration] = useState(0);

  const openSourceItemIds = useMemo(
    () => new Set(windows.map((w) => w.sourceItemId)),
    [windows],
  );

  const focusWindow = useCallback((sourceItemId: string) => {
    setWindows((prev) => {
      const nextZ =
        prev.reduce((max, w) => Math.max(max, w.zIndex), BASE_Z) + 1;
      return prev.map((w) =>
        w.sourceItemId === sourceItemId ? { ...w, zIndex: nextZ } : w,
      );
    });
  }, []);

  const openWindow = useCallback(
    (sourceItemId: string, baseRecipeName: string) => {
      setWindows((prev) => {
        const existing = prev.find((w) => w.sourceItemId === sourceItemId);
        if (existing) {
          const nextZ =
            prev.reduce((max, w) => Math.max(max, w.zIndex), BASE_Z) + 1;
          return prev.map((w) =>
            w.sourceItemId === sourceItemId ? { ...w, zIndex: nextZ } : w,
          );
        }
        const { x, y } = cascadePosition(prev.length);
        const zIndex =
          prev.reduce((max, w) => Math.max(max, w.zIndex), BASE_Z - 1) + 1;
        return [
          ...prev,
          {
            windowId: newWindowId(),
            sourceItemId,
            baseRecipeName,
            x,
            y,
            zIndex,
          },
        ];
      });
    },
    [],
  );

  const closeWindow = useCallback((windowId: string) => {
    setWindows((prev) => prev.filter((w) => w.windowId !== windowId));
  }, []);

  const closeAll = useCallback(() => {
    setWindows([]);
  }, []);

  const updateWindowPosition = useCallback(
    (windowId: string, x: number, y: number) => {
      setWindows((prev) =>
        prev.map((w) => (w.windowId === windowId ? { ...w, x, y } : w)),
      );
    },
    [],
  );

  const notifySheetSaved = useCallback((_savedSourceItemId: string) => {
    setCostRefreshGeneration((g) => g + 1);
  }, []);

  return {
    windows,
    openSourceItemIds,
    costRefreshGeneration,
    openWindow,
    openPreppedChild: openWindow,
    focusWindow,
    closeWindow,
    closeAll,
    updateWindowPosition,
    notifySheetSaved,
  };
}

type DraggableSheetWindowProps = {
  entry: TechnicalSheetWindowEntry;
  isDark: boolean;
  openSourceItemIds: ReadonlySet<string>;
  costRefreshGeneration: number;
  onOpenPreppedChild: (sourceItemId: string, baseRecipeName: string) => void;
  onFocusWindow: (sourceItemId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onPositionChange: (windowId: string, x: number, y: number) => void;
  onSheetSaved: (savedSourceItemId: string) => void;
};

function DraggableSheetWindow({
  entry,
  isDark,
  openSourceItemIds,
  costRefreshGeneration,
  onOpenPreppedChild,
  onFocusWindow,
  onCloseWindow,
  onPositionChange,
  onSheetSaved,
}: DraggableSheetWindowProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none fixed inset-0 flex items-center justify-center p-1.5"
      style={{ zIndex: entry.zIndex }}
    >
      <Draggable
        nodeRef={nodeRef}
        handle=".ts-window-drag-handle"
        cancel=".ts-window-no-drag, input, textarea, select, button, label, a, [role='button']"
        position={{ x: entry.x, y: entry.y }}
        onStop={(_e: MouseEvent, data: DraggableData) =>
          onPositionChange(entry.windowId, data.x, data.y)
        }
        bounds="parent"
      >
        <div
          ref={nodeRef}
          className="pointer-events-auto flex h-[calc(100vh-0.75rem)] w-[calc(100vw-0.75rem)] min-w-0 max-w-full flex-col"
          onMouseDown={() => onFocusWindow(entry.sourceItemId)}
        >
          <StandardTechnicalSheetView
            isDark={isDark}
            sourceItemId={entry.sourceItemId}
            baseRecipeName={entry.baseRecipeName}
            windowMode
            zIndex={entry.zIndex}
            openSourceItemIds={openSourceItemIds}
            costRefreshGeneration={costRefreshGeneration}
            onOpenPreppedSheet={onOpenPreppedChild}
            onSheetSaved={onSheetSaved}
            onClose={() => onCloseWindow(entry.windowId)}
          />
        </div>
      </Draggable>
    </div>
  );
}

type TechnicalSheetWindowStackProps = {
  isDark: boolean;
  windows: TechnicalSheetWindowEntry[];
  openSourceItemIds: ReadonlySet<string>;
  costRefreshGeneration: number;
  onOpenPreppedChild: (sourceItemId: string, baseRecipeName: string) => void;
  onFocusWindow: (sourceItemId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onPositionChange: (windowId: string, x: number, y: number) => void;
  onSheetSaved: (savedSourceItemId: string) => void;
};

export function TechnicalSheetWindowStack({
  isDark,
  windows,
  openSourceItemIds,
  costRefreshGeneration,
  onOpenPreppedChild,
  onFocusWindow,
  onCloseWindow,
  onPositionChange,
  onSheetSaved,
}: TechnicalSheetWindowStackProps) {
  if (windows.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/50">
      {windows.map((entry) => (
        <DraggableSheetWindow
          key={entry.windowId}
          entry={entry}
          isDark={isDark}
          openSourceItemIds={openSourceItemIds}
          costRefreshGeneration={costRefreshGeneration}
          onOpenPreppedChild={onOpenPreppedChild}
          onFocusWindow={onFocusWindow}
          onCloseWindow={onCloseWindow}
          onPositionChange={onPositionChange}
          onSheetSaved={onSheetSaved}
        />
      ))}
    </div>
  );
}
