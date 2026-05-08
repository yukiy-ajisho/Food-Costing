"use client";

import {
  Fragment,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { UploadCloud } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  InvoiceBaseItemQuickEditModal,
  InvoiceNewBaseItemModal,
} from "@/components/InvoiceBaseItemModals";
import {
  ocrTestAPI,
  vendorProductsAPI,
  productMappingsAPI,
  priceEventsAPI,
  saveChangeHistory,
  type Vendor,
  type VendorProduct,
  type BaseItem,
} from "@/lib/api";
import { documentMetadataInvoicesAPI } from "@/lib/api/document-metadata-invoices";
import { documentInboxAPI } from "@/lib/api/document-inbox";
import {
  MASS_UNITS_ORDERED,
  NON_MASS_UNITS_ORDERED,
  APP_PURCHASE_UNITS_ORDERED,
  isNonMassUnit,
} from "@/lib/constants";
import {
  INVOICE_VENDORS_BROADCAST_CHANNEL,
  INVOICE_VENDORS_EMBED_SAVED,
} from "@/lib/invoiceEmbedMessages";
import { mergePdfFiles } from "@/lib/merge-pdfs";

const STEPS = ["Upload", "Review lines", "Match", "Confirm"] as const;

type MatchMode = "new" | "existing";

type ExistingPriceAction = "use_invoice" | "keep_current" | null;

/** "loose" = unit_purchased only, "case" = case_unit+case_purchased only, "mixed" = all three */
export type PurchaseMode = "loose" | "case" | "mixed";

export type InvoiceDraftRow = {
  localId: string;
  product_name: string;
  brand_name: string;
  purchase_quantity: number;
  purchase_unit: string;
  current_price: number;
  base_item_id: string;
  matchMode: MatchMode;
  linked_vvp_id: string;
  /** Confirm step: Existing rows only — A vs B (ledger row always inserted when importing). */
  existingPriceAction: ExistingPriceAction;
  /** Purchase type UI toggle */
  purchaseMode: PurchaseMode;
  case_unit: number | null;
  case_purchased: number | null;
  unit_purchased: number | null;
};

/** 単一サプライヤの請求まとまり（Import は常に1グループ） */
export type InvoiceVendorGroup = {
  localId: string;
  vendorId: string;
  vendorNameHint: string | null;
  /** YYYY-MM-DD; Review で編集 */
  invoiceDate: string;
  /** 請求書合計金額（文字列 input から）; OCR 初期値・ユーザー編集可 */
  totalAmount: string;
  rows: InvoiceDraftRow[];
};

type VendorProductRow = VendorProduct & {
  base_item_id: string;
};

const ALLOWED_PURCHASE_UNITS = new Set(APP_PURCHASE_UNITS_ORDERED);

function baseItemSupportsNonMassPurchase(b: BaseItem): boolean {
  const w = b.specific_weight;
  return w != null && Number(w) > 0;
}

function isNewRowBaseItemInvalidForInvoice(
  row: InvoiceDraftRow,
  baseItems: BaseItem[],
): boolean {
  if (row.matchMode !== "new") return false;
  if (!isNonMassUnit(row.purchase_unit)) return false;
  if (!row.base_item_id) return true;
  const b = baseItems.find((x) => x.id === row.base_item_id);
  if (!b) return true;
  return !baseItemSupportsNonMassPurchase(b);
}

function normText(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function purchaseQtyEqual(a: number, b: number): boolean {
  return Number(a) === Number(b);
}

/** Higher = closer to PDF vendor hint (for ordering / highlights). */
function scoreVendorForHint(hint: string | null, v: Vendor): number {
  if (!hint?.trim()) return 0;
  const h = normText(hint);
  const n = normText(v.name);
  if (!h || !n) return 0;
  if (n === h) return 100_000;
  if (n.includes(h)) return 80_000 + Math.min(h.length, 500);
  if (h.includes(n)) return 60_000 + Math.min(n.length, 500);
  return 0;
}

function buildVendorSelectOptions(
  hint: string | null,
  vendors: Vendor[],
): {
  id: string;
  name: string;
  searchText: string;
  matchCandidate: boolean;
}[] {
  const scored = vendors.map((v) => ({
    v,
    score: scoreVendorForHint(hint, v),
  }));
  const matched = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return normText(a.v.name).localeCompare(normText(b.v.name));
    });
  const unmatched = scored
    .filter((s) => s.score === 0)
    .sort((a, b) => normText(a.v.name).localeCompare(normText(b.v.name)));
  return [...matched, ...unmatched].map(({ v, score }) => ({
    id: v.id,
    name: v.name,
    searchText: v.name,
    matchCandidate: score > 0,
  }));
}

/** Hint vs vendor master: exact match, else a single loose substring match. */
function suggestVendorIdFromHint(
  hint: string | null,
  vendors: Vendor[],
): string {
  if (!hint?.trim()) return "";
  const h = normText(hint);
  if (!h) return "";
  const exact = vendors.find((v) => normText(v.name) === h);
  if (exact) return exact.id;
  const loose = vendors.filter((v) => {
    const n = normText(v.name);
    return n.includes(h) || h.includes(n);
  });
  if (loose.length === 1) return loose[0].id;
  return "";
}

/** Base item name contained in invoice product text (longest name wins). */
function suggestBaseItemIdFromProductName(
  productName: string,
  eligibleBaseItems: BaseItem[],
  purchaseUnit: string,
): string {
  const opts = buildBaseItemSelectOptions(
    productName,
    eligibleBaseItems,
    purchaseUnit,
  );
  if (isNonMassUnit(purchaseUnit)) {
    const ok = opts.find((o) => o.matchCandidate && !o.disabled);
    return ok?.id ?? "";
  }
  const matched = opts.find((o) => o.matchCandidate);
  return matched?.id ?? "";
}

function buildBaseItemSelectOptions(
  productName: string,
  baseItems: BaseItem[],
  invoicePurchaseUnit: string,
): {
  id: string;
  name: string;
  searchText: string;
  matchCandidate: boolean;
  disabled?: boolean;
}[] {
  const p = normText(productName);
  const warnRows = isNonMassUnit(invoicePurchaseUnit);
  const matched: BaseItem[] = [];
  const unmatched: BaseItem[] = [];
  for (const b of baseItems) {
    const bn = normText(b.name);
    if (bn.length > 0 && p.includes(bn)) matched.push(b);
    else unmatched.push(b);
  }
  matched.sort((a, b) => {
    const la = normText(a.name).length;
    const lb = normText(b.name).length;
    if (lb !== la) return lb - la;
    return normText(a.name).localeCompare(normText(b.name));
  });
  unmatched.sort((a, b) => normText(a.name).localeCompare(normText(b.name)));
  return [...matched, ...unmatched].map((b) => {
    const bn = normText(b.name);
    const warningDot = warnRows && !baseItemSupportsNonMassPurchase(b);
    return {
      id: b.id,
      name: b.name,
      searchText: b.name,
      matchCandidate: bn.length > 0 && p.includes(bn),
      disabled: warningDot ? true : undefined,
    };
  });
}

/**
 * Match scoring (tunable later): product name → brand → exact qty+unit.
 * Higher is better.
 */
function scoreVvpForInvoiceRow(
  row: InvoiceDraftRow,
  vp: VendorProduct,
): number {
  let score = 0;
  const rn = normText(row.product_name);
  const pn = normText(vp.product_name ?? "");
  if (pn && rn && (rn.includes(pn) || pn.includes(rn))) {
    score += 100_000;
  }
  const rb = normText(row.brand_name);
  const vb = normText(vp.brand_name ?? "");
  if (rb && vb && (rb === vb || rb.includes(vb) || vb.includes(rb))) {
    score += 10_000;
  }
  if (
    row.purchase_unit === vp.purchase_unit &&
    purchaseQtyEqual(row.purchase_quantity, vp.purchase_quantity)
  ) {
    score += 1_000;
  }
  // case_unit が一致する（両方 null = ばら同士、または同じ値）場合にボーナス
  if (row.case_unit === vp.case_unit) {
    score += 500;
  }
  return score;
}

function activeVvpsForVendor(
  vendorId: string,
  vendorProducts: VendorProductRow[],
): VendorProductRow[] {
  if (!vendorId) return [];
  return vendorProducts.filter(
    (vp) => vp.vendor_id === vendorId && !vp.deprecated,
  );
}

