"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type {
  DeliverySite,
  InvoicingAccount,
  InvoicingItemCandidate,
} from "@/lib/invoicing";
import { ItemKindBadge } from "@/components/recipe-cost-report/ItemKindBadge";

type Props = {
  isDark: boolean;
  candidates: InvoicingItemCandidate[];
  accounts: InvoicingAccount[];
  deliverySites: DeliverySite[];
  selectedAccountId: string;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    account_id: string;
    delivery_site_id: string;
    item_ids: string[];
  }) => void;
};

export function CreateInvoicingListModal({
  isDark,
  candidates,
  accounts,
  deliverySites,
  selectedAccountId,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(selectedAccountId || "");
  const [deliverySiteId, setDeliverySiteId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(true);
  const [showPrepped, setShowPrepped] = useState(true);

  useEffect(() => {
    setAccountId(selectedAccountId || "");
  }, [selectedAccountId]);

  const accountLocked = selectedAccountId.trim().length > 0;

  const deliverySitesForAccount = useMemo(() => {
    if (!accountId) return deliverySites;
    return deliverySites.filter((site) => site.account_id === accountId);
  }, [deliverySites, accountId]);

  useEffect(() => {
    setDeliverySiteId((prev) =>
      prev && deliverySitesForAccount.some((site) => site.id === prev) ? prev : "",
    );
  }, [deliverySitesForAccount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (c.is_menu_item && !showMenu) return false;
      if (!c.is_menu_item && !showPrepped) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q);
    });
  }, [candidates, search, showMenu, showPrepped]);

  const canCreate =
    name.trim().length > 0 &&
    accountId.length > 0 &&
    deliverySiteId.length > 0 &&
    selected.size > 0 &&
    deliverySitesForAccount.length > 0;

  const panel = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";
  const inputCls = `w-full rounded-md border px-3 py-2 text-sm ${
    isDark
      ? "border-slate-600 bg-slate-900 text-slate-100"
      : "border-gray-300 bg-white text-gray-900"
  }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-xl ${panel}`}
      >
        <div
          className={`flex items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2 className="text-lg font-semibold">Create New Template</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Delivery list template
            </label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cupertino"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Account</label>
            <select
              className={inputCls}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={accountLocked || accounts.length === 0}
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.company_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Delivery site
            </label>
            <select
              className={inputCls}
              value={deliverySiteId}
              onChange={(e) => setDeliverySiteId(e.target.value)}
              disabled={deliverySitesForAccount.length === 0}
            >
              <option value="">Select delivery site</option>
              {deliverySitesForAccount.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showPrepped}
                  onChange={(e) => setShowPrepped(e.target.checked)}
                />
                Prepped
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showMenu}
                  onChange={(e) => setShowMenu(e.target.checked)}
                />
                Menu
              </label>
            </div>
            <input
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prepped & menu items…"
            />
            <ul
              className={`mt-2 max-h-56 overflow-y-auto rounded-md border ${border}`}
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-sm text-gray-500">
                  No items match.
                </li>
              ) : (
                filtered.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                          isDark ? "hover:bg-slate-700/80" : "hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <ItemKindBadge isMenuItem={c.is_menu_item} isDark={isDark} />
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        <div
          className={`flex justify-end gap-3 border-t px-5 py-4 ${border}`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              isDark
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() =>
              onCreate({
                name: name.trim(),
                account_id: accountId,
                delivery_site_id: deliverySiteId,
                item_ids: [...selected],
              })
            }
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
