import { Router } from "express";
import multer from "multer";
import { supabase } from "../../config/supabase";
import { authorizeUnified, UnifiedCompanyAction } from "../../authz/unified/authorize";
import {
  getDocumentPresignedUrl,
  uploadCompanyDocumentToR2,
} from "../../lib/r2-upload";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * 指定要件 ID が自分がアクセス可能な会社に属するか確認（company_members）
 */
async function ensureCompanyRequirementAccess(
  userId: string,
  requirementIds: string[]
): Promise<boolean> {
  if (requirementIds.length === 0) return true;

  const { data: rows, error } = await supabase
    .from("company_requirements")
    .select("company_id")
    .in("id", requirementIds);

  if (error) return false;

  // 既存挙動に合わせ、存在しない requirement_id が混ざっていても
  // それらの company_id がないため permission 判定から除外される（空なら true）
  const companyIds = [...new Set((rows ?? []).map((r) => r.company_id))];
  if (companyIds.length === 0) return true;

  // company_admin / company_director のみが許可されるため、action は manage_members で統一する
  for (const companyId of companyIds) {
    const allowed = await authorizeUnified(
      userId,
      UnifiedCompanyAction.manage_members,
      { type: "Company", id: companyId }
    );
    if (!allowed) return false;
  }

  return true;
}

/**
 * GET /company-requirement-real-data/document-url
 * Query: key (R2 object key, e.g. company-documents/{requirement_id}/{uuid}.pdf)
 */
