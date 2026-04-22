import { Router } from "express";
import multer from "multer";
import { supabase } from "../../config/supabase";
import {
  getDocumentPresignedUrl,
  uploadDocumentToR2,
} from "../../lib/r2-upload";
import { markDocumentInboxReviewed } from "../../lib/mark-document-inbox-reviewed";
import { getAuthorizedTenantIds } from "./authorization-helpers";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * 指定要件 ID が自分が admin であるテナントに属するか確認
 */
async function ensureRequirementAccess(
  userId: string,
  requirementIds: string[],
): Promise<boolean> {
  if (requirementIds.length === 0) return true;
  const authorizedTenantIds = await getAuthorizedTenantIds(userId);
  const { data: rows } = await supabase
    .from("tenant_requirements")
    .select("id, tenant_id")
    .in("id", requirementIds);
  return (rows ?? []).every((r) => authorizedTenantIds.includes(r.tenant_id));
}

/**
 * GET /tenant-requirement-real-data/document-url
 * Query: key (R2 object key)
 * Returns presigned GET URL. Access is checked from DB records.
 */
router.get("/document-url", async (req, res) => {
  try {
    const userId = req.user!.id;
    const key = req.query.key as string | undefined;
    if (!key) {
      return res.status(400).json({ error: "Invalid or missing key" });
    }
    const { data: docType } = await supabase
      .from("tenant_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    if (!docType) {
      return res.status(500).json({ error: "Document value type not found" });
    }
    const { data: row, error } = await supabase
      .from("tenant_requirement_real_data")
      .select("tenant_requirement_id")
      .eq("type_id", docType.id)
      .eq("value", key)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }
    const allowed = await ensureRequirementAccess(userId, [
      row.tenant_requirement_id,
    ]);
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
 * GET /tenant-requirement-real-data/documents
 * Query: tenant_requirement_id, optional group_key (filter to that group)
 * Returns list of { pay_date, key, file_name, group_key } for Document rows, sorted by pay_date.
 */
router.get("/documents", async (req, res) => {
  try {
    const userId = req.user!.id;
    const requirementId = req.query.tenant_requirement_id as string | undefined;
    const groupKeyParam = req.query.group_key as string | undefined;
    const groupKeyFilter =
      groupKeyParam != null && groupKeyParam !== ""
        ? parseInt(groupKeyParam, 10)
        : null;
    if (!requirementId?.trim()) {
      return res
        .status(400)
        .json({ error: "tenant_requirement_id is required" });
    }
    const allowed = await ensureRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: docType } = await supabase
      .from("tenant_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    const { data: payDateType } = await supabase
      .from("tenant_requirement_value_types")
      .select("id")
      .eq("name", "Pay date")
      .maybeSingle();
    if (!docType || !payDateType) {
      return res.json([]);
    }
    let query = supabase
      .from("tenant_requirement_real_data")
      .select("id, group_key, value")
      .eq("tenant_requirement_id", requirementId)
      .eq("type_id", docType.id);
    if (groupKeyFilter != null && !Number.isNaN(groupKeyFilter)) {
      query = query.eq("group_key", groupKeyFilter);
    }
    const { data: docRows } = await query;
    if (!docRows?.length) {
      return res.json([]);
    }
    const { data: metaRows } = await supabase
      .from("document_metadata")
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
      .from("tenant_requirement_real_data")
      .select("group_key, value")
      .eq("tenant_requirement_id", requirementId)
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
 * GET /tenant-requirement-real-data
 * Query: tenant_requirement_ids (comma-separated). 指定要件の実データをすべて返す。
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const idsParam = req.query.tenant_requirement_ids as string | undefined;
    if (!idsParam || !idsParam.trim()) {
      return res
        .status(400)
        .json({ error: "tenant_requirement_ids is required" });
    }
    const requirementIds = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (requirementIds.length === 0) {
      return res.json([]);
    }

    const allowed = await ensureRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Access denied to one or more requirements" });
    }

    const { data, error } = await supabase
      .from("tenant_requirement_real_data")
      .select("*")
      .in("tenant_requirement_id", requirementIds)
      .order("tenant_requirement_id", { ascending: true })
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
  tenant_requirement_id: string;
  group_key: number;
  type_id: string;
  value?: string | null;
};

async function insertTenantRequirementDocument(params: {
  requirementId: string;
  groupKey: number;
  r2Key: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: docType } = await supabase
    .from("tenant_requirement_value_types")
    .select("id")
    .eq("name", "Document")
    .maybeSingle();
  if (!docType) {
    return { ok: false, error: "Document value type not found" };
  }
  const { data: inserted, error: insertError } = await supabase
    .from("tenant_requirement_real_data")
    .insert({
      tenant_requirement_id: params.requirementId,
      group_key: params.groupKey,
      type_id: docType.id,
      value: params.r2Key,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return {
      ok: false,
      error:
        insertError?.message ?? "Failed to insert tenant_requirement_real_data",
    };
  }
  const { error: metaError } = await supabase.from("document_metadata").insert({
    real_data_id: inserted.id,
    file_name: params.fileName,
    content_type: params.contentType,
    size_bytes: params.sizeBytes,
  });
  if (metaError) {
    return { ok: false, error: metaError.message };
  }
  return { ok: true };
}

async function upsertRealDataRows(rows: RealDataRow[]): Promise<void> {
  const now = new Date().toISOString();
  for (const row of rows) {
    const { data: existing } = await supabase
      .from("tenant_requirement_real_data")
      .select("id")
      .eq("tenant_requirement_id", row.tenant_requirement_id)
      .eq("group_key", row.group_key)
      .eq("type_id", row.type_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("tenant_requirement_real_data")
        .update({
          value: row.value ?? null,
          updated_at: now,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("tenant_requirement_real_data").insert({
        tenant_requirement_id: row.tenant_requirement_id,
        group_key: row.group_key,
        type_id: row.type_id,
        value: row.value ?? null,
      });
    }
  }
}

/**
 * GET /tenant-requirement-real-data/inbox-picks
 * Query: tenant_id — unreviewed tenant_requirement inbox rows for that tenant.
 */
router.get("/inbox-picks", async (req, res) => {
  try {
    const userId = req.user!.id;
    const tenantId = (req.query.tenant_id as string | undefined)?.trim();
    if (!tenantId) {
      return res.status(400).json({ error: "tenant_id is required" });
    }
    const authorizedTenantIds = await getAuthorizedTenantIds(userId);
    if (!authorizedTenantIds.includes(tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data: picks, error: inErr } = await supabase
      .from("document_inbox")
      .select("id, file_name, created_at, tenant_id")
      .eq("document_type", "tenant_requirement")
      .is("reviewed_at", null)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (inErr) {
      return res.status(500).json({ error: inErr.message });
    }
    res.json(picks ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /tenant-requirement-real-data/document
 * Multipart: tenant_requirement_id, group_key, and either file or document_inbox_id.
 */
router.post("/document", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user!.id;
    const requirementId = (req.body?.tenant_requirement_id as string)?.trim();
    const groupKeyRaw = req.body?.group_key;
    const groupKey =
      typeof groupKeyRaw === "string"
        ? parseInt(groupKeyRaw, 10)
        : Number(groupKeyRaw);
    const documentInboxId = (
      req.body?.document_inbox_id as string | undefined
    )?.trim();
    if (!requirementId || Number.isNaN(groupKey) || groupKey < 1) {
      return res
        .status(400)
        .json({
          error:
            "tenant_requirement_id and group_key (number >= 1) are required",
        });
    }
    const file = req.file;
    if (file && documentInboxId) {
      return res.status(400).json({
        error: "Provide either file or document_inbox_id, not both",
      });
    }
    if (!file && !documentInboxId) {
      return res
        .status(400)
        .json({ error: "file or document_inbox_id is required" });
    }
    const allowed = await ensureRequirementAccess(userId, [requirementId]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (file) {
      const r2Key = await uploadDocumentToR2(
        requirementId,
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      const ins = await insertTenantRequirementDocument({
        requirementId,
        groupKey,
        r2Key,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
      });
      if (ins.ok === false) {
        return res.status(500).json({ error: ins.error });
      }
      return res.status(200).json({ ok: true });
    }

    if (!documentInboxId) {
      return res.status(400).json({ error: "document_inbox_id is required" });
    }

    const { data: trRow, error: trErr } = await supabase
      .from("tenant_requirements")
      .select("tenant_id")
      .eq("id", requirementId)
      .maybeSingle();
    if (trErr) {
      return res.status(500).json({ error: trErr.message });
    }
    if (!trRow) {
      return res.status(404).json({ error: "Requirement not found" });
    }
    const { data: inbox, error: inErr } = await supabase
      .from("document_inbox")
      .select(
        "id, tenant_id, value, file_name, content_type, size_bytes, document_type, reviewed_at",
      )
      .eq("id", documentInboxId)
      .maybeSingle();
    if (inErr) {
      return res.status(500).json({ error: inErr.message });
    }
    if (!inbox) {
      return res.status(404).json({ error: "Inbox row not found" });
    }
    if (inbox.document_type !== "tenant_requirement") {
      return res.status(400).json({ error: "Invalid inbox document type" });
    }
    if (inbox.reviewed_at) {
      return res.status(400).json({ error: "Inbox already completed" });
    }
    if (inbox.tenant_id !== trRow.tenant_id) {
      return res.status(400).json({ error: "Inbox tenant does not match requirement" });
    }
    const ins = await insertTenantRequirementDocument({
      requirementId,
      groupKey,
      r2Key: inbox.value,
      fileName: inbox.file_name,
      contentType: inbox.content_type,
      sizeBytes: inbox.size_bytes,
    });
    if (ins.ok === false) {
      return res.status(500).json({ error: ins.error });
    }
    const marked = await markDocumentInboxReviewed({
      inboxId: documentInboxId,
      userId,
      tenantId: inbox.tenant_id,
    });
    if (marked.ok === false) {
      return res.status(500).json({ error: marked.error });
    }
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /tenant-requirement-real-data/document
 * Query: key (R2 key)
 * Deletes the Document real_data row and document_metadata (CASCADE).
 */
router.delete("/document", async (req, res) => {
  try {
    const userId = req.user!.id;
    const key = req.query.key as string | undefined;
    if (!key) {
      return res.status(400).json({ error: "Invalid or missing key" });
    }
    const { data: docType } = await supabase
      .from("tenant_requirement_value_types")
      .select("id")
      .eq("name", "Document")
      .maybeSingle();
    if (!docType) {
      return res.status(500).json({ error: "Document value type not found" });
    }
    const { data: row } = await supabase
      .from("tenant_requirement_real_data")
      .select("id, tenant_requirement_id")
      .eq("type_id", docType.id)
      .eq("value", key)
      .maybeSingle();
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }
    const allowed = await ensureRequirementAccess(userId, [
      row.tenant_requirement_id,
    ]);
    if (!allowed) {
      return res.status(403).json({ error: "Access denied" });
    }
    await supabase
      .from("tenant_requirement_real_data")
      .delete()
      .eq("id", row.id);
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /tenant-requirement-real-data/record-payment
 * Multipart: rows (JSON string), optional file.
 * Same as POST / but when file is present: upload to R2, add Document row, insert document_metadata.
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

    const requirementIds = [
      ...new Set(rows.map((r) => r.tenant_requirement_id)),
    ];
    const allowed = await ensureRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Access denied to one or more requirements" });
    }

    const file = req.file;
    if (file) {
      const requirementId = rows[0]!.tenant_requirement_id;
      const groupKey = rows[0]!.group_key;
      const r2Key = await uploadDocumentToR2(
        requirementId,
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      const { data: docType } = await supabase
        .from("tenant_requirement_value_types")
        .select("id")
        .eq("name", "Document")
        .maybeSingle();
      if (!docType) {
        return res.status(500).json({ error: "Document value type not found" });
      }
      rows.push({
        tenant_requirement_id: requirementId,
        group_key: groupKey,
        type_id: docType.id,
        value: r2Key,
      });

      await upsertRealDataRows(rows);

      const { data: docRow } = await supabase
        .from("tenant_requirement_real_data")
        .select("id")
        .eq("tenant_requirement_id", requirementId)
        .eq("group_key", groupKey)
        .eq("type_id", docType.id)
        .maybeSingle();
      if (docRow) {
        await supabase.from("document_metadata").insert({
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
 * POST /tenant-requirement-real-data
 * Body: { rows: [ { tenant_requirement_id, group_key, type_id, value? } ] }
 * data_type は value_types 側で定義されているため送不要。各 row について既存があれば update、なければ insert。
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as { rows?: RealDataRow[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "rows array is required and must not be empty" });
    }
    for (const row of body.rows) {
      if (
        !row.tenant_requirement_id ||
        typeof row.group_key !== "number" ||
        !row.type_id
      ) {
        return res
          .status(400)
          .json({
            error:
              "Each row must have tenant_requirement_id, group_key (number), type_id",
          });
      }
    }

    const requirementIds = [
      ...new Set(body.rows.map((r) => r.tenant_requirement_id)),
    ];
    const allowed = await ensureRequirementAccess(userId, requirementIds);
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Access denied to one or more requirements" });
    }

    await upsertRealDataRows(body.rows);
    res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
