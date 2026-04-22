/**
 * Document Box / inbox API。
 * 認可は company::manage_tenant_team（company_admin / company_director のみ）。
 * Items の Import invoice（document-metadata-invoices）は tenant 向けのまま。
 */
import { Router } from "express";
import { supabase } from "../config/supabase";
import { getDocumentPresignedUrl } from "../lib/r2-upload";
import { UnifiedCompanyAction } from "../authz/unified/authorize";
import { unifiedAuthorizationMiddleware } from "../middleware/unified-authorization";
import { getUnifiedTenantResource } from "../middleware/unified-resource-helpers";
import { withTenantFilter } from "../middleware/tenant-filter";
import { markDocumentInboxReviewed } from "../lib/mark-document-inbox-reviewed";

const router = Router();

const INBOX_TYPES = new Set([
  "invoice",
  "company_requirement",
  "tenant_requirement",
  "employee_requirement",
]);

export type DocumentBoxRow =
  {
    kind: "inbox";
    id: string;
    file_name: string;
    value: string;
    content_type: string | null;
    created_at: string;
    sent_by_name: string | null;
    document_type: string | null;
  };

/**
 * GET /document-inbox/for-document-box
 * Returns unreviewed inbox rows for Document Box.
 */
router.get(
  "/for-document-box",
  unifiedAuthorizationMiddleware(
    UnifiedCompanyAction.manage_tenant_team,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      let inboxQuery = supabase
        .from("document_inbox")
        .select(
          "id, file_name, value, content_type, created_at, document_type, created_by"
        )
        .is("document_type", null)
        .is("reviewed_at", null)
        .order("created_at", { ascending: false });

      inboxQuery = withTenantFilter(inboxQuery, req);

      const { data: inboxRows, error: inboxErr } = await inboxQuery;
      if (inboxErr) {
        return res.status(500).json({ error: inboxErr.message });
      }

      const inboxCreatedBy = [
        ...new Set((inboxRows ?? []).map((r) => r.created_by).filter(Boolean)),
      ] as string[];
      const displayByUserId = new Map<string, string | null>();
      if (inboxCreatedBy.length > 0) {
        const { data: inboxUsers, error: iuErr } = await supabase
          .from("users")
          .select("id, display_name")
          .in("id", inboxCreatedBy);
        if (iuErr) {
          return res.status(500).json({ error: iuErr.message });
        }
        for (const u of inboxUsers ?? []) {
          displayByUserId.set(u.id, u.display_name ?? null);
        }
      }

      const inboxMapped: DocumentBoxRow[] = (inboxRows ?? []).map((row) => ({
        kind: "inbox",
        id: row.id,
        file_name: row.file_name,
        value: row.value,
        content_type: row.content_type ?? null,
        created_at: row.created_at,
        sent_by_name: displayByUserId.get(row.created_by) ?? null,
        document_type: row.document_type ?? null,
      }));

      const merged = [...inboxMapped].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      res.json(merged);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /document-inbox/document-url?key=
 */
router.get(
  "/document-url",
  unifiedAuthorizationMiddleware(
    UnifiedCompanyAction.manage_tenant_team,
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
        .from("document_inbox")
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
 * PATCH /document-inbox/:id/classify
 * body: { document_type: 'invoice' | ... }
 */
router.patch(
  "/:id/classify",
  unifiedAuthorizationMiddleware(
    UnifiedCompanyAction.manage_tenant_team,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const { id } = req.params;
      const documentType = req.body?.document_type as string | undefined;
      if (!documentType || !INBOX_TYPES.has(documentType)) {
        return res.status(400).json({ error: "Invalid document_type" });
      }

      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("document_inbox")
        .update({
          document_type: documentType,
          classified_at: now,
          classified_by: req.user!.id,
        })
        .eq("id", id)
        .eq("tenant_id", selectedTenantId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /document-inbox/:id/create-invoice-metadata
 * Import Invoiceモーダルの最終 Import 時に呼ぶ。document_metadata_invoices に1行 INSERT。
 */
router.post(
  "/:id/create-invoice-metadata",
  unifiedAuthorizationMiddleware(
    UnifiedCompanyAction.manage_tenant_team,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const { id: inboxId } = req.params;
      const vendorId = (req.body?.vendor_id as string | undefined)?.trim();
      const invoiceDate = (req.body?.invoice_date as string | undefined)?.trim();
      const totalAmountRaw = req.body?.total_amount;

      if (!vendorId) {
        return res.status(400).json({ error: "vendor_id is required" });
      }
      if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
        return res.status(400).json({ error: "invoice_date must be YYYY-MM-DD" });
      }
      const totalAmount = Number(totalAmountRaw);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return res
          .status(400)
          .json({ error: "total_amount must be a positive number" });
      }

      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const { data: inbox, error: inboxErr } = await supabase
        .from("document_inbox")
        .select(
          "id, tenant_id, value, file_name, content_type, size_bytes, document_type, reviewed_at"
        )
        .eq("id", inboxId)
        .eq("tenant_id", selectedTenantId)
        .maybeSingle();

      if (inboxErr) {
        return res.status(500).json({ error: inboxErr.message });
      }
      if (!inbox) {
        return res.status(404).json({ error: "Inbox row not found" });
      }
      if (inbox.document_type !== "invoice") {
        return res.status(400).json({ error: "Inbox row is not classified as invoice" });
      }
      if (inbox.reviewed_at) {
        return res.status(400).json({ error: "Inbox row already completed" });
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("document_metadata_invoices")
        .insert({
          tenant_id: selectedTenantId,
          vendor_id: vendorId,
          value: inbox.value,
          file_name: inbox.file_name,
          content_type: inbox.content_type,
          size_bytes: inbox.size_bytes,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          created_by: req.user!.id,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        return res.status(500).json({
          error: insertErr?.message ?? "Failed to create invoice metadata",
        });
      }

      res.status(201).json({ invoice_id: inserted.id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /document-inbox/:id/mark-reviewed
 * Import Invoiceモーダルの最終 Import 成功後に inbox を reviewed にする。
 */
router.post(
  "/:id/mark-reviewed",
  unifiedAuthorizationMiddleware(
    UnifiedCompanyAction.manage_tenant_team,
    getUnifiedTenantResource
  ),
  async (req, res) => {
    try {
      const { id: inboxId } = req.params;
      const selectedTenantId =
        req.user!.selected_tenant_id || req.user!.tenant_ids[0];
      if (!selectedTenantId) {
        return res.status(400).json({ error: "No tenant associated" });
      }

      const { data: inbox, error: inboxErr } = await supabase
        .from("document_inbox")
        .select("id, reviewed_at, document_type")
        .eq("id", inboxId)
        .eq("tenant_id", selectedTenantId)
        .maybeSingle();

      if (inboxErr) {
        return res.status(500).json({ error: inboxErr.message });
      }
      if (!inbox) {
        return res.status(404).json({ error: "Inbox row not found" });
      }
      if (inbox.document_type !== "invoice") {
        return res.status(400).json({ error: "Inbox row is not classified as invoice" });
      }
      if (inbox.reviewed_at) {
        return res.status(400).json({ error: "Inbox already completed" });
      }

      const marked = await markDocumentInboxReviewed({
        inboxId,
        userId: req.user!.id,
        tenantId: selectedTenantId,
      });
      if (marked.ok === false) {
        return res.status(500).json({ error: marked.error });
      }

      res.json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
