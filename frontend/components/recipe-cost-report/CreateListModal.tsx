"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ItemCandidate } from "@/lib/recipeCostReport";

type Props = {
  pageMode: "wholesale" | "menu";
  isDark: boolean;
  candidatesTenantOnly: ItemCandidate[];
  candidatesCompanyOwned: ItemCandidate[];
  wlOptions: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    item_ids: string[];
    mode?: "company_owned" | "franchise";
    wholesale_list_id?: string | null;
  }) => void;
};

export function CreateListModal({
  pageMode,
  isDark,
  candidatesTenantOnly,
  candidatesCompanyOwned,
  wlOptions,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"company_owned" | "franchise">("company_owned");
  const [wlId, setWlId] = useState("");

  const activeCandidates =
    pageMode === "menu" && mode === "company_owned"
      ? candidatesCompanyOwned
      : candidatesTenantOnly;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeCandidates;
    return activeCandidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [activeCandidates, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const canCreate =
    name.trim().length > 0 &&
    (pageMode !== "menu" || mode !== "franchise" || wlId.length > 0);

  const border = isDark ? "border-slate-700" : "border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const inputCls = `h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
  }`;
  const btnPrimary =
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const btnSecondary = `inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-list-title"
    >
      <div
        className={`flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-xl ${
          isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-6 py-4 ${border}`}
        >
          <h2 id="create-list-title" className={`text-lg font-semibold ${textMain}`}>
            Create list
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              isDark ? "text-slate-400 hover:bg-slate-700" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <input
              id="create-list-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
              className={inputCls}
              placeholder="e.g. Cupertino"
            />
          </div>

          {pageMode === "menu" && (
            <div className="space-y-3">
              <fieldset className="flex flex-wrap gap-4">
                <legend className="sr-only">Mode</legend>
                <label
                  className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                >
                  <input
                    type="radio"
                    checked={mode === "company_owned"}
                    onChange={() => setMode("company_owned")}
                    className="h-4 w-4"
                  />
                  Company-owned
                </label>
                <label
                  className={`flex h-10 cursor-pointer items-center gap-2 text-sm ${textMain}`}
                >
                  <input
                    type="radio"
                    checked={mode === "franchise"}
                    onChange={() => setMode("franchise")}
                    className="h-4 w-4"
                  />
                  Franchise
                </label>
              </fieldset>
              {mode === "franchise" && (
                <div>
                  <label
                    htmlFor="create-wl"
                    className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
                  >
                    Wholesale list
                  </label>
                  <select
                    id="create-wl"
                    value={wlId}
                    onChange={(e) => setWlId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select wholesale list…</option>
                    {wlOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="create-search"
              className={`mb-1.5 block text-xs font-medium uppercase tracking-wide ${muted}`}
            >
              Items ({selected.size} selected)
            </label>
            <input
              id="create-search"
              type="search"
              placeholder="Search prepped & menu items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls}
            />
          </div>

          <ul
            className={`max-h-52 overflow-y-auto rounded-lg border divide-y ${
              isDark ? "divide-slate-700 border-slate-700" : "divide-gray-200 border-gray-200"
            }`}
          >
            {filtered.length === 0 ? (
              <li className={`px-4 py-6 text-center text-sm ${muted}`}>No items match</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className={`flex-1 font-medium ${textMain}`}>{c.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {c.is_cross_tenant ? (
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            isDark
                              ? "bg-amber-900/40 text-amber-200"
                              : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          Shared
                        </span>
                      ) : null}
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          c.is_menu_item
                            ? isDark
                              ? "bg-violet-900/40 text-violet-200"
                              : "bg-violet-100 text-violet-800"
                            : isDark
                              ? "bg-slate-700 text-slate-300"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {c.is_menu_item ? "Menu" : "Prepped"}
                      </span>
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>

        <div
          className={`flex shrink-0 justify-end gap-3 border-t px-6 py-4 ${border}`}
        >
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() =>
              onCreate({
                name: name.trim(),
                item_ids: [...selected],
                mode: pageMode === "menu" ? mode : undefined,
                wholesale_list_id:
                  pageMode === "menu" && mode === "franchise" ? wlId || null : null,
              })
            }
            className={btnPrimary}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
