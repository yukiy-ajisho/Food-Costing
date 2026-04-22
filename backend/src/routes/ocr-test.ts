import { Router } from "express";
import multer from "multer";
import { APP_PURCHASE_UNITS_ORDERED } from "../constants/units";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed;
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }
  return null;
}

export type NormalizedVendorBlock = {
  vendor_name_hint: string | null;
  /** YYYY-MM-DD when known; null if absent or invalid */
  invoice_date: string | null;
  /** Invoice sub-total for this supplier block; null if not found */
  total_amount: number | null;
  lines: unknown[];
};

/** Single-supplier extract (no vendor_blocks in API response). */
export type NormalizedSingleSupplierInvoice = {
  vendor_name_hint: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  lines: unknown[];
  /** Non-empty when legacy vendor_blocks had 2+ different supplier name hints */
  distinct_vendor_name_hints: string[];
  /** Non-empty when legacy vendor_blocks had 2+ different YYYY-MM-DD dates */
  distinct_invoice_dates: string[];
};

function parseBlockInvoiceDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function parseOneVendorBlock(raw: unknown): NormalizedVendorBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const hintRaw = b.vendor_name_hint;
  const hint =
    typeof hintRaw === "string" && hintRaw.trim() !== ""
      ? hintRaw.trim()
      : null;
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const invoice_date = parseBlockInvoiceDate(b.invoice_date);
  const totalRaw = b.total_amount;
  const total_amount =
    typeof totalRaw === "number" && totalRaw > 0 ? totalRaw : null;
  if (lines.length === 0) return null;
  return { vendor_name_hint: hint, invoice_date, total_amount, lines };
}