router.get("/document-url", async (req, res) => {
  try {
    const userId = req.user!.id;
    const key = req.query.key as string | undefined;
    if (!key || !key.startsWith("company-documents/")) {
      return res.status(400).json({ error: "Invalid or missing key" });
    }
    const parts = key.split("/");
    const requirementId = parts[1];
    if (!requirementId) {
      return res.status(400).json({ error: "Invalid key format" });
    }
    const allowed = await ensureCompanyRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const url = await getDocumentPresignedUrl(key);
    res.json({ url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /company-requirement-real-data/documents
 * Query: company_requirement_id, optional group_key
 */
router.get("/documents", async (req, res) => {
  try {
    const userId = req.user!.id;
    const requirementId = req.query.company_requirement_id as string | undefined;
    const groupKeyParam = req.query.group_key as string | undefined;
    const groupKeyFilter = groupKeyParam != null && groupKeyParam !== "" ? parseInt(groupKeyParam, 10) : null;
    if (!requirementId?.trim()) {
      return res.status(400).json({ error: "company_requirement_id is required" });
    }
    const allowed = await ensureCompanyRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: docType } = await supabase
      .from("company_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    const { data: payDateType } = await supabase
      .from("company_requirement_value_types")
      .select("id")
      .eq("name", "Pay date")
      .maybeSingle();
    if (!docType || !payDateType) {
      return res.json([]);
    }
    let query = supabase
      .from("company_requirement_real_data")
      .select("id, group_key, value")
      .eq("company_requirement_id", requirementId)
      .eq("type_id", docType.id);
    if (groupKeyFilter != null && !Number.isNaN(groupKeyFilter)) {
      query = query.eq("group_key", groupKeyFilter);
    }
    const { data: docRows } = await query;
    if (!docRows?.length) {
      return res.json([]);
    }
    const { data: metaRows } = await supabase
      .from("company_document_metadata")
      .select("real_data_id, file_name")
      .in(
        "real_data_id",
        docRows.map((r) => r.id),
      );
    const metaByRealDataId = new Map(
      (metaRows ?? []).map((m) => [m.real_data_id, m.file_name]),
    );
    const groupKeys = [...new Set(docRows.map((r) => r.group_key))];
    const { data: payDateRows } = await supabase
      .from("company_requirement_real_data")
      .select("group_key, value")
      .eq("company_requirement_id", requirementId)
      .eq("type_id", payDateType.id)
      .in("group_key", groupKeys);
    const payDateByGroup = new Map(
      (payDateRows ?? []).map((r) => [r.group_key, r.value ?? null]),
    );
    const list = docRows
      .filter((r) => r.value != null && r.value.trim() !== "")
      .map((r) => ({
        pay_date: payDateByGroup.get(r.group_key) ?? null,
        key: r.value ?? "",
        file_name: metaByRealDataId.get(r.id) ?? "",
        group_key: r.group_key,
      }));
    list.sort((a, b) => {
      const aDate = a.pay_date ?? "";
      const bDate = b.pay_date ?? "";
      return aDate.localeCompare(bDate);
    });
    res.json(list);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /company-requirement-real-data
 * Query: company_requirement_ids (comma-separated).
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const idsParam = req.query.company_requirement_ids as string | undefined;
    if (!idsParam || !idsParam.trim()) {
      return res.status(400).json({ error: "company_requirement_ids is required" });
    }
    const requirementIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (requirementIds.length === 0) {
      return res.json([]);
    }

    const allowed = await ensureCompanyRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied to one or more requirements" });
    }

    const { data, error } = await supabase
      .from("company_requirement_real_data")
      .select("*")
      .in("company_requirement_id", requirementIds)
      .order("company_requirement_id", { ascending: true })
      .order("group_key", { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

type RealDataRow = {
  company_requirement_id: string;
  group_key: number;
  type_id: string;
  value?: string | null;
};

async function upsertRealDataRows(rows: RealDataRow[]): Promise<void> {
  const now = new Date().toISOString();
  for (const row of rows) {
    const { data: existing } = await supabase
      .from("company_requirement_real_data")
      .select("id")
      .eq("company_requirement_id", row.company_requirement_id)
      .eq("group_key", row.group_key)
      .eq("type_id", row.type_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("company_requirement_real_data")
        .update({
          value: row.value ?? null,
          updated_at: now,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("company_requirement_real_data").insert({
        company_requirement_id: row.company_requirement_id,
        group_key: row.group_key,
        type_id: row.type_id,
        value: row.value ?? null,
      });
    }
  }
}

/**
 * POST /company-requirement-real-data/document
 * Multipart: company_requirement_id, group_key, file.
 */
router.post("/document", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user!.id;
    const requirementId = (req.body?.company_requirement_id as string)?.trim();
    const groupKeyRaw = req.body?.group_key;
    const groupKey = typeof groupKeyRaw === "string" ? parseInt(groupKeyRaw, 10) : Number(groupKeyRaw);
    if (!requirementId || Number.isNaN(groupKey) || groupKey < 1) {
      return res.status(400).json({ error: "company_requirement_id and group_key (number >= 1) are required" });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }
    const allowed = await ensureCompanyRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const r2Key = await uploadCompanyDocumentToR2(
      requirementId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    const { data: docType } = await supabase
      .from("company_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    if (!docType) {
      return res.status(500).json({ error: "Document value type not found" });
    }
    const { data: inserted, error: insertError } = await supabase
      .from("company_requirement_real_data")
      .insert({
        company_requirement_id: requirementId,
        group_key: groupKey,
        type_id: docType.id,
        value: r2Key,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      const message =
        insertError?.message ?? "Failed to insert company_requirement_real_data";
      return res.status(500).json({ error: message });
    }
    const { error: metaError } = await supabase.from("company_document_metadata").insert({
      real_data_id: inserted.id,
      file_name: file.originalname,
      content_type: file.mimetype,
      size_bytes: file.size,
    });
    if (metaError) {
      return res.status(500).json({ error: metaError.message });
    }
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /company-requirement-real-data/document
 * Query: key (R2 key, e.g. company-documents/{requirement_id}/...)
 */
router.delete("/document", async (req, res) => {
  try {
    const userId = req.user!.id;
    const key = req.query.key as string | undefined;
    if (!key || !key.startsWith("company-documents/")) {
      return res.status(400).json({ error: "Invalid or missing key" });
    }
    const parts = key.split("/");
    const requirementId = parts[1];
    if (!requirementId) {
      return res.status(400).json({ error: "Invalid key format" });
    }
    const allowed = await ensureCompanyRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: docType } = await supabase
      .from("company_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    if (!docType) {
      return res.status(500).json({ error: "Document value type not found" });
    }
    const { data: row } = await supabase
      .from("company_requirement_real_data")
      .select("id")
      .eq("company_requirement_id", requirementId)
      .eq("type_id", docType.id)
      .eq("value", key)
      .maybeSingle();
    if (row) {
      await supabase.from("company_requirement_real_data").delete().eq("id", row.id);
    }
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /company-requirement-real-data/record-payment
 * Multipart: rows (JSON string), optional file.
 */
router.post("/record-payment", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user!.id;
    const rowsJson = req.body?.rows as string | undefined;
    if (!rowsJson || typeof rowsJson !== "string") {
      return res.status(400).json({ error: "rows (JSON string) is required" });
    }
    let rows: RealDataRow[];
    try {
      rows = JSON.parse(rowsJson) as RealDataRow[];
    } catch {
      return res.status(400).json({ error: "rows must be valid JSON array" });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows array must not be empty" });
    }

    const requirementIds = [...new Set(rows.map((r) => r.company_requirement_id))];
    const allowed = await ensureCompanyRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied to one or more requirements" });
    }

    const file = req.file;
    if (file) {
      const requirementId = rows[0]!.company_requirement_id;
      const groupKey = rows[0]!.group_key;
      const r2Key = await uploadCompanyDocumentToR2(
        requirementId,
        file.buffer,
        file.originalname,
        file.mimetype
      );

      const { data: docType } = await supabase
        .from("company_requirement_value_types")
        .select("id")
        .eq("name", "Document")
        .maybeSingle();
      if (!docType) {
        return res.status(500).json({ error: "Document value type not found" });
      }
      rows.push({
        company_requirement_id: requirementId,
        group_key: groupKey,
        type_id: docType.id,
        value: r2Key,
      });

      await upsertRealDataRows(rows);

      const { data: docRow } = await supabase
        .from("company_requirement_real_data")
        .select("id")
        .eq("company_requirement_id", requirementId)
        .eq("group_key", groupKey)
        .eq("type_id", docType.id)
        .maybeSingle();
      if (docRow) {
        await supabase.from("company_document_metadata").insert({
          real_data_id: docRow.id,
          file_name: file.originalname,
          content_type: file.mimetype,
          size_bytes: file.size,
        });
      }
    } else {
      await upsertRealDataRows(rows);
    }

    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /company-requirement-real-data
 * Body: { rows: [ { company_requirement_id, group_key, type_id, value? } ] }
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as { rows?: RealDataRow[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return res.status(400).json({ error: "rows array is required and must not be empty" });
    }
    for (const row of body.rows) {
      if (!row.company_requirement_id || typeof row.group_key !== "number" || !row.type_id) {
        return res.status(400).json({ error: "Each row must have company_requirement_id, group_key (number), type_id" });
      }
    }

    const requirementIds = [...new Set(body.rows.map((r) => r.company_requirement_id))];
    const allowed = await ensureCompanyRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied to one or more requirements" });
    }

    await upsertRealDataRows(body.rows);
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
