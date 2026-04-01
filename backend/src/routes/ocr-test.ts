import { Router } from "express";
import multer from "multer";

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

    const prompt = [
      "Extract invoice data from the PDF.",
      "Return valid JSON only. No markdown, no explanation.",
      "Never guess values. If unknown, use null.",
      "",
      "Output schema:",
      "{",
      '  "raw_text": "full OCR text",',
      '  "items": [',
      "    {",
      '      "base_item_name": string | null,',
      '      "vendor_name": string | null,',
      '      "product_name": string | null,',
      '      "brand_name": string | null,',
      '      "qty_case": number | null,',
      '      "pack_count": number | null,',
      '      "pack_size_value": number | null,',
      '      "pack_size_unit": string | null,',
      '      "unit_price_case": number | null,',
      '      "unit_price_each": number | null,',
      '      "amount": number | null,',
      '      "description_raw": string | null',
      "    }",
      "  ]",
      "}",
      "",
      "Important parsing rules:",
      "- Example description: 'BULLDOG WORCESTER SCE 20/16.90 FZ'",
      "- Parse as pack_count=20, pack_size_value=16.90, pack_size_unit='FZ'",
      "- Do NOT map this pattern to qty_case",
      "- qty_case must come from case quantity column (e.g., 'QTY. CASE')",
      "- unit_price_case must come from unit/case price column",
      "- unit_price_each must come from each price column when present",
      "- amount must come from line amount/extended amount column",
      "",
      "Name extraction rules:",
      "- If vendor name exists in invoice header/supplier block, fill vendor_name.",
      "- If item description exists, do NOT leave product_name null.",
      "- product_name should be the item description text excluding pack pattern (like 20/16.90 FZ).",
      "- brand_name should be inferred from the first clear brand token in description (e.g., 'BULLDOG').",
      "- base_item_name should be a normalized generic item name from product_name (e.g., 'Worcestershire Sauce').",
      "- Only use null for name fields when there is truly no usable text.",
      "",
      "Few-shot example:",
      "Input row:",
      "- description: BULLDOG WORCESTER SCE 20/16.90 FZ",
      "- qty_case: 3",
      "- unit_price_case: 70.00",
      "- each_price: 3.50",
      "- amount: 210.00",
      "Expected item:",
      "{",
      '  "base_item_name": "Worcestershire Sauce",',
      '  "vendor_name": "JFC INTERNATIONAL INC",',
      '  "product_name": "BULLDOG WORCESTER SCE",',
      '  "brand_name": "BULLDOG",',
      '  "qty_case": 3,',
      '  "pack_count": 20,',
      '  "pack_size_value": 16.90,',
      '  "pack_size_unit": "FZ",',
      '  "unit_price_case": 70.00,',
      '  "unit_price_each": 3.50,',
      '  "amount": 210.00,',
      '  "description_raw": "BULLDOG WORCESTER SCE 20/16.90 FZ"',
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

    type ParsedInvoice = { raw_text?: string; items?: unknown[] };

    let mergedItems: unknown[] = [];
    const rawTextParts: string[] = [];

    if (Array.isArray(parsed)) {
      for (const el of parsed) {
        const o = el as ParsedInvoice;
        if (Array.isArray(o.items)) mergedItems.push(...o.items);
        if (typeof o.raw_text === "string" && o.raw_text.trim() !== "") {
          rawTextParts.push(o.raw_text.trim());
        }
      }
    } else {
      const o = parsed as ParsedInvoice;
      if (Array.isArray(o.items)) mergedItems = o.items;
      if (typeof o.raw_text === "string" && o.raw_text.trim() !== "") {
        rawTextParts.push(o.raw_text.trim());
      }
    }

    const rawTextJoined =
      rawTextParts.length > 0 ? rawTextParts.join("\n\n---\n\n") : "";

    return res.status(200).json({
      model_text: modelText,
      raw_text: rawTextJoined,
      structured_json: { items: mergedItems },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
