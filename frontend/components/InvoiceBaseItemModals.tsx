"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { baseItemsAPI, type BaseItem } from "@/lib/api";

const inputStyle: CSSProperties = {
  height: "20px",
  minHeight: "20px",
  maxHeight: "20px",
  lineHeight: "20px",
  padding: "0 4px",
  fontSize: "0.875rem",
  boxSizing: "border-box",
  margin: 0,
  width: "100%",
};

function SpecificWeightHeader({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span>SPECIFIC WEIGHT (g/ml)</span>
      <div className="group relative">
        <div
          className={`flex h-4 w-4 cursor-help items-center justify-center rounded-full border text-xs ${
            isDark
              ? "border-slate-500 text-slate-400"
              : "border-gray-400 text-gray-400"
          }`}
        >
          ?
        </div>
        <div className="invisible absolute left-0 top-full z-50 mt-1 w-64 rounded bg-gray-800 p-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100">
          Specific weight for volume-based items (e.g., liquids, powders). Used
          to convert ml to grams.
        </div>
      </div>
    </div>
  );
}

function EachHeader({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span>EACH (g)</span>
      <div className="group relative">
        <div
          className={`flex h-4 w-4 cursor-help items-center justify-center rounded-full border text-xs ${
            isDark
              ? "border-slate-500 text-slate-400"
              : "border-gray-400 text-gray-400"
          }`}
        >
          ?
        </div>
        <div className="invisible absolute left-0 top-full z-50 mt-1 w-64 rounded bg-gray-800 p-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100">
          Weight per piece for count-based items (e.g., eggs, fruits). Used to
          convert &apos;each&apos; to grams.
        </div>
      </div>
    </div>
  );
}