/** Non-deprecated VVPs for vendor, best invoice match first. */
function rankVvpsForInvoiceRow(
  row: InvoiceDraftRow,
  vendorId: string,
  vendorProducts: VendorProductRow[],
): VendorProductRow[] {
  const active = activeVvpsForVendor(vendorId, vendorProducts);
  const scored = active.map((vp) => ({
    vp,
    score: scoreVvpForInvoiceRow(row, vp),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = normText(a.vp.product_name);
    const bn = normText(b.vp.product_name);
    return an.localeCompare(bn);
  });
  return scored.map((s) => s.vp);
}

function buildLinkExistingOptions(
  row: InvoiceDraftRow,
  vendorId: string,
  vendorProducts: VendorProductRow[],
  baseItems: BaseItem[],
): {
  id: string;
  name: string;
  subLabel: string;
  hoverLabel: string;
  searchText: string;
  matchCandidate: boolean;
}[] {
  const ranked = rankVvpsForInvoiceRow(row, vendorId, vendorProducts);
  return ranked.map((vp) => {
    const bi = baseItems.find((b) => b.id === vp.base_item_id);
    const baseName = bi?.name ?? "Base item";
    const pn = vp.product_name?.trim() || "(no product name)";
    const brand = vp.brand_name?.trim() ?? "";
    const score = scoreVvpForInvoiceRow(row, vp);
    const searchText = [pn, brand].filter(Boolean).join(" ");
    const detail = `${vp.purchase_quantity} ${vp.purchase_unit}${vp.case_unit != null ? ` · ${vp.case_unit}/cs` : ""} · $${Number(vp.current_price).toFixed(2)}`;
    return {
      id: vp.id,
      name: pn,
      subLabel: detail,
      hoverLabel: baseName,
      searchText: searchText || pn,
      // Keep ranking/auto-selection logic, but do not highlight rows in yellow.
      matchCandidate: false,
    };
  });
}

/** Non-deprecated base items only (Match / suggest). */
function activeBaseItemsOnly(baseItems: BaseItem[]): BaseItem[] {
  return baseItems.filter((b) => b.deprecated == null);
}

/**
 * §9 auto match: non-deprecated VVPs for vendor, best score > 0 → existing + link; else new + base suggest.
 * When vendor is empty: clear links; clear base for new rows (per vendor-required UX).
 */
function autoRematchRowForVendor(
  row: InvoiceDraftRow,
  vendorId: string,
  vendorProducts: VendorProductRow[],
  eligibleBaseItems: BaseItem[],
): InvoiceDraftRow {
  if (!vendorId) {
    return {
      ...row,
      linked_vvp_id: "",
      base_item_id: row.matchMode === "new" ? "" : row.base_item_id,
    };
  }
  const ranked = rankVvpsForInvoiceRow(row, vendorId, vendorProducts);
  const best = ranked[0];
  const bestScore = best ? scoreVvpForInvoiceRow(row, best) : 0;
  if (bestScore > 0) {
    return {
      ...row,
      matchMode: "existing",
      linked_vvp_id: best!.id,
      base_item_id: "",
    };
  }
  return {
    ...row,
    matchMode: "new",
    linked_vvp_id: "",
    base_item_id: suggestBaseItemIdFromProductName(
      row.product_name,
      eligibleBaseItems,
      row.purchase_unit,
    ),
  };
}

function applyVendorHintAndRematchGroup(
  g: InvoiceVendorGroup,
  vendors: Vendor[],
  vendorProducts: VendorProductRow[],
  eligibleBaseItems: BaseItem[],
): InvoiceVendorGroup {
  let vendorId = g.vendorId;
  if (!vendorId && g.vendorNameHint) {
    const s = suggestVendorIdFromHint(g.vendorNameHint, vendors);
    if (s) vendorId = s;
  }
  return {
    ...g,
    vendorId,
    rows: g.rows.map((r) =>
      autoRematchRowForVendor(r, vendorId, vendorProducts, eligibleBaseItems),
    ),
  };
}

/** OCR が略語で返した場合の正規化（プロンプトはアプリ値を要求） */
function normalizePurchaseUnit(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "each";
  const u = raw.trim().toLowerCase();
  const aliases: Record<string, string> = {
    fz: "floz",
    "fl oz": "floz",
    fl_oz: "floz",
    gal: "gallon",
    gals: "gallon",
    l: "liter",
    litres: "liter",
    litre: "liter",
    liters: "liter",
    pounds: "lb",
    pound: "lb",
    lbs: "lb",
    "#": "lb",
  };
  const mapped = aliases[u] ?? u;
  return ALLOWED_PURCHASE_UNITS.has(mapped) ? mapped : "each";
}

function parseGeminiItem(item: unknown): InvoiceDraftRow {
  const o = item as Record<string, unknown>;
  const each = typeof o.unit_price_each === "number" ? o.unit_price_each : null;
  const unitPriceCase =
    typeof o.unit_price_case === "number" ? o.unit_price_case : null;
  const packCount =
    typeof o.pack_count === "number" && o.pack_count > 0 ? o.pack_count : null;
  const amount = typeof o.amount === "number" ? o.amount : null;
  const qtyCase =
    typeof o.qty_case === "number" && o.qty_case > 0 ? o.qty_case : null;

  let price = 0;
  if (each != null && each > 0) price = each;
  else if (
    unitPriceCase != null &&
    unitPriceCase > 0 &&
    packCount != null &&
    packCount > 0
  ) {
    price = unitPriceCase / packCount;
  } else if (unitPriceCase != null && unitPriceCase > 0) {
    price = unitPriceCase;
  } else if (amount != null && qtyCase != null && qtyCase > 0) {
    price = amount / qtyCase;
  } else if (amount != null && packCount != null && packCount > 0) {
    price = amount / packCount;
  }

  const purchase_unit = normalizePurchaseUnit(o.purchase_unit);

  const pqRaw = o.purchase_quantity;
  let purchase_quantity = 1;
  if (typeof pqRaw === "number" && Number.isFinite(pqRaw) && pqRaw > 0) {
    purchase_quantity = pqRaw;
  } else if (
    typeof o.pack_size_value === "number" &&
    o.pack_size_value > 0 &&
    purchase_unit !== "each"
  ) {
    purchase_quantity = o.pack_size_value;
  }

  const product =
    (typeof o.product_name === "string" && o.product_name.trim()) ||
    (typeof o.description_raw === "string" && o.description_raw.trim()) ||
    "";
  const brand =
    typeof o.brand_name === "string" && o.brand_name.trim()
      ? (o.brand_name as string)
      : "";

  const toPositiveInt = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const ocrCaseUnit = toPositiveInt(o.case_unit);
  const ocrCasePurchased = toPositiveInt(o.case_purchased);
  const ocrUnitPurchased = toPositiveInt(o.unit_purchased);

  let purchaseMode: PurchaseMode = "loose";
  if (ocrCaseUnit != null && ocrUnitPurchased != null) purchaseMode = "mixed";
  else if (ocrCaseUnit != null) purchaseMode = "case";

  return {
    localId: crypto.randomUUID(),
    product_name: product,
    brand_name: brand,
    purchase_quantity,
    purchase_unit,
    current_price: Number.isFinite(price) ? price : 0,
    base_item_id: "",
    matchMode: "new",
    linked_vvp_id: "",
    existingPriceAction: null,
    purchaseMode,
    case_unit: ocrCaseUnit,
    case_purchased: ocrCasePurchased,
    unit_purchased: ocrUnitPurchased ?? (ocrCaseUnit == null ? 1 : null),
  };
}

/** Same line key for duplicate detection (purchase_unit distinguishes e.g. L vs g). */
function fingerprintInvoiceLineRaw(item: unknown): string {
  const row = parseGeminiItem(item);
  const price = Math.round(Number(row.current_price) * 10000) / 10000;
  return JSON.stringify({
    p: normText(row.product_name),
    b: normText(row.brand_name),
    q: row.purchase_quantity,
    u: row.purchase_unit,
    price,
    cu: row.case_unit,
    cp: row.case_purchased,
    up: row.unit_purchased,
    m: row.purchaseMode,
  });
}

function parseYyyyMmDd(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}

/** Local calendar YYYY-MM-DD from an ISO timestamp (browser timezone). */
function calendarYmdFromIsoLocal(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rowIsStaleInvoiceWarning(
  row: InvoiceDraftRow,
  group: InvoiceVendorGroup,
  vendorProducts: VendorProductRow[],
): boolean {
  if (row.matchMode !== "existing" || !row.linked_vvp_id) return false;
  if (!group.invoiceDate) return false;
  const vvp = vendorProducts.find((vp) => vp.id === row.linked_vvp_id);
  const vYmd = calendarYmdFromIsoLocal(vvp?.updated_at);
  if (!vYmd) return false;
  return group.invoiceDate < vYmd;
}

/** Confirm step: Existing rows show master VVP identity; New rows use invoice draft. */
function linkedVvpForConfirmRow(
  row: InvoiceDraftRow,
  vendorProducts: VendorProductRow[],
): VendorProductRow | undefined {
  if (row.matchMode !== "existing" || !row.linked_vvp_id) return undefined;
  return vendorProducts.find((vp) => vp.id === row.linked_vvp_id);
}

type StructuredJson = NonNullable<
  Awaited<ReturnType<typeof ocrTestAPI.extractPdf>>["structured_json"]
>;

/** Flat line list: new API uses `lines`; legacy may use `items` or `vendor_blocks`. */
function linesFromStructured(sj: StructuredJson): unknown[] {
  if (Array.isArray(sj.lines) && sj.lines.length > 0) return sj.lines;
  if (Array.isArray(sj.items) && sj.items.length > 0) return sj.items;
  if (sj.vendor_blocks && sj.vendor_blocks.length > 0) {
    return sj.vendor_blocks.flatMap((b) =>
      Array.isArray(b.lines) ? b.lines : [],
    );
  }
  return [];
}

const MAX_INVOICE_SOURCE_PDFS = 10;
const MAX_INVOICE_SOURCE_PDF_TOTAL_BYTES = 18 * 1024 * 1024;

function validateExtractedInvoiceStructured(
  sj: StructuredJson | null | undefined,
): string | null {
  if (!sj) return "No structured data returned from extraction.";
  const hints = sj.distinct_vendor_name_hints;
  if (Array.isArray(hints) && hints.length > 1) {
    return "Multiple suppliers were detected. Use one supplier per import, or split the document.";
  }
  const invDates = sj.distinct_invoice_dates;
  if (Array.isArray(invDates) && invDates.length > 1) {
    return "Conflicting invoice dates were detected across the document.";
  }
  const lines = linesFromStructured(sj);
  if (lines.length === 0) {
    return "No line items could be parsed from this PDF.";
  }
  const seen = new Set<string>();
  for (const line of lines) {
    const fp = fingerprintInvoiceLineRaw(line);
    if (seen.has(fp)) {
      return "Duplicate line items (identical extracted rows) were detected.";
    }
    seen.add(fp);
  }
  return null;
}

function vendorGroupFromStructured(
  sj: StructuredJson,
  vendors: Vendor[],
  emptyVendorId: boolean,
): InvoiceVendorGroup {
  const lines = linesFromStructured(sj);
  const hint = sj.vendor_name_hint ?? null;
  return {
    localId: crypto.randomUUID(),
    vendorId: emptyVendorId ? "" : suggestVendorIdFromHint(hint, vendors),
    vendorNameHint: hint,
    invoiceDate: parseYyyyMmDd(sj.invoice_date),
    totalAmount:
      sj.total_amount != null && sj.total_amount > 0
        ? String(sj.total_amount)
        : "",
    rows: lines.map(parseGeminiItem),
  };
}

interface InvoiceImportModalProps {
  open: boolean;
  onClose: () => void;
  vendors: Vendor[];
  baseItems: BaseItem[];
  vendorProducts: VendorProductRow[];
  onImportComplete: () => Promise<void>;
  /** After vendors-embed tab save — update vendor list only (full origin check in handler). */
  onVendorsUpdated?: (vendors: Vendor[]) => void;
  /** Refetch base items + vendor products (e.g. after base item modal save). */
  onInvoiceLookupsRefresh?: () => void | Promise<void>;
  /**
   * Document Box から開く場合に渡す document_metadata_invoices.id。
   * 指定時はファイル選択ステップをスキップし、R2 から画像を取得して Extract へ進む。
   * 通常の Invoice Import フローでは undefined のまま（動作に一切影響しない）。
   */
  initialDocumentId?: string;
  /** 新フロー: document_inbox.id（Import 完了で inbox を reviewed にする）。 */
  initialInboxId?: string;
  /** R2 オブジェクトキー（presigned URL 取得）。 */
  initialDocumentValue?: string;
}

export function InvoiceImportModal({
  open,
  onClose,
  vendors,
  baseItems,
  vendorProducts,
  onImportComplete,
  onVendorsUpdated,
  onInvoiceLookupsRefresh,
  initialDocumentId,
  initialInboxId,
  initialDocumentValue,
}: InvoiceImportModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [step, setStep] = useState(1);
  const [groups, setGroups] = useState<InvoiceVendorGroup[]>([]);
  /** Selected PDFs (order = merge order). Merged only for extract and again on Import confirm. */
  const [sourcePdfFiles, setSourcePdfFiles] = useState<File[]>([]);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [groupVendorSyncLoading, setGroupVendorSyncLoading] = useState<
    Record<string, boolean>
  >({});
  const [quickEditBaseItemId, setQuickEditBaseItemId] = useState<string | null>(
    null,
  );
  const [newBaseItemModalOpen, setNewBaseItemModalOpen] = useState(false);
  const [step3ValidationAttempted, setStep3ValidationAttempted] =
    useState(false);
  const [activeNumericEditKey, setActiveNumericEditKey] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const prevStepRef = useRef(step);

  const bumpGroupVendorLoading = useCallback((groupLocalId: string) => {
    setGroupVendorSyncLoading((prev) => ({ ...prev, [groupLocalId]: true }));
    window.setTimeout(() => {
      setGroupVendorSyncLoading((prev) => ({ ...prev, [groupLocalId]: false }));
    }, 280);
  }, []);

  const unitOptions = useMemo(
    () => [...MASS_UNITS_ORDERED, ...NON_MASS_UNITS_ORDERED],
    [],
  );

  const activeBaseItems = useMemo(
    () => activeBaseItemsOnly(baseItems),
    [baseItems],
  );

  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSourcePdfFiles([]);
    setExtractError(null);
    setGroups([]);
    dragDepthRef.current = 0;
    setIsDragging(false);
    setGroupVendorSyncLoading({});
    prevStepRef.current = 1;
  }, [open]);

  // Document Boxから開いた場合: presigned URL で画像を取得して Extract まで自動進行
  useEffect(() => {
    if (!open || !initialDocumentValue) return;
    const fromInbox = Boolean(initialInboxId);
    const fromLegacy = Boolean(initialDocumentId);
    if (!fromInbox && !fromLegacy) return;

    let cancelled = false;
    setExtractLoading(true);
    setExtractError(null);

    (async () => {
      try {
        const { url } = fromInbox
          ? await documentInboxAPI.getDocumentUrl(initialDocumentValue)
          : await documentMetadataInvoicesAPI.getDocumentUrl(
              initialDocumentValue,
            );
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch document from storage");
        const blob = await res.blob();
        const fetchedFile = new File(
          [blob],
          initialDocumentValue.split("/").pop() ?? "invoice",
          { type: blob.type || "application/pdf" },
        );
        if (cancelled) return;
        setSourcePdfFiles([fetchedFile]);
        const mergedForExtract = await mergePdfFiles([fetchedFile]);
        const result = await ocrTestAPI.extractPdf(mergedForExtract);
        if (cancelled) return;
        const sj = result.structured_json;
        const validationErr = validateExtractedInvoiceStructured(sj);
        if (validationErr) {
          setExtractError(validationErr);
          return;
        }
        setGroups([vendorGroupFromStructured(sj!, vendors, false)]);
        setStep(2);
      } catch (e: unknown) {
        if (!cancelled) {
          setExtractError(
            e instanceof Error ? e.message : "Failed to load document",
          );
        }
      } finally {
        if (!cancelled) setExtractLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDocumentId, initialInboxId, initialDocumentValue]);

  useEffect(() => {
    if (step === 4 && prevStepRef.current !== 4) {
    }
    prevStepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const applyVendors = (
      data: {
        type?: string;
        vendors?: Vendor[];
      } | null,
    ) => {
      if (
        data?.type === INVOICE_VENDORS_EMBED_SAVED &&
        Array.isArray(data.vendors)
      ) {
        onVendorsUpdated?.(data.vendors);
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      applyVendors(e.data as { type?: string; vendors?: Vendor[] } | null);
    };
    window.addEventListener("message", onMsg);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(INVOICE_VENDORS_BROADCAST_CHANNEL);
      bc.onmessage = (ev: MessageEvent) => {
        applyVendors(ev.data as { type?: string; vendors?: Vendor[] } | null);
      };
    } catch {
      /* BroadcastChannel unsupported */
    }
    return () => {
      window.removeEventListener("message", onMsg);
      bc?.close();
    };
  }, [open, onVendorsUpdated]);

  const clearPdfSelection = useCallback(() => {
    setSourcePdfFiles([]);
    setExtractError(null);
  }, []);

  const addPdfFiles = useCallback((incoming: File[]) => {
    const pdfs = incoming.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length === 0) {
      setExtractError("Please choose PDF file(s).");
      return;
    }
    setSourcePdfFiles((prev) => {
      const next = [...prev, ...pdfs];
      if (next.length > MAX_INVOICE_SOURCE_PDFS) {
        queueMicrotask(() =>
          setExtractError(
            `At most ${MAX_INVOICE_SOURCE_PDFS} PDF files are allowed.`,
          ),
        );
        return prev;
      }
      const total = next.reduce((s, f) => s + f.size, 0);
      if (total > MAX_INVOICE_SOURCE_PDF_TOTAL_BYTES) {
        queueMicrotask(() =>
          setExtractError(
            "Total PDF size is too large (max ~18 MB for this import).",
          ),
        );
        return prev;
      }
      queueMicrotask(() => setExtractError(null));
      return next;
    });
  }, []);

  const removePdfAtIndex = useCallback((index: number) => {
    setSourcePdfFiles((prev) => prev.filter((_, i) => i !== index));
    setExtractError(null);
  }, []);

  const newCount = allRows.filter((r) => r.matchMode === "new").length;
  const updateCount = allRows.filter((r) => r.matchMode === "existing").length;

  const step1CanClickNext = sourcePdfFiles.length > 0 && !extractLoading;

  const canGoStep3 =
    groups.length > 0 &&
    groups.every(
      (g) =>
        g.rows.length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(g.invoiceDate.trim()) &&
        Number.isFinite(Number(g.totalAmount)) &&
        Number(g.totalAmount) > 0 &&
        g.rows.every(
          (r) =>
            r.product_name.trim() !== "" &&
            Number.isFinite(r.purchase_quantity) &&
            r.purchase_quantity > 0 &&
            r.purchase_unit !== "" &&
            Number.isFinite(r.current_price) &&
            r.current_price > 0,
        ),
    );

  const allGroupsHaveVendor = groups.every((g) => g.vendorId !== "");

  /** Step 3: vendors chosen and each row has a target id (does not check non-mass specific_weight). */
  const matchStep3StructuralComplete =
    allGroupsHaveVendor &&
    groups.every((g) =>
      g.rows.every((r) =>
        r.matchMode === "new" ? r.base_item_id !== "" : r.linked_vvp_id !== "",
      ),
    );
  const showStep3RequiredErrors = step === 3 && step3ValidationAttempted;

  const hasInvalidNonMassNewBaseItems = groups.some((g) =>
    g.rows.some((r) => isNewRowBaseItemInvalidForInvoice(r, baseItems)),
  );

  const isNextDisabled =
    (step === 1 && !step1CanClickNext) ||
    (step === 2 && !canGoStep3) ||
    (step === 3 && !allGroupsHaveVendor);

  useEffect(() => {
    if (step !== 3 && step3ValidationAttempted) {
      setStep3ValidationAttempted(false);
    }
  }, [step, step3ValidationAttempted]);

  const setGroupInvoiceDate = useCallback(
    (groupLocalId: string, invoiceDate: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.localId === groupLocalId ? { ...g, invoiceDate } : g,
        ),
      );
    },
    [],
  );

  const setGroupVendorId = useCallback(
    (groupLocalId: string, vendorId: string) => {
      bumpGroupVendorLoading(groupLocalId);
      setGroups((prev) =>
        prev.map((g) => {
          if (g.localId !== groupLocalId) return g;
          return {
            ...g,
            vendorId,
            rows: g.rows.map((r) =>
              autoRematchRowForVendor(
                r,
                vendorId,
                vendorProducts,
                activeBaseItems,
              ),
            ),
          };
        }),
      );
    },
    [bumpGroupVendorLoading, vendorProducts, activeBaseItems],
  );

  const handleAdvanceFromStep1 = async () => {
    if (sourcePdfFiles.length === 0 || extractLoading) return;
    dragDepthRef.current = 0;
    setIsDragging(false);
    setExtractLoading(true);
    setExtractError(null);
    try {
      const mergedForExtract = await mergePdfFiles(sourcePdfFiles);
      const result = await ocrTestAPI.extractPdf(mergedForExtract);
      const sj = result.structured_json;
      const validationErr = validateExtractedInvoiceStructured(sj);
      if (validationErr) {
        setExtractError(validationErr);
        return;
      }
      if (!sj) {
        setExtractError("No structured data returned from extraction.");
        return;
      }
      setGroups([vendorGroupFromStructured(sj, vendors, true)]);
      setStep(2);
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractLoading(false);
    }
  };

  const addEmptyRowToGroup = (groupLocalId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.localId === groupLocalId
          ? {
              ...g,
              rows: [
                ...g.rows,
                {
                  localId: crypto.randomUUID(),
                  product_name: "",
                  brand_name: "",
                  purchase_quantity: 1,
                  purchase_unit: "each",
                  current_price: 0,
                  base_item_id: "",
                  matchMode: "new" as const,
                  linked_vvp_id: "",
                  existingPriceAction: null,
                  purchaseMode: "loose" as PurchaseMode,
                  case_unit: null,
                  case_purchased: null,
                  unit_purchased: 1,
                },
              ],
            }
          : g,
      ),
    );
  };

  const removeRow = (rowLocalId: string) => {
    setGroups((prev) =>
      prev
        .map((g) => ({
          ...g,
          rows: g.rows.filter((r) => r.localId !== rowLocalId),
        }))
        .filter((g) => g.rows.length > 0),
    );
  };

  const updateRow = (rowLocalId: string, patch: Partial<InvoiceDraftRow>) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        rows: g.rows.map((r) =>
          r.localId === rowLocalId ? { ...r, ...patch } : r,
        ),
      })),
    );
  };

  const handleImport = async () => {
    for (const g of groups) {
      if (!g.vendorId) {
        alert("Each supplier block needs a vendor.");
        return;
      }
      for (const r of g.rows) {
        if (r.matchMode === "new") {
          if (!r.base_item_id) {
            alert("Each new line needs a base item.");
            return;
          }
        } else if (!r.linked_vvp_id) {
          alert("Each existing line needs a linked vendor item.");
          return;
        }
        if (!(r.current_price > 0)) {
          alert("Price must be greater than 0 for every line.");
          return;
        }
        if (isNewRowBaseItemInvalidForInvoice(r, baseItems)) {
          alert(
            "For non-mass units, each new line must use a base item with specific weight set. Edit the base item or pick another one.",
          );
          return;
        }
      }
    }

    setImportLoading(true);
    try {
      // PDF を1回だけ R2 → document_metadata_invoices に保存して invoiceId を取得
      // （全グループ・全行で同じ invoice ドキュメントを共有）
      // Document Box 経由もモーダル最終 Import 時に作成する。
      let invoiceDocId: string | null = initialDocumentId ?? null;
      if (initialInboxId) {
        const firstGroup = groups[0];
        await documentInboxAPI.classify(initialInboxId, "invoice");
        const created = await documentInboxAPI.createInvoiceMetadata(
          initialInboxId,
          {
            vendor_id: firstGroup.vendorId,
            invoice_date: firstGroup.invoiceDate.trim(),
            total_amount: Number(firstGroup.totalAmount),
          },
        );
        invoiceDocId = created.invoice_id;
      } else if (!invoiceDocId && sourcePdfFiles.length > 0) {
        // 通常の Import Invoice フロー: Confirm 時に PDF を結合してから1回アップロード
        const firstGroup = groups[0];
        const mergedUpload = await mergePdfFiles(sourcePdfFiles);
        const uploadResult = await documentMetadataInvoicesAPI.uploadDocument({
          vendorId: firstGroup.vendorId,
          invoiceDate: firstGroup.invoiceDate.trim(),
          totalAmount: Number(firstGroup.totalAmount),
          file: mergedUpload,
        });
        invoiceDocId = uploadResult.id;
      }

      const changedVendorProductIds: string[] = [];
      for (const g of groups) {
        for (const r of g.rows) {
          if (r.matchMode === "existing") {
            await priceEventsAPI.recordInvoice(
              r.linked_vvp_id,
              r.current_price,
              {
                applyToCurrentPrice: r.existingPriceAction !== "keep_current",
                invoiceDate: g.invoiceDate.trim(),
                invoiceId: invoiceDocId,
                caseUnit: r.case_unit,
                casePurchased: r.case_purchased,
                unitPurchased: r.unit_purchased,
              },
            );
            changedVendorProductIds.push(r.linked_vvp_id);
          } else {
            const newVp = await vendorProductsAPI.create({
              vendor_id: g.vendorId,
              product_name: r.product_name.trim() || null,
              brand_name: r.brand_name.trim() || null,
              purchase_unit: r.purchase_unit,
              purchase_quantity: r.purchase_quantity,
              current_price: r.current_price,
              case_unit: r.case_unit,
              initial_price_event_source: "invoice",
              invoice_date: g.invoiceDate.trim(),
              invoice_id: invoiceDocId,
              initial_case_purchased: r.case_purchased,
              initial_unit_purchased: r.unit_purchased,
            });
            await productMappingsAPI.create({
              base_item_id: r.base_item_id,
              virtual_product_id: newVp.id,
            });
            changedVendorProductIds.push(newVp.id);
          }
        }
      }
      if (changedVendorProductIds.length > 0) {
        saveChangeHistory({
          changed_vendor_product_ids: changedVendorProductIds,
        });
      }
      if (initialInboxId) {
        await documentInboxAPI.markReviewed(initialInboxId);
      }
      await onImportComplete();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Import failed: ${msg}`);
    } finally {
      setImportLoading(false);
    }
  };

  if (!open) return null;

  const shell = isDark
    ? "bg-slate-800 border-slate-600 text-slate-100"
    : "bg-white border-gray-200 text-gray-900";
  const border = isDark ? "border-slate-600" : "border-gray-200";
  const inputCls = isDark
    ? "bg-slate-700 border-slate-600 text-slate-100"
    : "bg-white border-gray-300 text-gray-900";
  const muted = isDark ? "text-slate-400" : "text-gray-500";
  const thCls = isDark ? "text-slate-300" : "text-gray-600";

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`flex max-h-[92vh] w-full max-w-[min(100vw-2rem,1400px)] flex-col rounded-xl border shadow-xl ${shell}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b px-5 py-4 ${border}`}
        >
          <h2 className="text-lg font-semibold">Import invoice</h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              isDark
                ? "bg-slate-700 hover:bg-slate-600"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            Close
          </button>
        </div>

        <div
          className={`shrink-0 border-b px-5 py-4 ${border} ${
            isDark ? "bg-slate-900/40" : "bg-gray-100"
          }`}
        >
          <nav aria-label="Import progress">
            <div className="flex items-center">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const isCompleted = step > n;
                const isActive = step === n;

                return (
                  <div key={label} className="flex flex-1 items-center">
                    <div className="relative flex flex-1 flex-col items-center">
                      <div className="relative z-10">
                        {isActive && (
                          <div
                            className={`absolute inset-0 animate-pulse rounded-full ring-8 ${
                              isDark
                                ? "shadow-lg shadow-blue-500/20 ring-blue-500/35"
                                : "shadow-lg shadow-blue-500/50 ring-blue-300"
                            }`}
                          />
                        )}
                        <div
                          className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 ${
                            isActive || isCompleted
                              ? "bg-blue-500"
                              : isDark
                                ? "border-2 border-blue-400 bg-slate-800"
                                : "border-2 border-blue-300 bg-white"
                          }`}
                        >
                          <span
                            className={`text-sm font-semibold ${
                              isActive || isCompleted
                                ? "text-white"
                                : isDark
                                  ? "text-blue-400"
                                  : "text-blue-500"
                            }`}
                          >
                            {n}
                          </span>
                        </div>
                      </div>

                      {i < STEPS.length - 1 && (
                        <div
                          className={`absolute top-4 left-1/2 h-0.5 ${
                            isCompleted
                              ? "bg-blue-500"
                              : isDark
                                ? "bg-slate-600"
                                : "bg-blue-300"
                          }`}
                          style={{
                            width: "calc(100% - 16px)",
                            marginLeft: "16px",
                          }}
                          aria-hidden
                        />
                      )}

                      <div className="mt-2 text-center">
                        <span
                          className={`text-xs font-medium ${
                            isActive
                              ? isDark
                                ? "text-blue-300"
                                : "text-blue-700"
                              : isCompleted
                                ? isDark
                                  ? "text-blue-400"
                                  : "text-blue-600"
                                : muted
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div
                className={`rounded-xl border p-4 ${
                  isDark
                    ? "border-slate-600 bg-slate-900/40"
                    : "border-gray-200 bg-gray-100"
                }`}
              >
                <p className={`mb-3 text-sm font-medium ${thCls}`}>Upload</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="sr-only"
                  disabled={extractLoading}
                  onChange={(e) => {
                    const list = e.target.files;
                    if (list?.length) addPdfFiles(Array.from(list));
                    e.target.value = "";
                  }}
                />
                <div
                  role={extractLoading ? undefined : "button"}
                  tabIndex={extractLoading ? -1 : 0}
                  aria-disabled={extractLoading}
                  onKeyDown={(e) => {
                    if (extractLoading) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onClick={() => {
                    if (extractLoading) return;
                    fileInputRef.current?.click();
                  }}
                  onDragEnter={(e) => {
                    if (extractLoading) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dragDepthRef.current += 1;
                    setIsDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (extractLoading) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dragDepthRef.current -= 1;
                    if (dragDepthRef.current <= 0) {
                      dragDepthRef.current = 0;
                      setIsDragging(false);
                    }
                  }}
                  onDragOver={(e) => {
                    if (extractLoading) return;
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    if (extractLoading) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dragDepthRef.current = 0;
                    setIsDragging(false);
                    const list = e.dataTransfer.files;
                    if (list?.length) addPdfFiles(Array.from(list));
                  }}
                  className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition-colors outline-none ${
                    extractLoading
                      ? isDark
                        ? "cursor-not-allowed border-slate-600 bg-slate-800/20 opacity-60"
                        : "cursor-not-allowed border-gray-200 bg-gray-100 opacity-60"
                      : `cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                          isDark
                            ? `border-slate-500 ${
                                isDragging
                                  ? "border-blue-400 bg-slate-700/50"
                                  : "bg-slate-800/30 hover:border-slate-400"
                              }`
                            : `border-gray-300 ${
                                isDragging
                                  ? "border-blue-400 bg-blue-50/80"
                                  : "bg-white hover:border-gray-400"
                              }`
                        }`
                  }`}
                >
                  <UploadCloud
                    className={`h-9 w-9 shrink-0 ${
                      isDark ? "text-slate-400" : "text-gray-400"
                    }`}
                    strokeWidth={1.25}
                    aria-hidden
                  />
                  <span className={`text-center text-sm ${muted}`}>
                    {extractLoading
                      ? "Extracting…"
                      : "Drop PDFs here or click to add (multiple allowed)"}
                  </span>
                  {sourcePdfFiles.length > 0 ? (
                    <div className="mt-2 w-full max-w-md space-y-1.5">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearPdfSelection();
                          }}
                          className={`text-xs font-medium underline-offset-2 hover:underline ${
                            isDark
                              ? "text-slate-400 hover:text-slate-300"
                              : "text-gray-600 hover:text-gray-800"
                          }`}
                        >
                          Clear all
                        </button>
                      </div>
                      <ul className="max-h-32 space-y-1 overflow-y-auto text-left text-sm">
                        {sourcePdfFiles.map((f, i) => (
                          <li
                            key={`${f.name}-${i}-${f.size}`}
                            className={`flex items-center gap-2 rounded border px-2 py-1 ${
                              isDark
                                ? "border-slate-600 bg-slate-900/60"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <span
                              className={`min-w-0 flex-1 truncate font-medium ${
                                isDark ? "text-slate-200" : "text-gray-800"
                              }`}
                              title={f.name}
                            >
                              {i + 1}. {f.name}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removePdfAtIndex(i);
                              }}
                              className={`shrink-0 text-xs underline-offset-2 hover:underline ${
                                isDark
                                  ? "text-amber-300 hover:text-amber-200"
                                  : "text-amber-700 hover:text-amber-900"
                              }`}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
              {extractError && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    isDark
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  {extractError}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              {groups.map((g) => (
                <div
                  key={g.localId}
                  className={`rounded-xl border p-4 ${
                    isDark
                      ? "border-slate-600 bg-slate-900/40"
                      : "border-gray-200 bg-gray-100"
                  }`}
                >
                  <div className={`mb-3 space-y-2 border-b pb-3 ${border}`}>
                    <p className={`text-sm font-semibold ${thCls}`}>
                      Invoice
                      <span className={`font-normal ${muted}`}>
                        {g.vendorNameHint
                          ? ` · ${g.vendorNameHint}`
                          : " · Supplier unknown"}
                      </span>
                    </p>
                    <label
                      className={`flex flex-wrap items-center gap-2 text-sm ${thCls}`}
                    >
                      <span>Invoice date</span>
                      <input
                        type="date"
                        className={`rounded border px-2 py-1 text-sm ${inputCls}`}
                        value={g.invoiceDate}
                        onChange={(e) =>
                          setGroupInvoiceDate(g.localId, e.target.value)
                        }
                      />
                    </label>
                    <label
                      className={`flex flex-wrap items-center gap-2 text-sm ${thCls}`}
                    >
                      <span>Total price</span>
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        placeholder="0.00"
                        className={`w-28 rounded border px-2 py-1 text-sm ${inputCls}`}
                        value={g.totalAmount}
                        onChange={(e) =>
                          setGroups((prev) =>
                            prev.map((x) =>
                              x.localId === g.localId
                                ? { ...x, totalAmount: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div
                    className={`overflow-hidden rounded-lg border ${border} ${
                      isDark ? "bg-slate-950/20" : "bg-white"
                    }`}
                  >
                    <div
                      className={`flex justify-end border-b px-2 py-2 ${
                        isDark
                          ? "border-slate-600 bg-slate-800/90"
                          : "border-gray-200 bg-gray-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => addEmptyRowToGroup(g.localId)}
                        className={`whitespace-nowrap text-sm font-medium ${
                          isDark
                            ? "text-blue-400 hover:text-blue-300"
                            : "text-blue-600 hover:text-blue-700"
                        }`}
                      >
                        + Add item
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr
                            className={
                              isDark ? "bg-slate-700/80" : "bg-gray-100"
                            }
                          >
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              #
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Product
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Brand
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Size
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Unit
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Price{" "}
                              <span className="text-xs font-normal opacity-50">
                                / piece
                              </span>
                            </th>
                            <th className={`px-2 py-2 text-left ${thCls}`}>
                              Purchase
                            </th>
                            <th className={`px-2 py-2 ${thCls}`} />
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r, idx) => (
                            <tr
                              key={r.localId}
                              className={`border-t ${border}`}
                            >
                              <td className="px-2 py-1.5">{idx + 1}</td>
                              <td className="px-2 py-1.5">
                                <input
                                  className={`w-full rounded border px-2 py-1 text-sm ${inputCls}`}
                                  value={r.product_name}
                                  onChange={(e) =>
                                    updateRow(r.localId, {
                                      product_name: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  className={`w-full rounded border px-2 py-1 text-sm ${inputCls}`}
                                  value={r.brand_name}
                                  onChange={(e) =>
                                    updateRow(r.localId, {
                                      brand_name: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  min={0.0001}
                                  step="any"
                                  className={`no-spinner w-20 rounded border px-2 py-1 text-right text-sm [font-variant-numeric:tabular-nums] ${inputCls}`}
                                  value={
                                    activeNumericEditKey ===
                                    `${r.localId}:purchase_quantity`
                                      ? r.purchase_quantity
                                      : Number(
                                          r.purchase_quantity || 0,
                                        ).toFixed(2)
                                  }
                                  onFocus={() =>
                                    setActiveNumericEditKey(
                                      `${r.localId}:purchase_quantity`,
                                    )
                                  }
                                  onChange={(e) =>
                                    updateRow(r.localId, {
                                      purchase_quantity: Number(e.target.value),
                                    })
                                  }
                                  onBlur={() => {
                                    updateRow(r.localId, {
                                      purchase_quantity: Number(
                                        Number(
                                          r.purchase_quantity || 0,
                                        ).toFixed(2),
                                      ),
                                    });
                                    setActiveNumericEditKey((prev) =>
                                      prev === `${r.localId}:purchase_quantity`
                                        ? null
                                        : prev,
                                    );
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <select
                                  className={`rounded border px-2 py-1 text-sm ${inputCls}`}
                                  value={r.purchase_unit}
                                  onChange={(e) =>
                                    updateRow(r.localId, {
                                      purchase_unit: e.target.value,
                                    })
                                  }
                                >
                                  {unitOptions.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  className={`no-spinner w-24 rounded border px-2 py-1 text-right text-sm [font-variant-numeric:tabular-nums] ${inputCls}`}
                                  value={
                                    activeNumericEditKey ===
                                    `${r.localId}:current_price`
                                      ? r.current_price || ""
                                      : Number(r.current_price || 0).toFixed(2)
                                  }
                                  onFocus={() =>
                                    setActiveNumericEditKey(
                                      `${r.localId}:current_price`,
                                    )
                                  }
                                  onChange={(e) =>
                                    updateRow(r.localId, {
                                      current_price: Number(e.target.value),
                                    })
                                  }
                                  onBlur={() => {
                                    updateRow(r.localId, {
                                      current_price: Number(
                                        Number(r.current_price || 0).toFixed(2),
                                      ),
                                    });
                                    setActiveNumericEditKey((prev) =>
                                      prev === `${r.localId}:current_price`
                                        ? null
                                        : prev,
                                    );
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1 whitespace-nowrap">
                                  <select
                                    className={`rounded border px-1 py-0.5 text-xs ${inputCls}`}
                                    value={r.purchaseMode}
                                    onChange={(e) => {
                                      const mode = e.target
                                        .value as PurchaseMode;
                                      updateRow(r.localId, {
                                        purchaseMode: mode,
                                        case_unit:
                                          mode === "loose" ? null : r.case_unit,
                                        case_purchased:
                                          mode === "loose"
                                            ? null
                                            : r.case_purchased,
                                        unit_purchased:
                                          mode === "case"
                                            ? null
                                            : (r.unit_purchased ?? 1),
                                      });
                                    }}
                                  >
                                    <option value="loose">Loose</option>
                                    <option value="case">Case</option>
                                    <option value="mixed">Mixed</option>
                                  </select>
                                  {(r.purchaseMode === "case" ||
                                    r.purchaseMode === "mixed") && (
                                    <>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        placeholder="unit/cs"
                                        title="Units per case"
                                        className={`no-spinner w-16 rounded border px-1 py-0.5 text-right text-xs [font-variant-numeric:tabular-nums] ${inputCls}`}
                                        value={r.case_unit ?? ""}
                                        onChange={(e) =>
                                          updateRow(r.localId, {
                                            case_unit:
                                              e.target.value === ""
                                                ? null
                                                : parseInt(e.target.value, 10),
                                          })
                                        }
                                        onBlur={() =>
                                          updateRow(r.localId, {
                                            case_unit:
                                              r.case_unit == null
                                                ? null
                                                : Math.max(
                                                    1,
                                                    Math.round(
                                                      Number(r.case_unit),
                                                    ),
                                                  ),
                                          })
                                        }
                                      />
                                      <span className="text-xs text-gray-400">
                                        ×
                                      </span>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        placeholder="cs"
                                        title="Cases purchased"
                                        className={`no-spinner w-12 rounded border px-1 py-0.5 text-right text-xs [font-variant-numeric:tabular-nums] ${inputCls}`}
                                        value={r.case_purchased ?? ""}
                                        onChange={(e) =>
                                          updateRow(r.localId, {
                                            case_purchased:
                                              e.target.value === ""
                                                ? null
                                                : parseInt(e.target.value, 10),
                                          })
                                        }
                                        onBlur={() =>
                                          updateRow(r.localId, {
                                            case_purchased:
                                              r.case_purchased == null
                                                ? null
                                                : Math.max(
                                                    1,
                                                    Math.round(
                                                      Number(r.case_purchased),
                                                    ),
                                                  ),
                                          })
                                        }
                                      />
                                    </>
                                  )}
                                  {(r.purchaseMode === "loose" ||
                                    r.purchaseMode === "mixed") && (
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      placeholder="qty"
                                      title="Units purchased"
                                      className={`no-spinner w-16 rounded border px-1 py-0.5 text-right text-xs [font-variant-numeric:tabular-nums] ${inputCls}`}
                                      value={r.unit_purchased ?? ""}
                                      onChange={(e) =>
                                        updateRow(r.localId, {
                                          unit_purchased:
                                            e.target.value === ""
                                              ? null
                                              : parseInt(e.target.value, 10),
                                        })
                                      }
                                      onBlur={() =>
                                        updateRow(r.localId, {
                                          unit_purchased:
                                            r.unit_purchased == null
                                              ? null
                                              : Math.max(
                                                  1,
                                                  Math.round(
                                                    Number(r.unit_purchased),
                                                  ),
                                                ),
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeRow(r.localId)}
                                  className="text-red-500 hover:underline"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8">
              {groups.map((g) => (
                <div key={g.localId} className="space-y-3">
                  <div
                    className={`rounded-lg border p-4 ${isDark ? "border-slate-600 bg-slate-900/30" : "border-gray-200 bg-gray-100/90"}`}
                  >
                    <p className={`mb-2 text-sm font-medium ${thCls}`}>
                      Invoice
                      {g.vendorNameHint
                        ? ` · Detected: ${g.vendorNameHint}`
                        : " · No supplier name detected"}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[200px] flex-1">
                        <div
                          className={
                            showStep3RequiredErrors && !g.vendorId
                              ? "rounded-md ring-1 ring-red-500"
                              : ""
                          }
                        >
                          <SearchableSelect
                            options={buildVendorSelectOptions(
                              g.vendorNameHint,
                              vendors,
                            )}
                            value={g.vendorId}
                            onChange={(id) => setGroupVendorId(g.localId, id)}
                            placeholder="Select vendor"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          window.open("/items/vendors-embed", "_blank");
                        }}
                        className={`mb-px shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                          isDark
                            ? "bg-slate-700 text-slate-100 hover:bg-slate-600"
                            : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                        }`}
                      >
                        + New vendor
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-inherit">
                    <table className="w-full min-w-[1080px] text-sm">
                      <thead>
                        <tr
                          className={isDark ? "bg-slate-700/80" : "bg-gray-100"}
                        >
                          <th className={`px-2 py-2 text-left ${thCls}`}>#</th>
                          <th
                            className={`min-w-[120px] px-2 py-2 text-left ${thCls}`}
                          >
                            Product
                          </th>
                          <th
                            className={`min-w-[140px] px-2 py-2 text-left ${thCls}`}
                          >
                            Vendor item
                          </th>
                          <th
                            className={`min-w-[260px] px-2 py-2 text-left ${thCls}`}
                          >
                            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                              Link base item
                              <button
                                type="button"
                                onClick={() => setNewBaseItemModalOpen(true)}
                                className={`font-normal hover:underline ${
                                  isDark ? "text-blue-400" : "text-blue-600"
                                }`}
                              >
                                + add
                              </button>
                            </span>
                          </th>
                          <th
                            className={`min-w-[280px] px-2 py-2 text-left ${thCls}`}
                          >
                            Link existing vendor item
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, idx) => {
                          const groupSyncing =
                            !!groupVendorSyncLoading[g.localId];
                          const linkOpts =
                            r.matchMode === "existing" && g.vendorId
                              ? buildLinkExistingOptions(
                                  r,
                                  g.vendorId,
                                  vendorProducts,
                                  baseItems,
                                )
                              : [];
                          return (
                            <tr
                              key={r.localId}
                              className={`border-t ${border}`}
                            >
                              <td className="px-2 py-2 align-top">{idx + 1}</td>
                              <td className="px-2 py-2 align-top">
                                <div>{r.product_name || "—"}</div>
                                <div className={`text-xs ${muted}`}>
                                  {r.purchase_quantity} {r.purchase_unit} · $
                                  {Number(r.current_price).toFixed(2)}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <label className="mr-3 inline-flex items-center gap-1">
                                  <input
                                    type="radio"
                                    name={`match-${r.localId}`}
                                    checked={r.matchMode === "existing"}
                                    onChange={() => {
                                      let linked_vvp_id = "";
                                      if (g.vendorId) {
                                        const ranked = rankVvpsForInvoiceRow(
                                          r,
                                          g.vendorId,
                                          vendorProducts,
                                        );
                                        const best = ranked[0];
                                        if (
                                          best &&
                                          scoreVvpForInvoiceRow(r, best) > 0
                                        ) {
                                          linked_vvp_id = best.id;
                                        }
                                      }
                                      updateRow(r.localId, {
                                        matchMode: "existing",
                                        base_item_id: "",
                                        linked_vvp_id,
                                        existingPriceAction: null,
                                      });
                                    }}
                                  />
                                  Existing
                                </label>
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="radio"
                                    name={`match-${r.localId}`}
                                    checked={r.matchMode === "new"}
                                    onChange={() => {
                                      const base_item_id = g.vendorId
                                        ? suggestBaseItemIdFromProductName(
                                            r.product_name,
                                            activeBaseItems,
                                            r.purchase_unit,
                                          )
                                        : "";
                                      updateRow(r.localId, {
                                        matchMode: "new",
                                        linked_vvp_id: "",
                                        base_item_id,
                                        existingPriceAction: null,
                                      });
                                    }}
                                  />
                                  New
                                </label>
                              </td>
                              <td className="px-2 py-2 align-top">
                                {r.matchMode === "new" ? (
                                  !g.vendorId ? (
                                    <span className={muted}>
                                      Select vendor for this block
                                    </span>
                                  ) : groupSyncing ? (
                                    <span className={muted}>Loading…</span>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1 space-y-1">
                                        <div
                                          className={
                                            showStep3RequiredErrors &&
                                            r.matchMode === "new" &&
                                            !r.base_item_id
                                              ? "rounded-md ring-1 ring-red-500"
                                              : ""
                                          }
                                        >
                                          <SearchableSelect
                                            options={buildBaseItemSelectOptions(
                                              r.product_name,
                                              activeBaseItems,
                                              r.purchase_unit,
                                            )}
                                            value={r.base_item_id}
                                            onChange={(id) =>
                                              updateRow(r.localId, {
                                                base_item_id: id,
                                              })
                                            }
                                            placeholder="Select base item"
                                          />
                                        </div>
                                      </div>
                                      {isNonMassUnit(r.purchase_unit) &&
                                        Boolean(r.base_item_id) &&
                                        isNewRowBaseItemInvalidForInvoice(
                                          r,
                                          baseItems,
                                        ) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setQuickEditBaseItemId(
                                                r.base_item_id,
                                              )
                                            }
                                            className={`shrink-0 text-xs hover:underline ${
                                              isDark
                                                ? "text-blue-400"
                                                : "text-blue-600"
                                            }`}
                                          >
                                            Edit
                                          </button>
                                        )}
                                    </div>
                                  )
                                ) : null}
                              </td>
                              <td className="px-2 py-2 align-top">
                                {r.matchMode === "existing" ? (
                                  !g.vendorId ? (
                                    <span className={muted}>
                                      Select vendor for this block
                                    </span>
                                  ) : groupSyncing ? (
                                    <span className={muted}>Loading…</span>
                                  ) : linkOpts.length === 0 ? (
                                    <span className={muted}>
                                      No vendor items for this supplier
                                    </span>
                                  ) : (
                                    <div
                                      className={
                                        showStep3RequiredErrors &&
                                        r.matchMode === "existing" &&
                                        !r.linked_vvp_id
                                          ? "rounded-md ring-1 ring-red-500"
                                          : ""
                                      }
                                    >
                                      <SearchableSelect
                                        options={linkOpts}
                                        value={r.linked_vvp_id}
                                        onChange={(id) =>
                                          updateRow(r.localId, {
                                            linked_vvp_id: id,
                                          })
                                        }
                                        placeholder="Select vendor item"
                                      />
                                    </div>
                                  )
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              {groups.map((g) => (
                <div
                  key={g.localId}
                  className={`rounded-xl border p-4 ${
                    isDark
                      ? "border-slate-600 bg-slate-900/40"
                      : "border-gray-200 bg-gray-100"
                  }`}
                >
                  <div className={`mb-3 space-y-1.5 border-b pb-3 ${border}`}>
                    <p className={`text-sm font-semibold ${thCls}`}>
                      Invoice
                      <span className={`font-normal ${muted}`}>
                        {g.vendorNameHint
                          ? ` · ${g.vendorNameHint}`
                          : " · Supplier unknown"}
                      </span>
                    </p>
                    <p className={`text-sm ${thCls}`}>
                      <span className={muted}>Vendor: </span>
                      {vendors.find((v) => v.id === g.vendorId)?.name ?? "—"}
                    </p>
                    <p className={`text-sm ${thCls}`}>
                      <span className={muted}>Invoice date: </span>
                      {g.invoiceDate || "—"}
                    </p>
                  </div>
                  <div
                    className={`overflow-x-auto rounded-lg border ${border} ${
                      isDark ? "bg-slate-950/20" : "bg-white"
                    }`}
                  >
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr
                          className={isDark ? "bg-slate-700/80" : "bg-gray-100"}
                        >
                          <th className={`px-2 py-2 text-left ${thCls}`}>#</th>
                          <th className={`px-2 py-2 text-left ${thCls}`}>
                            Mode
                          </th>
                          <th className={`px-2 py-2 text-left ${thCls}`}>
                            Product
                          </th>
                          <th className={`px-2 py-2 text-left ${thCls}`}>
                            Size
                          </th>
                          <th className={`px-2 py-2 text-left ${thCls}`}>
                            Price
                          </th>
                          <th className={`px-2 py-2 text-left ${thCls}`}>
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, idx) => {
                          const stale = rowIsStaleInvoiceWarning(
                            r,
                            g,
                            vendorProducts,
                          );
                          const confirmVvp = linkedVvpForConfirmRow(
                            r,
                            vendorProducts,
                          );
                          return (
                            <Fragment key={r.localId}>
                              <tr className={`border-t ${border}`}>
                                <td className="px-2 py-2 align-top">
                                  {idx + 1}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  {r.matchMode === "new" ? "New" : "Existing"}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  {confirmVvp ? (
                                    <>
                                      <div>
                                        {confirmVvp.product_name?.trim() || "—"}
                                      </div>
                                      {confirmVvp.brand_name?.trim() ? (
                                        <div className={`text-xs ${muted}`}>
                                          {confirmVvp.brand_name}
                                        </div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <>
                                      <div>{r.product_name || "—"}</div>
                                      {r.brand_name ? (
                                        <div className={`text-xs ${muted}`}>
                                          {r.brand_name}
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  {confirmVvp
                                    ? `${confirmVvp.purchase_quantity} ${confirmVvp.purchase_unit}`
                                    : `${r.purchase_quantity} ${r.purchase_unit}`}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  ${Number(r.current_price).toFixed(2)}
                                </td>
                                <td className="px-2 py-2 align-top">
                                  {r.matchMode === "existing" ? (
                                    <div className="flex flex-col gap-1">
                                      <label className="inline-flex items-center gap-1.5">
                                        <input
                                          type="radio"
                                          name={`price-act-${r.localId}`}
                                          checked={
                                            r.existingPriceAction ===
                                            "use_invoice"
                                          }
                                          onChange={() =>
                                            updateRow(r.localId, {
                                              existingPriceAction:
                                                "use_invoice",
                                            })
                                          }
                                        />
                                        <span>Use invoice price</span>
                                      </label>
                                      <label className="inline-flex items-center gap-1.5">
                                        <input
                                          type="radio"
                                          name={`price-act-${r.localId}`}
                                          checked={
                                            r.existingPriceAction ===
                                            "keep_current"
                                          }
                                          onChange={() =>
                                            updateRow(r.localId, {
                                              existingPriceAction:
                                                "keep_current",
                                            })
                                          }
                                        />
                                        <span>
                                          Keep current price in database
                                        </span>
                                      </label>
                                    </div>
                                  ) : (
                                    <span className={muted}>—</span>
                                  )}
                                </td>
                              </tr>
                              {stale ? (
                                <tr className={isDark ? "bg-slate-900/10" : ""}>
                                  <td className="px-2 py-1" />
                                  <td
                                    colSpan={2}
                                    className={`px-2 py-1 text-xs ${
                                      isDark
                                        ? "text-amber-300"
                                        : "text-amber-700"
                                    }`}
                                  >
                                    Warning: Invoice date is before the last
                                    displayed-price update on this vendor item.
                                  </td>
                                  <td className="px-2 py-1" />
                                  <td className="px-2 py-1" />
                                  <td className="px-2 py-1" />
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <p className={`text-sm ${muted}`}>
                Summary: <strong>{newCount}</strong> new,{" "}
                <strong>{updateCount}</strong> existing
                {sourcePdfFiles.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    {sourcePdfFiles.length === 1 ? (
                      <>
                        File: <strong>{sourcePdfFiles[0].name}</strong>
                      </>
                    ) : (
                      <>
                        {sourcePdfFiles.length} PDFs (merged on import):{" "}
                        <strong>
                          {sourcePdfFiles.map((f) => f.name).join(", ")}
                        </strong>
                      </>
                    )}
                  </>
                ) : null}
              </p>
            </div>
          )}
        </div>

        <div
          className={`flex shrink-0 flex-wrap items-center justify-end gap-3 border-t px-5 py-4 ${border}`}
        >
          <div className="flex flex-wrap gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => {
                  setStep((s) => {
                    const next = Math.max(1, s - 1);
                    if (next === 1) {
                      setGroups([]);
                      setExtractError(null);
                    }
                    return next;
                  });
                }}
                className={`rounded-lg px-4 py-2 text-sm ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                Back
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1) {
                    void handleAdvanceFromStep1();
                    return;
                  }
                  if (step === 2) {
                    if (!canGoStep3) return;
                    setGroups((prev) =>
                      prev.map((g) =>
                        applyVendorHintAndRematchGroup(
                          g,
                          vendors,
                          vendorProducts,
                          activeBaseItems,
                        ),
                      ),
                    );
                    setStep(3);
                    return;
                  }
                  if (step === 3) {
                    setStep3ValidationAttempted(true);
                    if (!allGroupsHaveVendor) return;
                    if (!matchStep3StructuralComplete) {
                      alert(
                        "Please finish matching every line: select a vendor for each block; for New lines choose a base item; for Existing lines link a vendor item.",
                      );
                      return;
                    }
                    if (hasInvalidNonMassNewBaseItems) {
                      alert(
                        "For invoice lines with non-mass units, each New line needs a base item that has specific weight set. Pick another base item or use Edit on the selected one.",
                      );
                      return;
                    }
                  }
                  setStep((s) => Math.min(4, s + 1));
                }}
                disabled={isNextDisabled}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isNextDisabled
                    ? isDark
                      ? "cursor-not-allowed bg-slate-600 text-slate-400"
                      : "cursor-not-allowed bg-gray-300 text-gray-500"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {step === 1 && extractLoading ? "Extracting…" : "Next"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleImport}
                disabled={
                  importLoading ||
                  allRows.length === 0 ||
                  allRows.some(
                    (r) =>
                      r.matchMode === "existing" &&
                      r.existingPriceAction === null,
                  )
                }
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importLoading ? "Importing…" : "Import"}
              </button>
            )}
          </div>
        </div>
      </div>

      <InvoiceBaseItemQuickEditModal
        open={quickEditBaseItemId != null}
        baseItemId={quickEditBaseItemId}
        onClose={() => setQuickEditBaseItemId(null)}
        onSaved={() => {
          void onInvoiceLookupsRefresh?.();
        }}
      />
      <InvoiceNewBaseItemModal
        open={newBaseItemModalOpen}
        onClose={() => setNewBaseItemModalOpen(false)}
        onCreated={() => {
          void onInvoiceLookupsRefresh?.();
        }}
      />
    </div>
  );
}
