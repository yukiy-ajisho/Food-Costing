"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type {
  DeliverySite,
  InvoicingAccount,
  InvoicingItemCandidate,
} from "@/lib/invoicing";
import { recipeCostReportAPI } from "@/lib/recipeCostReport";
import { ItemKindBadge } from "@/components/recipe-cost-report/ItemKindBadge";

type WholesaleListOption = {
  id: string;
  name: string;
};

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
    wholesale_list_id: string;
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
  const [wholesaleListId, setWholesaleListId] = useState("");
  const [wholesaleLists, setWholesaleLists] = useState<WholesaleListOption[]>([]);
  const [pricedItemIds, setPricedItemIds] = useState<Set<string>>(new Set());
  const [wholesaleLoading, setWholesaleLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(true);
  const [showPrepped, setShowPrepped] = useState(true);
  const [showDeliveryPreselect, setShowDeliveryPreselect] = useState(false);

  useEffect(() => {
    setAccountId(selectedAccountId || "");
  }, [selectedAccountId]);

  useEffect(() => {
    let cancelled = false;
    void recipeCostReportAPI
      .listWholesaleLists()
      .then((data) => {
        if (cancelled) return;
        setWholesaleLists(
          (data.lists ?? []).map((list) => ({ id: list.id, name: list.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setWholesaleLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wholesaleListId) {
      setPricedItemIds(new Set());
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setWholesaleLoading(true);
    void recipeCostReportAPI
      .getWholesaleList(wholesaleListId)
      .then((data) => {
        if (cancelled) return;
        const ids = new Set(
          (data.members ?? [])
            .filter(
              (m) =>
                m.latest_wholesale_price != null &&
                Number.isFinite(m.latest_wholesale_price) &&
                m.latest_wholesale_price > 0,
            )
            .map((m) => m.item_id),
        );
        setPricedItemIds(ids);
        setSelected((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            if (ids.has(id)) next.add(id);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setPricedItemIds(new Set());
      })
      .finally(() => {
        if (!cancelled) setWholesaleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wholesaleListId]);

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
      if (!pricedItemIds.has(c.id)) return false;
      if (c.is_menu_item && !showMenu) return false;
      if (!c.is_menu_item && !showPrepped) return false;
      if (showDeliveryPreselect && !c.delivery) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q);
    });
  }, [
    candidates,
    search,
    showMenu,
    showPrepped,
    showDeliveryPreselect,
    pricedItemIds,
  ]);

  const canCreate =
    name.trim().length > 0 &&
    accountId.length > 0 &&
    deliverySiteId.length > 0 &&
    wholesaleListId.length > 0 &&
    selected.size > 0 &&
    deliverySitesForAccount.length > 0 &&
    !wholesaleLoading;

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
              Delivery List Template
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
              <option value="">Select Account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.company_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Primary Delivery Site
            </label>
            <select
              className={inputCls}
              value={deliverySiteId}
              onChange={(e) => setDeliverySiteId(e.target.value)}
              disabled={deliverySitesForAccount.length === 0}
            >
              <option value="">Select Primary Delivery Site</option>
              {deliverySitesForAccount.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Wholesale Price List
            </label>
            <select
              className={inputCls}
              value={wholesaleListId}
              onChange={(e) => setWholesaleListId(e.target.value)}
              disabled={wholesaleLists.length === 0}
            >
              <option value="">Select Wholesale Price List</option>
              {wholesaleLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showDeliveryPreselect}
                  onChange={(e) => setShowDeliveryPreselect(e.target.checked)}
                />
                Delivery preselect
              </label>
            </div>
            <input
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items with wholesale price…"
              disabled={!wholesaleListId || wholesaleLoading}
            />
            <ul
              className={`mt-2 max-h-56 overflow-y-auto rounded-md border ${border}`}
            >
              {!wholesaleListId ? (
                <li className="px-3 py-4 text-sm text-gray-500">
                  Select a wholesale price list first.
                </li>
              ) : wholesaleLoading ? (
                <li className="px-3 py-4 text-sm text-gray-500">Loading items…</li>
              ) : filtered.length === 0 ? (
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
                wholesale_list_id: wholesaleListId,
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
