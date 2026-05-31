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
  orderReceivedDate: string;
  deliveryDate: string;
  invoiceDate: string;
  rows: GeneratePreviewRow[];
  totalAmount: number;
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

export function boxInvoiceToPreviewPayload(
  invoice: BoxInvoice,
): GeneratePreviewPayload {
  const sorted = [...invoice.lines].sort((a, b) => a.sort_order - b.sort_order);
  return {
    listId: invoice.list_id ?? "",
    deliverySiteId: invoice.delivery_site_id ?? "",
    listName: invoice.invoice_number,
    deliverySiteName: invoice.delivery_site_name,
    orderReceivedDate: invoice.order_received_date ?? "",
    deliveryDate: invoice.delivery_date ?? "",
    invoiceDate: invoice.invoice_date ?? "",
    rows: sorted.map((line) => ({
      itemId: line.item_id,
      name: line.name,
      unitSize: line.unit_size,
      unitSizeUnit: line.unit_size_unit,
      units: line.units,
      costPerKg: line.cost,
      subTotal: line.sub_total,
    })),
    totalAmount: Number(invoice.total_amount),
  };
}

export function previewPayloadToBoxLines(
  payload: GeneratePreviewPayload,
): BoxInvoiceLine[] {
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
