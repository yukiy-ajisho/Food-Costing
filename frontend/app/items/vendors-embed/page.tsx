"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { vendorsAPI } from "@/lib/api";
import {
  INVOICE_VENDORS_BROADCAST_CHANNEL,
  INVOICE_VENDORS_EMBED_SAVED,
} from "@/lib/invoiceEmbedMessages";

type Row = {
  id: string;
  name: string;
  isNew?: boolean;
  user_id?: string;
  created_at?: string;
};

export default function VendorsEmbedPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await vendorsAPI.getAll();
        if (cancelled) return;
        const ui: Row[] = data.map((v) => ({
          id: v.id,
          name: v.name,
          user_id: v.user_id,
          created_at: v.created_at,
          isNew: false,
        }));
        ui.push({
          id: `new-${crypto.randomUUID()}`,
          name: "",
          isNew: true,
        });
        setRows(ui);
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : "Failed to load vendors.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setName = useCallback((id: string, name: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, name } : r))
    );
  }, []);

  const handleCancel = () => {
    window.close();
  };

  const handleSave = async () => {
    if (saving) return;
    const newRows = rows.filter((r) => r.isNew);
    const newRow = newRows[0];
    setSaving(true);
    try {
      if (newRow?.name?.trim()) {
        await vendorsAPI.create({ name: newRow.name.trim() });
      }
      const fresh = await vendorsAPI.getAll();
      const payload = {
        type: INVOICE_VENDORS_EMBED_SAVED,
        vendors: fresh,
      } as const;
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
      }
      try {
        const bc = new BroadcastChannel(INVOICE_VENDORS_BROADCAST_CHANNEL);
        bc.postMessage(payload);
        bc.close();
      } catch {
        /* BroadcastChannel unsupported */
      }
      window.close();
      window.setTimeout(() => {
        if (!window.closed) {
          alert(
            "Vendors were saved. You can close this tab manually if it did not close automatically."
          );
        }
      }, 400);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className={
          isDark
            ? "min-h-screen bg-slate-900 p-8 text-slate-300"
            : "min-h-screen bg-gray-50 p-8 text-gray-700"
        }
      >
        <div
          className={`rounded-lg border p-8 text-center shadow-sm ${
            isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
          }`}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isDark
          ? "min-h-screen bg-slate-900 p-6 text-slate-100"
          : "min-h-screen bg-gray-50 p-6 text-gray-900"
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className={`rounded-lg px-4 py-2 text-sm ${
            isDark
              ? "bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
              : "bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
          }`}
        >
          Cancel
        </button>
      </div>

      <div
        className={`rounded-lg border shadow-sm transition-colors ${
          isDark ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
        }`}
      >
        <table
          className="w-full"
          style={{ tableLayout: "fixed", width: "100%" }}
        >
          <thead
            className={`border-b ${
              isDark
                ? "border-slate-600 bg-slate-700"
                : "border-gray-200 bg-gray-50"
            }`}
          >
            <tr>
              <th
                className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                  isDark ? "text-slate-300" : "text-gray-500"
                }`}
                style={{ width: "100%" }}
              >
                Name
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y ${
              isDark ? "divide-slate-700" : "divide-gray-200"
            }`}
          >
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`transition-colors ${
                  row.isNew
                    ? isDark
                      ? "bg-teal-950/40"
                      : "bg-sky-100"
                    : isDark
                      ? "bg-slate-800/60"
                      : "bg-gray-50/80"
                }`}
                style={{
                  height: "52px",
                  minHeight: "52px",
                  maxHeight: "52px",
                }}
              >
                <td
                  className={`px-6 whitespace-nowrap ${
                    row.isNew
                      ? isDark
                        ? "border-l-4 border-l-teal-500/60"
                        : "border-l-4 border-l-sky-400"
                      : ""
                  }`}
                  style={{
                    paddingTop: "16px",
                    paddingBottom: "16px",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      height: "20px",
                      minHeight: "20px",
                      maxHeight: "20px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {row.isNew ? (
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => setName(row.id, e.target.value)}
                        disabled={saving}
                        placeholder="New vendor name"
                        className="w-full rounded-md border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        style={{
                          height: "20px",
                          minHeight: "20px",
                          maxHeight: "20px",
                          lineHeight: "20px",
                          padding: "0 4px",
                          fontSize: "0.875rem",
                          boxSizing: "border-box",
                          margin: 0,
                        }}
                      />
                    ) : (
                      <span
                        className={`truncate text-sm ${
                          isDark ? "text-slate-200" : "text-gray-900"
                        }`}
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
