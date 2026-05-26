import Fuse from "fuse.js";
import type { ListMemberRow } from "@/lib/recipeCostReport";

function normalizeItemSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Fuse index for item-name search (case-insensitive, typo-tolerant). */
function createItemNameFuse(members: ListMemberRow[]) {
  return new Fuse(members, {
    keys: [{ name: "name", getFn: (row) => normalizeItemSearchText(row.name) }],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: false,
  });
}

function rowMatchesFuseToken(
  row: ListMemberRow,
  token: string,
  fuse: Fuse<ListMemberRow>,
): boolean {
  return fuse.search(token).some((hit) => hit.item.item_id === row.item_id);
}

/**
 * Filter list members by item name:
 * - A: substring (case-insensitive)
 * - B: per-token fuzzy (typos)
 * - C: all tokens must match, any order (each token via A or B)
 */
export function filterMembersByItemSearch(
  members: ListMemberRow[],
  rawQuery: string,
): ListMemberRow[] {
  const query = normalizeItemSearchText(rawQuery);
  if (!query) return members;

  const fuse = createItemNameFuse(members);

  return members.filter((row) => {
    const name = normalizeItemSearchText(row.name);

    // A: full query appears anywhere in the name
    if (name.includes(query)) return true;

    const tokens = query.split(" ").filter(Boolean);
    if (tokens.length === 0) return true;

    if (tokens.length === 1) {
      const token = tokens[0]!;
      if (name.includes(token)) return true;
      return rowMatchesFuseToken(row, token, fuse);
    }

    // C: every token must match the name (A or B), order independent
    return tokens.every((token) => {
      if (name.includes(token)) return true;
      return rowMatchesFuseToken(row, token, fuse);
    });
  });
}
