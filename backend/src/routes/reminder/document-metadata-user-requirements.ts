import { Router } from "express";
import multer from "multer";
import { supabase } from "../../config/supabase";
import {
  deleteObjectFromR2,
  getDocumentPresignedUrl,
  uploadEmployeeRequirementDocumentToR2,
} from "../../lib/r2-upload";
import {
  getAuthorizedCompanyIds,
  getCompanyIdsForUserViaProfiles,
  hasAnyCompanyAccess,
} from "./authorization-helpers";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function ensureMappingDocumentAccess(
  requestUserId: string,
  mappingId: string
): Promise<boolean> {
  const allowed = await hasAnyCompanyAccess(requestUserId);
  if (!allowed) return false;

  const authorizedCompanyIds = await getAuthorizedCompanyIds(requestUserId);
  if (authorizedCompanyIds.length === 0) return false;

  const { data: mapping, error } = await supabase
    .from("mapping_user_requirements")
    .select("id, user_id, user_requirement_id")
    .eq("id", mappingId)
    .maybeSingle();
  if (error || !mapping) return false;

  const { data: requirement } = await supabase
    .from("user_requirements")
    .select("company_id")
    .eq("id", mapping.user_requirement_id)
    .maybeSingle();
  if (
    !requirement?.company_id ||
    !authorizedCompanyIds.includes(requirement.company_id)
  ) {
    return false;
  }

  const targetCompanyIds = await getCompanyIdsForUserViaProfiles(
    mapping.user_id
  );
  return targetCompanyIds.includes(requirement.company_id);
}

/**
 * GET /document-metadata-user-requirements/document-url
 * Query: key (R2 object key)
 */
router.get("/document-url", async (req, res) => {
  try {
    const key = req.query.key as string | undefined;
    if (!key) {
      return res.status(400).json({ error: "Invalid or missing key" });
    }
    const { data: row, error } = await supabase
      .from("document_metadata_user_requirements")
      .select("mapping_user_requirement_id")
      .eq("value", key)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!row) {
      return res.status(404).json({ error: "Document not found" });
    }
    const ok = await ensureMappingDocumentAccess(
      req.user!.id,
      row.mapping_user_requirement_id
    );
    if (!ok) {
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
 * GET /document-metadata-user-requirements/documents
 * Query: mapping_user_requirement_id
 */
router.get("/documents", async (req, res) => {
  try {
    const mappingId = (
      req.query.mapping_user_requirement_id as string | undefined
    )?.trim();
    if (!mappingId) {
      return res
        .status(400)
        .json({ error: "mapping_user_requirement_id is required" });
    }
    const ok = await ensureMappingDocumentAccess(req.user!.id, mappingId);
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { data, error } = await supabase
      .from("document_metadata_user_requirements")
      .select("id, value, file_name, content_type, size_bytes, created_at")
      .eq("mapping_user_requirement_id", mappingId)
      .order("created_at", { ascending: false });
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data ?? []);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /document-metadata-user-requirements/document
 * Multipart: mapping_user_requirement_id, file
 */
router.post("/document", upload.single("file"), async (req, res) => {
  try {
    const mappingId = (
      req.body?.mapping_user_requirement_id as string | undefined
    )?.trim();
    if (!mappingId) {
      return res.status(400).json({
        error: "mapping_user_requirement_id is required",
      });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }
    const ok = await ensureMappingDocumentAccess(req.user!.id, mappingId);
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }
    const r2Key = await uploadEmployeeRequirementDocumentToR2(
      mappingId,
      file.buffer,
      file.originalname,
      file.mimetype
    );
    const { data: inserted, error: insertError } = await supabase
      .from("document_metadata_user_requirements")
      .insert({
        mapping_user_requirement_id: mappingId,
        value: r2Key,
        file_name: file.originalname,
        content_type: file.mimetype,
        size_bytes: file.size,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      try {
        await deleteObjectFromR2(r2Key);
      } catch {
        /* best effort */
      }
      return res.status(500).json({
        error: insertError?.message ?? "Failed to save document metadata",
      });
    }
    res.status(201).json({ ok: true, id: inserted.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /document-metadata-user-requirements/document
 * Query: id (document_metadata_user_requirements row id)
 */
router.delete("/document", async (req, res) => {
  try {
    const id = (req.query.id as string | undefined)?.trim();
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    const { data: row, error } = await supabase
      .from("document_metadata_user_requirements")
      .select("id, value, mapping_user_requirement_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !row) {
      return res.status(404).json({ error: "Document not found" });
    }
    const ok = await ensureMappingDocumentAccess(
      req.user!.id,
      row.mapping_user_requirement_id
    );
    if (!ok) {
      return res.status(403).json({ error: "Access denied" });
    }
    await supabase.from("document_metadata_user_requirements").delete().eq("id", id);
    try {
      if (row.value) {
        await deleteObjectFromR2(row.value);
      }
    } catch {
      /* R2 delete best effort */
    }
    res.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
