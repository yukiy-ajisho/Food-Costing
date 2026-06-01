import { apiRequest } from "./api";
import type { InvoicingCostBreakdown } from "./invoicingCalc";

export type InvoicingAccount = {
  id: string;
  tenant_id: string;
  company_name: string;
  poc_phone: string | null;
  poc_email: string | null;
  created_at?: string;
  updated_at?: string;
};

export type InvoicingAccountInput = {
  company_name: string;
  poc_phone?: string | null;
  poc_email?: string | null;
};

export type DeliverySite = {
  id: string;
  tenant_id: string;
  account_id: string;
  company_name: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email: string;
  created_at?: string;
  updated_at?: string;
};

export type DeliverySiteInput = {
  account_id: string;
  name: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone_1?: string | null;
  phone_2?: string | null;
  email: string;
};

export type InvoicingItemCandidate = {
  id: string;
  name: string;
  is_menu_item: boolean;
  proceed_yield_amount: number;
  proceed_yield_unit: string | null;
  each_grams: number | null;
};

export type InvoiceListSummary = {
  id: string;
  name: string;
  delivery_site_id: string;
  created_at?: string;
  updated_at?: string;
};

export type InvoiceListLine = {
  item_id: string;
  unit_size: number | null;
  unit_size_unit: string | null;
  sort_order: number;
};

export type InvoiceListItemRow = InvoiceListLine & {
  name: string;
  is_menu_item: boolean;
  each_grams: number | null;
  proceed_yield_amount: number;
  proceed_yield_unit: string | null;
};

export type InvoiceListDetail = {
  id: string;
  tenant_id: string;
  name: string;
  delivery_site_id: string;
  lines: InvoiceListLine[];
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
};

export type BoxInvoiceSummary = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  company_name: string;
  total_amount: number;
  delivery_site_name: string;
  sent_at: string | null;
  created_at?: string;
};

export type BoxInvoiceLine = {
  item_id: string;
  name: string;
  unit_size: number;
  unit_size_unit: string;
  units: number;
  cost: number;
  sub_total: number;
  sort_order: number;
};

export type BoxInvoice = {
  id: string;
  tenant_id: string;
  invoice_number: string;
  list_id: string | null;
  delivery_site_id: string | null;
  delivery_site_name: string;
  delivery_email: string;
  company_name: string;
  order_received_date: string | null;
  delivery_date: string | null;
  invoice_date: string | null;
  total_amount: number;
  sent_at: string | null;
  note: string | null;
  lines: BoxInvoiceLine[];
  created_at?: string;
  created_by?: string | null;
};

export const invoicingAPI = {
  listAccounts: () =>
    apiRequest<{ accounts: InvoicingAccount[] }>("/invoicing/accounts"),

  createAccount: (body: InvoicingAccountInput) =>
    apiRequest<{ account: InvoicingAccount }>("/invoicing/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateAccount: (id: string, body: InvoicingAccountInput) =>
    apiRequest<{ account: InvoicingAccount }>(
      `/invoicing/accounts/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  deleteAccount: (id: string) =>
    apiRequest<void>(`/invoicing/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  listDeliverySites: () =>
    apiRequest<{ sites: DeliverySite[] }>("/invoicing/delivery-sites"),

  createDeliverySite: (body: DeliverySiteInput) =>
    apiRequest<{ site: DeliverySite }>("/invoicing/delivery-sites", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateDeliverySite: (id: string, body: DeliverySiteInput) =>
    apiRequest<{ site: DeliverySite }>(
      `/invoicing/delivery-sites/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  deleteDeliverySite: (id: string) =>
    apiRequest<void>(`/invoicing/delivery-sites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  previewInvoiceNumber: (body: {
    delivery_site_id: string;
    invoice_date: string;
  }) =>
    apiRequest<{ invoice_number: string }>(
      "/invoicing/preview-invoice-number",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  getItemCandidates: () =>
    apiRequest<{ items: InvoicingItemCandidate[] }>(
      "/invoicing/item-candidates",
    ),

  listInvoiceLists: () =>
    apiRequest<{ lists: InvoiceListSummary[] }>("/invoicing/lists"),

  getInvoiceList: (listId: string) =>
    apiRequest<{
      list: InvoiceListDetail;
      items: InvoiceListItemRow[];
      delivery_site: DeliverySite | null;
    }>(`/invoicing/lists/${encodeURIComponent(listId)}`),

  createInvoiceList: (body: {
    name: string;
    delivery_site_id: string;
    item_ids: string[];
  }) =>
    apiRequest<{
      list: InvoiceListDetail;
      items: InvoiceListItemRow[];
      delivery_site: DeliverySite | null;
    }>("/invoicing/lists", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateInvoiceList: (
    listId: string,
    body: {
      name?: string;
      delivery_site_id?: string;
      lines?: InvoiceListLine[];
    },
  ) =>
    apiRequest<{
      list: InvoiceListDetail;
      items: InvoiceListItemRow[];
      delivery_site: DeliverySite | null;
    }>(`/invoicing/lists/${encodeURIComponent(listId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteInvoiceList: (listId: string) =>
    apiRequest<void>(`/invoicing/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
    }),

  getInvoiceListCosts: (listId: string) =>
    apiRequest<{ costs: Record<string, InvoicingCostBreakdown> }>(
      `/invoicing/lists/${encodeURIComponent(listId)}/costs`,
    ),

  listBoxInvoices: () =>
    apiRequest<{ invoices: BoxInvoiceSummary[] }>("/invoicing/invoices"),

  getBoxInvoice: (invoiceId: string) =>
    apiRequest<{ invoice: BoxInvoice }>(
      `/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    ),

  createBoxInvoice: (body: {
    list_id: string;
    delivery_site_id: string;
    order_received_date?: string | null;
    delivery_date?: string | null;
    invoice_date: string;
    invoice_number?: string;
    total_amount: number;
    lines: BoxInvoiceLine[];
    send?: boolean;
    pdf_base64?: string;
  }) =>
    apiRequest<{
      invoice: BoxInvoice;
      email_sent?: boolean;
      email_error?: string;
    }>("/invoicing/invoices", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  sendBoxInvoice: (invoiceId: string, pdfBase64: string) =>
    apiRequest<{ invoice: BoxInvoice }>(
      `/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
      {
        method: "POST",
        body: JSON.stringify({ pdf_base64: pdfBase64 }),
      },
    ),

  deleteBoxInvoice: (invoiceId: string) =>
    apiRequest<void>(`/invoicing/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "DELETE",
    }),
};
