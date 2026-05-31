"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  invoicingAPI,
  type InvoicingAccount,
  type InvoicingAccountInput,
} from "@/lib/invoicing";

type FormState = InvoicingAccountInput;

const EMPTY_FORM: FormState = {
  company_name: "",
  poc_phone: "",
  poc_email: "",
};

export function AccountInformationTab() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [accounts, setAccounts] = useState<InvoicingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoicingAPI.listAccounts();
      setAccounts(data.accounts ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (account: InvoicingAccount) => {
    setEditingId(account.id);
    setForm({
      company_name: account.company_name,
      poc_phone: account.poc_phone ?? "",
      poc_email: account.poc_email ?? "",
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
      const payload: InvoicingAccountInput = {
        company_name: form.company_name.trim(),
        poc_phone: form.poc_phone?.trim() || null,
        poc_email: form.poc_email?.trim() || null,
      };
      if (editingId) {
        await invoicingAPI.updateAccount(editingId, payload);
      } else {
        await invoicingAPI.createAccount(payload);
      }
      closeModal();
      await loadAccounts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account: InvoicingAccount) => {
    if (
      !window.confirm(
        `Delete account "${account.company_name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await invoicingAPI.deleteAccount(account.id);
      await loadAccounts();
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
          Add account
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
      ) : accounts.length === 0 ? (
        <div
          className={`rounded-lg border p-8 text-center text-sm shadow-sm transition-colors ${card} ${muted}`}
        >
          No accounts yet.
        </div>
      ) : (
        <div
          className={`w-full rounded-lg border shadow-sm transition-colors ${card}`}
        >
          <table className="w-full">
            <thead className={`border-b ${thead}`}>
              <tr>
                {["Company Name", "PoC Phone", "PoC Email", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${muted}`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className={`divide-y ${divide}`}>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className={`px-6 py-3 text-sm font-medium ${textMain}`}>
                    {account.company_name}
                  </td>
                  <td className={`px-6 py-3 text-sm ${textMain}`}>
                    {account.poc_phone || "—"}
                  </td>
                  <td className={`px-6 py-3 text-sm ${textMain}`}>
                    {account.poc_email || "—"}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(account)}
                        className={`rounded p-1.5 ${
                          isDark
                            ? "text-slate-300 hover:bg-slate-600"
                            : "text-gray-600 hover:bg-gray-100"
                        }`}
                        aria-label={`Edit ${account.company_name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(account)}
                        className={`rounded p-1.5 ${
                          isDark
                            ? "text-red-400 hover:bg-slate-600"
                            : "text-red-600 hover:bg-red-50"
                        }`}
                        aria-label={`Delete ${account.company_name}`}
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
              {editingId ? "Edit account" : "Add account"}
            </h2>
            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label className={labelClass}>
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  className={inputClass}
                  value={form.company_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, company_name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>PoC Phone</label>
                <input
                  className={inputClass}
                  value={form.poc_phone ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, poc_phone: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>PoC Email</label>
                <input
                  type="email"
                  className={inputClass}
                  value={form.poc_email ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, poc_email: e.target.value }))
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
