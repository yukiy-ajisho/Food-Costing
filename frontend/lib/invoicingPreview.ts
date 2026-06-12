import { formatInvoiceDateDisplay } from "@/lib/invoicingDateTime";

export type GeneratePreviewRow = {
  itemId: string;
  name: string;
  unitSize: number;
  unitSizeUnit: string;
  units: number;
  costPerKg: number;
  subTotal: number;
};

export type GeneratePreviewPayload = {
  listId: string;
  deliverySiteId: string;
  listName: string;
  deliverySiteName: string;
  invoiceNumber: string;
  orderReceivedDate: string;
  deliveryDate: string;
  /** YYYY-MM-DD — Order Creation Date (UI / API, not on Invoice PDF). */
  orderCreatedDate: string;
  /** Display on Invoice PDF Sent Date line. Generate preview uses today; saved orders use sent date or "—". */
  sentDateDisplay: string;
  rows: GeneratePreviewRow[];
  totalAmount: number;
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

export type OrderDetail = {
  id: string;
  tenant_id: string;
  invoice_number: string;
  list_id: string | null;
  list_name: string;
  delivery_site_id: string | null;
  delivery_site_name: string;
  delivery_email: string;
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

function formatSentDateDisplay(
  firstInvoiceSentAt: string | null | undefined,
): string {
  const formatted = formatInvoiceDateDisplay(firstInvoiceSentAt);
  return formatted || "—";
}

export function orderToPreviewPayload(order: OrderDetail): GeneratePreviewPayload {
  const sorted = [...order.lines].sort((a, b) => a.sort_order - b.sort_order);
  return {
    listId: order.list_id ?? "",
    deliverySiteId: order.delivery_site_id ?? "",
    listName: order.list_name?.trim() || "—",
    deliverySiteName: order.delivery_site_name,
    invoiceNumber: order.invoice_number,
    orderReceivedDate: order.order_received_date ?? "",
    deliveryDate: order.delivery_date ?? "",
    orderCreatedDate: formatInvoiceDateDisplay(order.order_created_date),
    sentDateDisplay: formatSentDateDisplay(order.first_invoice_sent_at),
    rows: sorted.map((line) => ({
      itemId: line.item_id,
      name: line.name,
      unitSize: line.unit_size,
      unitSizeUnit: line.unit_size_unit,
      units: line.units,
      costPerKg: line.cost,
      subTotal: line.sub_total,
    })),
    totalAmount: Number(order.total_amount),
  };
}

export function previewPayloadToOrderLines(
  payload: GeneratePreviewPayload,
): OrderLine[] {
  return payload.rows.map((row, sort_order) => ({
    item_id: row.itemId,
    name: row.name,
    unit_size: row.unitSize,
    unit_size_unit: row.unitSizeUnit,
    units: row.units,
    cost: row.costPerKg,
    sub_total: row.subTotal,
    sort_order,
  }));
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
