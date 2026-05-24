"use client";

type LinkedRetail = { id: string; name: string };

type Props = {
  isDark: boolean;
  pageMode: "wholesale" | "menu";
  listName: string;
  linkedRetailLists: LinkedRetail[];
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteListConfirmModal({
  isDark,
  pageMode,
  listName,
  linkedRetailLists,
  deleting,
  onCancel,
  onConfirm,
}: Props) {
  const border = isDark ? "border-slate-700" : "border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const btnSecondary = `inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    isDark
      ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
  }`;
  const btnDanger =
    "inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

  const hasLinked = pageMode === "wholesale" && linkedRetailLists.length > 0;
  const listKind =
    pageMode === "wholesale" ? "wholesale price list" : "retail price list";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-list-title"
    >
      <div
        className={`w-full max-w-md rounded-xl border p-6 shadow-xl ${
          isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="delete-list-title"
          className={`text-lg font-semibold ${textMain}`}
        >
          Delete list
        </h2>

        {hasLinked ? (
          <div className={`mt-4 space-y-3 text-sm ${textMain}`}>
            <p>
              This wholesale price list is used by the following retail price
              lists:
            </p>
            <ul
              className={`list-inside list-disc space-y-1 rounded-lg border px-4 py-3 ${border} ${muted}`}
            >
              {linkedRetailLists.map((r) => (
                <li key={r.id} className={textMain}>
                  {r.name}
                </li>
              ))}
            </ul>
            <p>
              Delete these retail price lists and{" "}
              <span className="font-medium">{listName}</span>? This cannot be
              undone. All prices and list history for these lists will be
              removed.
            </p>
          </div>
        ) : (
          <p className={`mt-4 text-sm ${textMain}`}>
            Delete <span className="font-medium">{listName}</span>? This{" "}
            {listKind} and all of its items and price history will be removed.
            This cannot be undone.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className={btnSecondary}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className={btnDanger}
          >
            {deleting ? "Deleting…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