function mergeVendorBlocksToSingle(blocks: NormalizedVendorBlock[]): NormalizedSingleSupplierInvoice {
  const lines = blocks.flatMap((b) => b.lines);
  const hintByLower = new Map<string, string>();
  for (const b of blocks) {
    if (b.vendor_name_hint) {
      const k = b.vendor_name_hint.trim().toLowerCase();
      if (!hintByLower.has(k)) hintByLower.set(k, b.vendor_name_hint.trim());
    }
  }
  const distinct_vendor_name_hints = [...hintByLower.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const dateSet = new Set<string>();
  for (const b of blocks) {
    if (b.invoice_date) dateSet.add(b.invoice_date);
  }
  const distinct_invoice_dates = [...dateSet].sort();

  let vendor_name_hint: string | null = null;
  if (distinct_vendor_name_hints.length === 1) {
    vendor_name_hint = distinct_vendor_name_hints[0];
  }

  let invoice_date: string | null = null;
  if (distinct_invoice_dates.length === 1) {
    invoice_date = distinct_invoice_dates[0];
  }

  let total_amount: number | null = null;
  for (const b of blocks) {
    if (b.total_amount != null && b.total_amount > 0) {
      total_amount = b.total_amount;
      break;
    }
  }

  return {
    vendor_name_hint,
    invoice_date,
    total_amount,
    lines,
    distinct_vendor_name_hints,
    distinct_invoice_dates,
  };
}

/**
 * Parse Gemini JSON into one supplier + flat lines (legacy vendor_blocks merged).
 */
export function normalizeInvoiceExtractFromParsed(
  parsed: unknown,
): NormalizedSingleSupplierInvoice | null {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return null;
    return normalizeInvoiceExtractFromParsed(parsed[0]);
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const topLines = o.lines;
  if (Array.isArray(topLines) && topLines.length > 0) {
    const hintRaw = o.vendor_name_hint;
    const vendor_name_hint =
      typeof hintRaw === "string" && hintRaw.trim() !== ""
        ? hintRaw.trim()
        : null;
    const totalRaw = o.total_amount;
    const total_amount =
      typeof totalRaw === "number" && totalRaw > 0 ? totalRaw : null;
    return {
      vendor_name_hint,
      invoice_date: parseBlockInvoiceDate(o.invoice_date),
      total_amount,
      lines: topLines,
      distinct_vendor_name_hints: [],
      distinct_invoice_dates: [],
    };
  }

  const vb = o.vendor_blocks;
  if (Array.isArray(vb) && vb.length > 0) {
    const blocks: NormalizedVendorBlock[] = [];
    for (const raw of vb) {
      const one = parseOneVendorBlock(raw);
      if (one) blocks.push(one);
    }
    if (blocks.length === 0) return null;
    return mergeVendorBlocksToSingle(blocks);
  }

  const items = o.items;
  if (Array.isArray(items) && items.length > 0) {
    return {
      vendor_name_hint: null,
      invoice_date: null,
      total_amount: null,
      lines: items,
      distinct_vendor_name_hints: [],
      distinct_invoice_dates: [],
    };
  }

  return null;
}

router.post("/extract", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }
    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF is supported in this test" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    const purchaseUnitsForPrompt = APP_PURCHASE_UNITS_ORDERED.join(", ");

    const prompt = [
      "Extract invoice data from the PDF.",
      "This import flow accepts ONE supplier per document (possibly multiple pages).",
      "Return valid JSON only. No markdown, no explanation.",
      "Never guess numeric or name values. If unknown, use null.",
      "",
      "Put ALL line items in a single top-level lines array (same supplier / same invoice).",
      "- If the supplier name appears on page 1 but not on continuation pages, still use one lines array for the whole document.",
      "- vendor_name_hint: from letterhead, 'Sold by', remit-to, etc.; null if not visible anywhere.",
      "- invoice_date: YYYY-MM-DD from the invoice header; null if unknown.",
      "- total_amount: invoice total or sub-total (numeric, no $ or commas); null if not present.",
      "",
      "Output schema:",
      "{",
      '  "raw_text": string | null,',
      '  "vendor_name_hint": string | null,',
      '  "invoice_date": string | null,',
      '  "total_amount": number | null,',
      '  "lines": [',
      "        {",
      '          "base_item_name": string | null,',
      '          "vendor_name": string | null,',
      '          "product_name": string | null,',
      '          "brand_name": string | null,',
      '          "qty_case": number | null,',
      '          "pack_count": number | null,',
      '          "pack_size_value": number | null,',
      '          "pack_size_unit": string | null,',
      '          "unit_price_case": number | null,',
      '          "unit_price_each": number | null,',
      '          "amount": number | null,',
      '          "purchase_quantity": number | null,',
      '          "purchase_unit": string | null,',
      '          "case_unit": number | null,',
      '          "case_purchased": number | null,',
      '          "unit_purchased": number | null,',
      '          "description_raw": string | null',
      "        }",
      "  ]",
      "}",
      "",
      "Line-level vendor_name (if present) should match the invoice supplier when known; otherwise null.",
      "",
      "App purchase units (purchase_unit MUST be exactly one of these strings, or null if truly unmappable):",
      purchaseUnitsForPrompt,
      "",
      "Price focus (per line): The application stores **price per single salable unit** (one bottle, one jug, one retail pack at the each price), not the case/line total as the primary price.",
      "- unit_price_each: from EACH PRICE (or equivalent) column when the invoice shows it.",
      "- unit_price_case: from UNIT PRICE / case total / line price column (price for the whole pack described on the line).",
      "- When the description has pattern N/SIZE UNIT (slash): N is pack_count = how many salable units are in that priced pack (e.g. 20 bottles). Do NOT put N in qty_case unless a separate invoice column is clearly 'cases ordered'.",
      "- Consistency check: when both prices exist, unit_price_case / pack_count should equal unit_price_each (allow tiny rounding). Prefer the EACH column for unit_price_each when present.",
      "- When there is NO slash in the description, often unit_price_each equals unit_price_case for one salable unit; set pack_count null (or 1 only if needed for clarity).",
      "- If EACH column is missing but UNIT PRICE and pack_count (from slash) exist: set unit_price_each = unit_price_case / pack_count.",
      "",
      "purchase_quantity and purchase_unit (per line):",
      "- purchase_unit must be one of the allowed list above, or null. Map invoice text to app codes:",
      "  - # at end of description means pounds → purchase_unit must be lb.",
      "  - FZ (fluid ounces on invoices) → floz.",
      "  - GAL → gallon. ML → ml. Liter/L → liter.",
      "  - Weight OZ (not fluid) → oz. If ambiguous, prefer null for purchase_unit.",
      "- purchase_quantity: positive number = size of **one** salable unit in that purchase_unit (what the each price applies to).",
      "  Example: '20/16.90 FZ' → one unit is one bottle of 16.90 floz → purchase_quantity=16.90, purchase_unit=floz.",
      "  Example: '10/1.10 #' → purchase_quantity=1.10, purchase_unit=lb.",
      "  Example: '5.28 GAL' with no slash, one jug → purchase_quantity=5.28, purchase_unit=gallon.",
      "  If size unknown but item is clearly a discrete count unit → purchase_quantity=1, purchase_unit=each.",
      "",
      "qty_case: only from an explicit cases/QTY column on the invoice; null if absent. Never copy the N before '/' from description into qty_case.",
      "",
      "Case vs. unit purchase fields (case_unit / case_purchased / unit_purchased):",
      "- These three fields record HOW the line was purchased (for audit). They are separate from purchase_quantity / purchase_unit.",
      "- case_unit: how many individual units are in one case (integer > 0). Populate only when the invoice clearly describes a case pack (e.g., '12-ct case', '20/bottle', '6/pk'). Null for loose/each-style purchases.",
      "- case_purchased: number of cases purchased on this line (integer > 0). Populate only when a QTY or CASES column on the invoice shows a case-count. Null if the quantity column reflects individual units.",
      "- unit_purchased: number of individual units purchased (integer > 0). Populate when the QTY column is in individual units (not cases). For case-only lines, set null.",
      "- A line can be case-only (case_unit & case_purchased set, unit_purchased null), unit-only (unit_purchased set, case_unit & case_purchased null), or mixed (all three set for partial-case orders).",
      "- When a line is clearly a case purchase (e.g., 'CS' or 'CS 20/16.90 FZ') and the QTY column shows cases ordered: set case_unit = pack_count, case_purchased = qty, unit_purchased = null.",
      "- When a line has no case indicator and QTY is individual units: set case_unit = null, case_purchased = null, unit_purchased = qty_from_invoice_column.",
      "- If purchase pattern is ambiguous, default to unit_purchased = qty (treat as loose). Never guess.",
      "",
      "pack_size_value / pack_size_unit: raw tokens after the slash from description (e.g. 16.90 and FZ); keep for audit.",
      "",
      "Name extraction rules (per line):",
      "- If item description exists, do NOT leave product_name null.",
      "- product_name should be the item name excluding the trailing pack pattern (e.g. strip ' 20/16.90 FZ' or ' 5.28 GAL').",
      "- brand_name should be inferred from the first clear brand token in description (e.g., 'BULLDOG').",
      "- base_item_name should be a normalized generic item name from product_name (e.g., 'Worcestershire Sauce').",
      "- Only use null for name fields when there is truly no usable text.",
      "",
      "Few-shot line example — JFC style with slash (inside lines array):",
      "{",
      '  "base_item_name": "Worcestershire Sauce",',
      '  "vendor_name": "JFC INTERNATIONAL INC",',
      '  "product_name": "BULLDOG WORCESTER SCE",',
      '  "brand_name": "BULLDOG",',
      '  "qty_case": null,',
      '  "pack_count": 20,',
      '  "pack_size_value": 16.90,',
      '  "pack_size_unit": "FZ",',
      '  "unit_price_case": 70.00,',
      '  "unit_price_each": 3.50,',
      '  "amount": null,',
      '  "purchase_quantity": 16.90,',
      '  "purchase_unit": "floz",',
      '  "case_unit": 20,',
      '  "case_purchased": null,',
      '  "unit_purchased": null,',
      '  "description_raw": "BULLDOG WORCESTER SCE          20/16.90 FZ"',
      "}",
      "",
      "Few-shot line example — JFC style, no slash, jug size:",
      "{",
      '  "base_item_name": "Grain vinegar",',
      '  "vendor_name": "JFC INTERNATIONAL INC",',
      '  "product_name": "NISHIKI GRAIN VINEGAR",',
      '  "brand_name": "NISHIKI",',
      '  "qty_case": null,',
      '  "pack_count": null,',
      '  "pack_size_value": 5.28,',
      '  "pack_size_unit": "GAL",',
      '  "unit_price_case": 25.00,',
      '  "unit_price_each": 25.00,',
      '  "amount": null,',
      '  "purchase_quantity": 5.28,',
      '  "purchase_unit": "gallon",',
      '  "case_unit": null,',
      '  "case_purchased": null,',
      '  "unit_purchased": 1,',
      '  "description_raw": "NISHIKI GRAIN VINEGAR          5.28 GAL"',
      "}",
      "",
      "Numeric rules:",
      "- Keep decimals as numbers, not strings",
      "- Remove currency symbols and commas",
      "- If a numeric field is missing, use null",
    ].join("\n");

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "application/pdf",
                    data: file.buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const data = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      error?: { message?: string };
    };

    if (!resp.ok) {
      return res.status(502).json({
        error: data?.error?.message || "Gemini request failed",
      });
    }

    const modelText =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("\n")
        .trim() || "";

    const jsonBlock = extractJsonBlock(modelText);
    if (!jsonBlock) {
      return res.status(200).json({
        model_text: modelText,
        raw_text: modelText,
        structured_json: null,
      });
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(jsonBlock);
    } catch {
      return res.status(200).json({
        model_text: modelText,
        raw_text: modelText,
        structured_json: null,
      });
    }

    type ParsedInvoice = {
      raw_text?: string;
      vendor_blocks?: unknown[];
      items?: unknown[];
      lines?: unknown[];
    };

    const rawTextParts: string[] = [];

    const collectRawText = (o: ParsedInvoice) => {
      if (typeof o.raw_text === "string" && o.raw_text.trim() !== "") {
        rawTextParts.push(o.raw_text.trim());
      }
    };

    if (Array.isArray(parsed)) {
      for (const el of parsed) {
        const o = el as ParsedInvoice;
        collectRawText(o);
      }
    } else {
      collectRawText(parsed as ParsedInvoice);
    }

    const normalized = normalizeInvoiceExtractFromParsed(parsed);

    const rawTextJoined =
      rawTextParts.length > 0 ? rawTextParts.join("\n\n---\n\n") : "";

    if (
      !normalized ||
      !Array.isArray(normalized.lines) ||
      normalized.lines.length === 0
    ) {
      return res.status(200).json({
        model_text: modelText,
        raw_text: rawTextJoined,
        structured_json: null,
      });
    }

    return res.status(200).json({
      model_text: modelText,
      raw_text: rawTextJoined,
      structured_json: {
        vendor_name_hint: normalized.vendor_name_hint,
        invoice_date: normalized.invoice_date,
        total_amount: normalized.total_amount,
        lines: normalized.lines,
        items: normalized.lines,
        distinct_vendor_name_hints: normalized.distinct_vendor_name_hints,
        distinct_invoice_dates: normalized.distinct_invoice_dates,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
