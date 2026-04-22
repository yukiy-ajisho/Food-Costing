import { Router } from "express";
import multer from "multer";
import { supabase } from "../config/supabase";
import {
  deleteObjectFromR2,
  getDocumentPresignedUrl,
  uploadInvoiceDocumentToR2,
} from "../lib/r2-upload";
import { UnifiedTenantAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * POST /document-metadata-invoices/document
 * Multipart: vendor_id, invoice_date (YYYY-MM-DD), total_amount, file
 * → R2 にアップロードして document_metadata_invoices に INSERT。{ id } を返す。
 */
router.post(
  "/document",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.create_item,
    getUnifiedTenantResource
  ),
  upload.single("file"),
  async (req, res) => {
    try {
      const vendorId = (req.body?.vendor_id as string | undefined)?.trim();
      const invoiceDate = (req.body?.invoice_date as string | undefined)?.trim();
      const totalAmountRaw = req.body?.total_amount;
      const totalAmount = Number(totalAmountRaw);
      const file = req.file;

      if (!vendorId) {
        return res.status(400).json({ error: "vendor_id is required" });
      }
      if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
        return res.status(400).json({ error: "invoice_date must be YYYY-MM-DD" });
      }
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({ error: "total_amount must be a positive number" });
      }
      if (!file) {
        return res.status(400).json({ error: "file is required" });
      }

      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const r2Key = await uploadInvoiceDocumentToR2(
        selectedTenantId,
        file.buffer,
        file.originalname,
        file.mimetype
      );

      const { data: inserted, error: insertError } = await supabase
        .from("document_metadata_invoices")
        .insert({
          tenant_id: selectedTenantId,
          vendor_id: vendorId,
          value: r2Key,
          file_name: file.originalname,
          content_type: file.mimetype,
          size_bytes: file.size,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          created_by: req.user!.id,
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
          error: insertError?.message ?? "Failed to save invoice document metadata",
        });
      }

      res.status(201).json({ ok: true, id: inserted.id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /document-metadata-invoices/document-url
 * Query: key (R2 object key)
 */
router.get(
  "/document-url",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.read_resource,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const key = req.query.key as string | undefined;
      if (!key) {
        return res.status(400).json({ error: "Invalid or missing key" });
      }
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const { data: row, error } = await supabase
        .from("document_metadata_invoices")
        .select("id")
        .eq("tenant_id", selectedTenantId)
        .eq("value", key)
        .maybeSingle();
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      if (!row) {
        return res.status(403).json({ error: "Access denied" });
      }

      const url = await getDocumentPresignedUrl(key);
      res.json({ url });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /document-metadata-invoices
 * テナントの invoice 一覧を vendor name 込みで invoice_date 降順で返す
 */
router.get(
  "/",
  unifiedAuthorizationMiddleware(
    UnifiedTenantAction.list_resources,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      let query = supabase
        .from("document_metadata_invoices")
        .select(
          `
          id,
          vendor_id,
          value,
          file_name,
          content_type,
          size_bytes,
          invoice_date,
          total_amount,
          created_at,
          vendors ( name )
        `
        )
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false });

      query = withTenantFilter(query, req);

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const rows = (data ?? []).map((row) => {
        const vendorRaw = row.vendors;
        const vendor = Array.isArray(vendorRaw) ? vendorRaw[0] : vendorRaw;
        return {
          id: row.id,
          vendor_id: row.vendor_id,
          vendor_name: (vendor?.name as string | null) ?? null,
          value: row.value,
          file_name: row.file_name,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
          invoice_date: row.invoice_date,
          total_amount:
            row.total_amount == null || row.total_amount === ""
              ? null
              : Number(row.total_amount),
          created_at: row.created_at,
        };
      });

      res.json(rows);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