type QuickEditProps = {
  open: boolean;
  baseItemId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function InvoiceBaseItemQuickEditModal({
  open,
  baseItemId,
  onClose,
  onSaved,
}: QuickEditProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [specificWeight, setSpecificWeight] = useState<string>("");

  useEffect(() => {
    if (!open || !baseItemId) return;
    let cancelled = false;
    setLoading(true);
    void baseItemsAPI
      .getById(baseItemId)
      .then((b) => {
        if (cancelled) return;
        setName(b.name);
        setSpecificWeight(
          b.specific_weight != null && b.specific_weight > 0
            ? String(b.specific_weight)
            : ""
        );
      })
      .catch((e) => {
        console.error(e);
        alert(e instanceof Error ? e.message : "Failed to load base item.");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseItemId, onClose]);

  if (!open || !baseItemId) return null;

  const shell = isDark
    ? "bg-slate-800 border-slate-600 text-slate-100"
    : "bg-white border-gray-200 text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";
  const inputCls = isDark
    ? "bg-slate-700 border-slate-600 text-slate-100"
    : "bg-white border-gray-300 text-gray-900";
  const theadCls = isDark
    ? "border-slate-600 bg-slate-700"
    : "border-gray-200 bg-gray-50";
  const divide = isDark ? "divide-slate-700" : "divide-gray-200";
  const thMuted = isDark ? "text-slate-300" : "text-gray-500";

  const handleSave = async () => {
    const sw = specificWeight.trim() === "" ? null : Number(specificWeight);
    if (sw != null && (Number.isNaN(sw) || sw <= 0)) {
      alert("Specific weight must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      await baseItemsAPI.update(baseItemId, { specific_weight: sw });
      onSaved();
      onClose();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-x-hidden bg-black/50 p-4">
      <div
        className={`flex max-h-[92vh] w-full min-w-0 max-w-5xl flex-col overflow-hidden rounded-xl border shadow-xl ${shell}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 ${border}`}
        >
          <h2 className="min-w-0 text-base font-semibold">Edit base item</h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving || loading}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                isDark ? "bg-slate-700" : "bg-gray-200"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
          <p
            className={`mb-3 text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}
          >
            Same layout as the Base items tab. Name is read-only; adjust
            specific weight for non-mass invoice lines.
          </p>
          <div
            className={`min-w-0 overflow-x-hidden rounded-lg border shadow-sm transition-colors ${
              isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
            }`}
          >
            <table
              className="w-full min-w-0 table-fixed"
            >
              <thead className={`border-b ${theadCls}`}>
                <tr>
                  <th
                    className={`w-[28%] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-normal ${thMuted}`}
                  >
                    NAME
                  </th>
                  <th
                    className={`w-[12%] px-3 py-3 text-left text-xs font-medium uppercase tracking-wider ${thMuted}`}
                  >
                    NONE
                  </th>
                  <th
                    className={`w-[40%] px-3 py-3 text-left text-xs font-medium tracking-wider whitespace-normal ${thMuted}`}
                  >
                    <SpecificWeightHeader isDark={isDark} />
                  </th>
                  <th
                    className={`w-[20%] px-3 py-3 text-left text-xs font-medium tracking-wider whitespace-normal ${thMuted}`}
                  >
                    <EachHeader isDark={isDark} />
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${divide}`}>
                {loading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-sm opacity-80"
                    >
                      Loading...
                    </td>
                  </tr>
                ) : (
                  <tr
                    className={`transition-colors ${
                      isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td
                      className="min-w-0 max-w-0 px-3 align-top"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        className={`break-words text-sm ${
                          isDark ? "text-slate-100" : "text-gray-900"
                        }`}
                      >
                        {name}
                      </div>
                    </td>
                    <td
                      className="px-3 align-top"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <input
                        type="radio"
                        disabled
                        checked={false}
                        readOnly
                        className="h-4 w-4 cursor-not-allowed opacity-50"
                        aria-hidden
                      />
                    </td>
                    <td
                      className="min-w-0 px-3 align-top"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="radio"
                          name="invoice-quickedit-type"
                          checked
                          disabled
                          className="h-4 w-4 shrink-0 cursor-not-allowed text-blue-600 opacity-70"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={specificWeight}
                          onChange={(e) => setSpecificWeight(e.target.value)}
                          disabled={saving}
                          className={`min-w-0 max-w-full flex-1 rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputCls}`}
                          style={{ ...inputStyle, width: "auto" }}
                          placeholder="e.g. 1000"
                        />
                      </div>
                    </td>
                    <td
                      className="px-3 align-top"
                      style={{
                        paddingTop: "16px",
                        paddingBottom: "16px",
                        boxSizing: "border-box",
                      }}
                    >
                      <span
                        className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}
                      >
                        —
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type NewProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (item: BaseItem) => void;
};

export function InvoiceNewBaseItemModal({ open, onClose, onCreated }: NewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [specificWeight, setSpecificWeight] = useState("");
  const [kind, setKind] = useState<"none" | "specific_weight">("none");

  useEffect(() => {
    if (open) {
      setName("");
      setSpecificWeight("");
      setKind("none");
    }
  }, [open]);

  if (!open) return null;

  const shell = isDark
    ? "bg-slate-800 border-slate-600 text-slate-100"
    : "bg-white border-gray-200 text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";
  const inputCls = isDark
    ? "bg-slate-700 border-slate-600 text-slate-100"
    : "bg-white border-gray-300 text-gray-900";
  const theadCls = isDark
    ? "border-slate-600 bg-slate-700"
    : "border-gray-200 bg-gray-50";
  const divide = isDark ? "divide-slate-700" : "divide-gray-200";
  const thMuted = isDark ? "text-slate-300" : "text-gray-500";

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Name is required.");
      return;
    }
    let sw: number | null | undefined = undefined;
    if (kind === "specific_weight") {
      const raw = specificWeight.trim();
      if (raw === "") {
        alert("Enter a specific weight or choose None.");
        return;
      }
      const n = Number(raw);
      if (Number.isNaN(n) || n <= 0) {
        alert("Specific weight must be a positive number.");
        return;
      }
      sw = n;
    }
    setSaving(true);
    try {
      const created = await baseItemsAPI.create({
        name: name.trim(),
        specific_weight: sw,
      });
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-x-hidden bg-black/50 p-4">
      <div
        className={`flex min-w-0 max-h-[92vh] w-full max-w-5xl flex-col overflow-x-hidden overflow-y-hidden rounded-xl border shadow-xl ${shell}`}
      >
        <div
          className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 ${border}`}
        >
          <h2 className="text-base font-semibold">New base item</h2>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                isDark ? "bg-slate-700" : "bg-gray-200"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
          <div
            className={`min-w-0 overflow-x-hidden rounded-lg border shadow-sm transition-colors ${
              isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
            }`}
          >
            <table
              className="w-full min-w-0 max-w-full"
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <thead className={`border-b ${theadCls}`}>
                <tr>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${thMuted}`}
                    style={{ width: "30%" }}
                  >
                    NAME
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${thMuted}`}
                    style={{ width: "20%" }}
                  >
                    NONE
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${thMuted}`}
                    style={{ width: "25%" }}
                  >
                    <SpecificWeightHeader isDark={isDark} />
                  </th>
                  <th
                    className={`px-6 py-3 text-left text-xs font-medium tracking-wider ${thMuted}`}
                    style={{ width: "25%" }}
                  >
                    <EachHeader isDark={isDark} />
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${divide}`}>
                <tr
                  className={`transition-colors ${
                    isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                  }`}
                >
                  <td
                    className="px-4 whitespace-nowrap sm:px-6"
                    style={{
                      paddingTop: "16px",
                      paddingBottom: "16px",
                      boxSizing: "border-box",
                    }}
                  >
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={saving}
                      className={`min-w-0 rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputCls}`}
                      style={inputStyle}
                      placeholder="Base item name"
                    />
                  </td>
                  <td
                    className="px-4 whitespace-nowrap sm:px-6"
                    style={{
                      paddingTop: "16px",
                      paddingBottom: "16px",
                      boxSizing: "border-box",
                    }}
                  >
                    <input
                      type="radio"
                      name="invoice-new-type"
                      checked={kind === "none"}
                      onChange={() => {
                        setKind("none");
                        setSpecificWeight("");
                      }}
                      disabled={saving}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td
                    className="px-4 whitespace-nowrap sm:px-6"
                    style={{
                      paddingTop: "16px",
                      paddingBottom: "16px",
                      boxSizing: "border-box",
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                      <input
                        type="radio"
                        name="invoice-new-type"
                        checked={kind === "specific_weight"}
                        onChange={() => setKind("specific_weight")}
                        disabled={saving}
                        className="h-4 w-4 shrink-0 text-blue-600 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={specificWeight}
                        onChange={(e) => setSpecificWeight(e.target.value)}
                        disabled={saving || kind !== "specific_weight"}
                        className={`min-w-0 rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputCls} disabled:opacity-50`}
                        style={inputStyle}
                        placeholder="g/ml"
                      />
                    </div>
                  </td>
                  <td
                    className="px-4 whitespace-nowrap sm:px-6"
                    style={{
                      paddingTop: "16px",
                      paddingBottom: "16px",
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      className={`text-sm ${isDark ? "text-slate-500" : "text-gray-400"}`}
                    >
                      —
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
