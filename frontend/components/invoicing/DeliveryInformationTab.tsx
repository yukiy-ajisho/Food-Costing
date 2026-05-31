"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  invoicingAPI,
  type DeliverySite,
  type DeliverySiteInput,
} from "@/lib/invoicing";

type FormState = DeliverySiteInput;

const EMPTY_FORM: FormState = {
  name: "",
  street: "",
  city: "",
  state_zip: "",
  phone_1: "",
  phone_2: "",
  email: "",
};

function formatAddress(site: DeliverySite): string {
  const parts = [site.street, site.city, site.state_zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function formatPhone(site: DeliverySite): string {
  const parts = [site.phone_1, site.phone_2].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

export function DeliveryInformationTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [sites, setSites] = useState<DeliverySite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadSites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoicingAPI.listDeliverySites();
      setSites(data.sites ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load delivery sites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (site: DeliverySite) => {
    setEditingId(site.id);
    setForm({
      name: site.name,
      street: site.street ?? "",
      city: site.city ?? "",
      state_zip: site.state_zip ?? "",
      phone_1: site.phone_1 ?? "",
      phone_2: site.phone_2 ?? "",
      email: site.email,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: DeliverySiteInput = {
        name: form.name.trim(),
        email: form.email.trim(),
        street: form.street?.trim() || null,
        city: form.city?.trim() || null,
        state_zip: form.state_zip?.trim() || null,
        phone_1: form.phone_1?.trim() || null,
        phone_2: form.phone_2?.trim() || null,
      };
      if (editingId) {
        await invoicingAPI.updateDeliverySite(editingId, payload);
      } else {
        await invoicingAPI.createDeliverySite(payload);
      }
      closeModal();
      await loadSites();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (site: DeliverySite) => {
    if (
      !window.confirm(
        `Delete delivery site "${site.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await invoicingAPI.deleteDeliverySite(site.id);
      await loadSites();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const inputClass = `mt-1 w-full rounded-md border px-3 py-2 text-sm ${
    isDark
      ? "border-slate-600 bg-slate-800 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;

  const labelClass = `block text-sm font-medium ${
    isDark ? "text-slate-300" : "text-gray-700"
  }`;

  const card = isDark ? "bg-slate-800 border-slate-700" : "bg-white border-gray-200";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const textMain = isDark ? "text-slate-100" : "text-gray-900";
  const thead = isDark
    ? "border-slate-600 bg-slate-700"
    : "border-gray-200 bg-gray-50";
  const divide = isDark ? "divide-slate-700" : "divide-gray-200";

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Add site
        </button>
      </div>

      {error ? (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            isDark
              ? "border-red-800 bg-red-950 text-red-200"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          className={`rounded-lg border p-8 text-center text-sm shadow-sm transition-colors ${card}`}
        >
          Loading…
        </div>
      ) : sites.length === 0 ? (
        <div
          className={`rounded-lg border p-8 text-center text-sm shadow-sm transition-colors ${card} ${muted}`}
        >
          No delivery sites yet.
        </div>
      ) : (
        <div
          className={`w-full rounded-lg border shadow-sm transition-colors ${card}`}
        >
          <table className="w-full">
            <thead className={`border-b ${thead}`}>
              <tr>
                {[
                  "Site Name",
                  "Address",
                  "Phone",
                  "Email",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${muted}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={`divide-y ${divide}`}>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td className={`px-6 py-3 text-sm font-medium ${textMain}`}>
                    {site.name}
                  </td>
                  <td className={`px-6 py-3 text-sm ${textMain}`}>
                    {formatAddress(site)}
                  </td>
                  <td className={`px-6 py-3 text-sm ${textMain}`}>
                    {formatPhone(site)}
                  </td>
                  <td className={`px-6 py-3 text-sm ${textMain}`}>
                    {site.email}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(site)}
                        className={`rounded p-1.5 ${
                          isDark
                            ? "text-slate-300 hover:bg-slate-600"
                            : "text-gray-600 hover:bg-gray-100"
                        }`}
                        aria-label={`Edit ${site.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(site)}
                        className={`rounded p-1.5 ${
                          isDark
                            ? "text-red-400 hover:bg-slate-600"
                            : "text-red-600 hover:bg-red-50"
                        }`}
                        aria-label={`Delete ${site.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg p-6 shadow-xl ${
              isDark ? "bg-slate-800" : "bg-white"
            }`}
          >
            <h2
              className={`text-lg font-semibold ${
                isDark ? "text-slate-100" : "text-gray-900"
              }`}
            >
              {editingId ? "Edit delivery site" : "Add delivery site"}
            </h2>
            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label className={labelClass}>
                  Site Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  className={inputClass}
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Street</label>
                <input
                  className={inputClass}
                  value={form.street ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, street: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>City</label>
                  <input
                    className={inputClass}
                    value={form.city ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, city: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>State / Zip</label>
                  <input
                    className={inputClass}
                    value={form.state_zip ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, state_zip: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Phone 1</label>
                  <input
                    className={inputClass}
                    value={form.phone_1 ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, phone_1: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Phone 2</label>
                  <input
                    className={inputClass}
                    value={form.phone_2 ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, phone_2: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className={`rounded-md px-4 py-2 text-sm font-medium ${
                    isDark
                      ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : editingId ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
