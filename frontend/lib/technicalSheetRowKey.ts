export function normalizeSpecificChild(
  specific: string | null | undefined,
): string {
  if (!specific || specific === "lowest") return "lowest";
  return specific;
}

export function snapshotRowKey(
  childId: string,
  specific: string | null | undefined,
  isPrepped: boolean,
): string {
  if (isPrepped) return childId;
  return `${childId}|${normalizeSpecificChild(specific)}`;
}

export function childIdFromRowKey(rowKey: string): string {
  const i = rowKey.indexOf("|");
  return i >= 0 ? rowKey.slice(0, i) : rowKey;
}
