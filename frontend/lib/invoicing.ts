import { apiRequest } from "./api";
import type { InvoicingCostBreakdown } from "./invoicingCalc";

export type InvoicingAccount = {
  id: string;
  company_id: string;
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
  company_id: string;
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
  delivery: boolean;
};

export type InvoiceListSummary = {
  id: string;
  name: string;
  delivery_site_id: string;
  wholesale_list_id: string | null;
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
  wholesale_list_id: string | null;
  lines: InvoiceListLine[];
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
};

export type OrderSummary = {
  id: string;
  invoice_number: string;
  order_created_date: string | null;
  company_name: string;
  total_amount: number;
  delivery_site_name: string;
  first_invoice_sent_at: string | null;
  account_id?: string | null;
  created_at?: string;
};

export type OrderLine = {
  item_id: string;
  name: string;
  unit_size: number;
  unit_size_unit: string;
  units: number;
  cost: number;
  sub_total: number;
  sort_order: number;
};

export type Order = {
  id: string;
  tenant_id: string;
  invoice_number: string;
  list_id: string | null;
  list_name: string;
  delivery_site_id: string | null;
  delivery_site_name: string;
  delivery_email: string;
  company_name: string;
  order_received_date: string | null;
  delivery_date: string | null;
  order_created_date: string | null;
  total_amount: number;
  first_invoice_sent_at: string | null;
  note: string | null;
  lines: OrderLine[];
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
    order_created_date: string;
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
    wholesale_list_id: string;
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
      wholesale_list_id?: string;
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

  listOrders: () =>
    apiRequest<{ orders: OrderSummary[] }>("/invoicing/orders"),

  getOrder: (orderId: string) =>
    apiRequest<{ order: Order }>(
      `/invoicing/orders/${encodeURIComponent(orderId)}`,
    ),

  createOrder: (body: {
    list_id: string;
    delivery_site_id: string;
    order_received_date?: string | null;
    delivery_date?: string | null;
    order_created_date: string;
    invoice_number?: string;
    total_amount: number;
    lines: OrderLine[];
    send?: boolean;
    pdf_base64?: string;
    /** YYYY-MM-DD; used when send is true (matches PDF Sent Date). */
    first_invoice_sent_at?: string;
  }) =>
    apiRequest<{
      order: Order;
      email_sent?: boolean;
      email_error?: string;
    }>("/invoicing/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  sendOrderInvoice: (
    orderId: string,
    pdfBase64: string,
    firstInvoiceSentAt?: string,
  ) =>
    apiRequest<{ order: Order }>(
      `/invoicing/orders/${encodeURIComponent(orderId)}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          pdf_base64: pdfBase64,
          ...(firstInvoiceSentAt?.trim()
            ? { first_invoice_sent_at: firstInvoiceSentAt.trim() }
            : {}),
        }),
      },
    ),

  deleteOrder: (orderId: string) =>
    apiRequest<void>(`/invoicing/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    }),

  listPaymentAccounts: () =>
    apiRequest<{ accounts: CompanyInvoicingAccount[] }>(
      "/invoicing/payments/accounts",
    ),

  listPayments: (accountId?: string) => {
    const qs = accountId?.trim()
      ? `?account_id=${encodeURIComponent(accountId.trim())}`
      : "";
    return apiRequest<{ payments: Payment[] }>(`/invoicing/payments${qs}`);
  },

  createPayment: (body: PaymentInput) =>
    apiRequest<{ payment: Payment }>("/invoicing/payments", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updatePayment: (paymentId: string, body: PaymentPatchInput) =>
    apiRequest<{ payment: Payment }>(
      `/invoicing/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  deletePayment: (paymentId: string) =>
    apiRequest<void>(`/invoicing/payments/${encodeURIComponent(paymentId)}`, {
      method: "DELETE",
    }),

  getBalanceLedger: (accountId: string) =>
    apiRequest<BalanceLedgerResponse>(
      `/invoicing/balance/ledger?account_id=${encodeURIComponent(accountId.trim())}`,
    ),

  listClosedPeriods: (accountId?: string) => {
    const qs = accountId?.trim()
      ? `?account_id=${encodeURIComponent(accountId.trim())}`
      : "";
    return apiRequest<{ closed_periods: ClosedPeriodEntry[] }>(
      `/invoicing/balance/closed-periods${qs}`,
    );
  },

  closeMonth: (period: string) =>
    apiRequest<CloseMonthResponse>("/invoicing/balance/close-month", {
      method: "POST",
      body: JSON.stringify({ period }),
    }),
};

export type CompanyInvoicingAccount = {
  id: string;
  company_id: string;
  company_name: string;
};

export type Payment = {
  id: string;
  company_id: string;
  account_id: string;
  account_name: string;
  amount: number;
  type: "payment" | "adjustment";
  note: string | null;
  payment_date: string | null;
  created_at: string;
  created_by: string | null;
};

export type PaymentType = "payment" | "adjustment";

export type PaymentInput = {
  account_id: string;
  amount: number;
  type?: PaymentType;
  payment_date?: string | null;
  note?: string | null;
};

export type PaymentPatchInput = {
  account_id?: string;
  amount?: number;
  payment_date?: string | null;
  note?: string | null;
};

export type LedgerEntryType =
  | "order"
  | "payment"
  | "adjustment"
  | "closing_balance";

export type LedgerRow = {
  id: string;
  date: string;
  amount: number | null;
  running_balance: number;
  type: LedgerEntryType;
  period?: string;
};

export type BalanceLedgerResponse = {
  account_id: string;
  account_name: string;
  current_balance: number;
  open_period: string;
  open_period_label: string;
  open_period_closed: boolean;
  ledger: LedgerRow[];
};

export type ClosedPeriodEntry = {
  account_id: string;
  period: string;
};

export type CloseMonthResponse = {
  period: string;
  period_label: string;
  closed_count: number;
};
