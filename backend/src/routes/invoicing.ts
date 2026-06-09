import { Router, type NextFunction, type Request, type Response } from "express";
import { supabase } from "../config/supabase";
import { authorizeInvoicingAccess } from "../authz/unified/authorize";
import { withTenantFilter } from "../middleware/tenant-filter";
import { sendInvoiceEmail } from "../services/email";
import {
  allocateInvoiceNumber,
  computeInvoicingSubTotal,
  subTotalsMatch,
} from "../lib/invoicing-calc";
import {
  formatInvoiceDateTimeDisplayUtc,
  parseOptionalInvoiceDateYmd,
  parseRequiredInvoiceDateTime,
  resolveInvoiceNumberCalendarYmd,
} from "../lib/invoicing-datetime";
import {
  INVOICE_COLUMNS,
  LIST_COLUMNS,
  assertDeliverySiteInTenant,
  assertInvoicingAccountInTenant,
  assertWholesaleListInTenant,
  buildInitialLines,
  computeInvoiceWholesaleCosts,
  enrichInvoiceListLines,
  fetchEffectiveEachGramsByItemIds,
  fetchInvoicingItemCandidates,
  mergeUnitSizesIntoListLines,
  normalizeInvoiceBoxLines,
  normalizeInvoiceListLines,
  validateBoxLineCostsAgainstRpc,
  validateBoxLinesCoverAllListLines,
  validateInvoicingItemIds,
  validateInvoicingItemsForWholesaleList,
  type InvoiceBoxLineJson,
} from "../services/invoicing-data";

const router = Router();

router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const tenantId =
      req.user.selected_tenant_id || req.user.tenant_ids[0] || undefined;
    if (!tenantId) {
      return res.status(403).json({ error: "No tenant associated" });
    }
    const mode =
      req.method === "GET" || req.method === "HEAD" ? "read" : "manage";
    const allowed = await authorizeInvoicingAccess(
      req.user.id,
      tenantId,
      mode,
      req.user.roles,
    );
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }
    next();
  } catch (e: unknown) {
    console.error("Invoicing authorization error:", e);
    return res.status(500).json({ error: "Authorization check failed" });
  }
});

function resolveTenantId(req: Request): string {
  const tenantId =
    req.user!.selected_tenant_id || req.user!.tenant_ids[0] || undefined;
  if (!tenantId) {
    throw new Error("No tenant associated");
  }
  return tenantId;
}

const DELIVERY_SITE_COLUMNS =
  "id, tenant_id, account_id, name, street, city, state, zip, phone_1, phone_2, email, created_at, updated_at";

const ACCOUNT_COLUMNS =
  "id, tenant_id, company_name, poc_phone, poc_email, created_at, updated_at";

type DeliverySiteBody = {
  account_id?: string;
  name?: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone_1?: string | null;
  phone_2?: string | null;
  email?: string;
};

type InvoicingAccountBody = {
  company_name?: string;
  poc_phone?: string | null;
  poc_email?: string | null;
};

type DeliverySiteRow = {
  id: string;
  tenant_id: string;
  account_id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email: string;
  created_at?: string;
  updated_at?: string;
  invoicing_accounts?: { company_name: string } | { company_name: string }[] | null;
};

function mapDeliverySiteRow(row: DeliverySiteRow) {
  const joined = row.invoicing_accounts;
  const company_name = Array.isArray(joined)
    ? joined[0]?.company_name
    : joined?.company_name;
  const { invoicing_accounts: _a, ...rest } = row;
  return { ...rest, company_name: company_name ?? "" };
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDeliverySiteBody(body: DeliverySiteBody): {
  account_id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email: string;
} | { error: string } {
  const account_id = body.account_id?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  if (!account_id) return { error: "account_id is required" };
  if (!name) return { error: "name is required" };
  if (!email) return { error: "email is required" };
  return {
    account_id,
    name,
    email,
    street: normalizeOptionalText(body.street),
    city: normalizeOptionalText(body.city),
    state: normalizeOptionalText(body.state),
    zip: normalizeOptionalText(body.zip),
    phone_1: normalizeOptionalText(body.phone_1),
    phone_2: normalizeOptionalText(body.phone_2),
  };
}

function parseInvoicingAccountBody(body: InvoicingAccountBody): {
  company_name: string;
  poc_phone: string | null;
  poc_email: string | null;
} | { error: string } {
  const company_name = body.company_name?.trim() ?? "";
  if (!company_name) return { error: "company_name is required" };
  return {
    company_name,
    poc_phone: normalizeOptionalText(body.poc_phone),
    poc_email: normalizeOptionalText(body.poc_email),
  };
}

async function fetchExistingInvoiceNumbers(
  tenantId: string,
  prefix: string,
): Promise<string[]> {
  const { data, error: numErr } = await supabase
    .from("invoice_box_invoices")
    .select("invoice_number")
    .eq("tenant_id", tenantId)
    .like("invoice_number", `${prefix}%`);
  if (numErr) throw new Error(numErr.message);
  return (data ?? []).map((r) => r.invoice_number);
}

/**
 * GET /invoicing/accounts
 */
router.get("/accounts", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { data, error } = await withTenantFilter(
      supabase
        .from("invoicing_accounts")
        .select(ACCOUNT_COLUMNS)
        .order("company_name", { ascending: true }),
      req,
    );

    if (error) {
      console.error(`invoicing_accounts list error (tenant ${tenantId}):`, error);
      return res.status(500).json({ error: "Failed to list accounts" });
    }

    res.json({ accounts: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/accounts
 */
router.post("/accounts", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const parsed = parseInvoicingAccountBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const { data, error } = await supabase
      .from("invoicing_accounts")
      .insert({ tenant_id: tenantId, ...parsed })
      .select(ACCOUNT_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "An account with this company name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ account: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /invoicing/accounts/:id
 */
router.patch("/accounts/:id", async (req, res) => {
  try {
    const accountId = req.params.id?.trim();
    if (!accountId) return res.status(400).json({ error: "id is required" });

    const parsed = parseInvoicingAccountBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const { data: existing, error: fetchError } = await withTenantFilter(
      supabase.from("invoicing_accounts").select("id").eq("id", accountId),
      req,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { data, error } = await withTenantFilter(
      supabase
        .from("invoicing_accounts")
        .update(parsed)
        .eq("id", accountId)
        .select(ACCOUNT_COLUMNS),
      req,
    ).single();

    if (error) {
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "An account with this company name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    res.json({ account: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/accounts/:id
 */
router.delete("/accounts/:id", async (req, res) => {
  try {
    const accountId = req.params.id?.trim();
    if (!accountId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchError } = await withTenantFilter(
      supabase.from("invoicing_accounts").select("id").eq("id", accountId),
      req,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { error } = await withTenantFilter(
      supabase.from("invoicing_accounts").delete().eq("id", accountId),
      req,
    );

    if (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          error:
            "Cannot delete: one or more delivery sites still reference this account",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/delivery-sites
 */
router.get("/delivery-sites", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { data, error } = await withTenantFilter(
      supabase
        .from("delivery_sites")
        .select(
          `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
        )
        .order("name", { ascending: true }),
      req,
    );

    if (error) {
      console.error(`delivery_sites list error (tenant ${tenantId}):`, error);
      return res.status(500).json({ error: "Failed to list delivery sites" });
    }

    res.json({
      sites: (data ?? []).map((row) =>
        mapDeliverySiteRow(row as DeliverySiteRow),
      ),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/delivery-sites
 */
router.post("/delivery-sites", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const parsed = parseDeliverySiteBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const accountOk = await assertInvoicingAccountInTenant(
      tenantId,
      parsed.account_id,
    );
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const { data, error } = await supabase
      .from("delivery_sites")
      .insert({
        tenant_id: tenantId,
        ...parsed,
      })
      .select(
        `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error:
            "A delivery site with this site name already exists for the selected account",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      site: mapDeliverySiteRow(data as DeliverySiteRow),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /invoicing/delivery-sites/:id
 */
router.patch("/delivery-sites/:id", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const siteId = req.params.id?.trim();
    if (!siteId) return res.status(400).json({ error: "id is required" });

    const parsed = parseDeliverySiteBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const accountOk = await assertInvoicingAccountInTenant(
      tenantId,
      parsed.account_id,
    );
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const { data: existing, error: fetchError } = await withTenantFilter(
      supabase.from("delivery_sites").select("id").eq("id", siteId),
      req,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Delivery site not found" });
    }

    const { data, error } = await withTenantFilter(
      supabase
        .from("delivery_sites")
        .update(parsed)
        .eq("id", siteId)
        .select(
          `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
        ),
      req,
    ).single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error:
            "A delivery site with this site name already exists for the selected account",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.json({ site: mapDeliverySiteRow(data as DeliverySiteRow) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/preview-invoice-number
 * Provisional invoice number for PDF preview (not reserved).
 */
router.post("/preview-invoice-number", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const deliverySiteId = String(req.body?.delivery_site_id ?? "").trim();
    if (!deliverySiteId) {
      return res.status(400).json({ error: "delivery_site_id is required" });
    }

    const invoiceDateParsed = parseRequiredInvoiceDateTime(
      req.body?.invoice_date,
      "invoice_date",
    );
    if (typeof invoiceDateParsed === "object" && "error" in invoiceDateParsed) {
      return res.status(400).json({ error: invoiceDateParsed.error });
    }
    const invoiceDateIso = invoiceDateParsed as string;

    const invoiceDateYmdResult = parseOptionalInvoiceDateYmd(
      req.body?.invoice_date_ymd,
    );
    if (
      invoiceDateYmdResult !== null &&
      typeof invoiceDateYmdResult === "object" &&
      "error" in invoiceDateYmdResult
    ) {
      return res.status(400).json({ error: invoiceDateYmdResult.error });
    }
    const invoiceDateYmd =
      typeof invoiceDateYmdResult === "string" ? invoiceDateYmdResult : null;
    const invoiceCalendarYmd = resolveInvoiceNumberCalendarYmd(
      invoiceDateIso,
      invoiceDateYmd,
    );

    const siteOk = await assertDeliverySiteInTenant(tenantId, deliverySiteId);
    if (!siteOk) {
      return res.status(400).json({ error: "Invalid delivery_site_id" });
    }

    const { data: site, error: siteErr } = await supabase
      .from("delivery_sites")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("id", deliverySiteId)
      .maybeSingle();
    if (siteErr) return res.status(500).json({ error: siteErr.message });
    if (!site) return res.status(404).json({ error: "Delivery site not found" });

    const invoiceNumber = await allocateInvoiceNumber(
      tenantId,
      site.name,
      invoiceCalendarYmd,
      (prefix) => fetchExistingInvoiceNumbers(tenantId, prefix),
    );

    res.json({ invoice_number: invoiceNumber });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/delivery-sites/:id
 */
router.delete("/delivery-sites/:id", async (req, res) => {
  try {
    const siteId = req.params.id?.trim();
    if (!siteId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchError } = await withTenantFilter(
      supabase.from("delivery_sites").select("id").eq("id", siteId),
      req,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Delivery site not found" });
    }

    const { error } = await withTenantFilter(
      supabase.from("delivery_sites").delete().eq("id", siteId),
      req,
    );

    if (error) {
      if (error.code === "23503") {
        return res.status(409).json({
          error:
            "Cannot delete: one or more invoice lists still reference this delivery site",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(204).send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/item-candidates
 * Tenant-owned prepped/menu only (no cross-tenant).
 */
router.get("/item-candidates", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const items = await fetchInvoicingItemCandidates(tenantId);
    res.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/lists
 */
router.get("/lists", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("invoice_lists")
        .select("id, name, delivery_site_id, created_at, updated_at")
        .order("name"),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ lists: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/lists
 * Body: { name, delivery_site_id, wholesale_list_id, item_ids: string[] }
 */
router.post("/lists", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const userId = req.user!.id;
    const name = String(req.body?.name ?? "").trim();
    const deliverySiteId = String(req.body?.delivery_site_id ?? "").trim();
    const wholesaleListId = String(req.body?.wholesale_list_id ?? "").trim();
    const itemIds = Array.isArray(req.body?.item_ids)
      ? (req.body.item_ids as string[]).filter(Boolean)
      : [];

    if (!name) return res.status(400).json({ error: "name is required" });
    if (!deliverySiteId) {
      return res.status(400).json({ error: "delivery_site_id is required" });
    }
    if (!wholesaleListId) {
      return res.status(400).json({ error: "wholesale_list_id is required" });
    }
    if (itemIds.length === 0) {
      return res.status(400).json({ error: "At least one item is required" });
    }

    const siteOk = await assertDeliverySiteInTenant(tenantId, deliverySiteId);
    if (!siteOk) {
      return res.status(400).json({ error: "Invalid delivery_site_id" });
    }

    const wlOk = await assertWholesaleListInTenant(tenantId, wholesaleListId);
    if (!wlOk) {
      return res.status(400).json({ error: "Invalid wholesale_list_id" });
    }

    const validIds = await validateInvoicingItemIds(tenantId, itemIds);
    if (validIds.length !== itemIds.length) {
      return res.status(400).json({
        error: "One or more items are invalid or not in this tenant",
      });
    }

    const wholesaleItemError = await validateInvoicingItemsForWholesaleList(
      wholesaleListId,
      validIds,
    );
    if (wholesaleItemError) {
      return res.status(400).json({ error: wholesaleItemError });
    }

    const lines = buildInitialLines(validIds);
    const { data: list, error } = await supabase
      .from("invoice_lists")
      .insert({
        tenant_id: tenantId,
        name,
        delivery_site_id: deliverySiteId,
        wholesale_list_id: wholesaleListId,
        lines,
        created_by: userId,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "An invoice list with this name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    const items = await enrichInvoiceListLines(tenantId, lines);
    const { data: site } = await supabase
      .from("delivery_sites")
      .select("id, name, email")
      .eq("id", deliverySiteId)
      .maybeSingle();

    res.status(201).json({
      list,
      items,
      delivery_site: site ?? null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/lists/:id
 */
router.get("/lists/:id", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const listId = req.params.id?.trim();
    if (!listId) return res.status(400).json({ error: "id is required" });

    const { data: list, error: listErr } = await withTenantFilter(
      supabase.from("invoice_lists").select(LIST_COLUMNS).eq("id", listId),
      req,
    ).maybeSingle();
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const normalized = normalizeInvoiceListLines(list.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    const items = await enrichInvoiceListLines(tenantId, normalized);
    const { data: siteRow } = await supabase
      .from("delivery_sites")
      .select(
        `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
      )
      .eq("id", list.delivery_site_id)
      .maybeSingle();

    const delivery_site = siteRow
      ? mapDeliverySiteRow(siteRow as DeliverySiteRow)
      : null;

    res.json({ list: { ...list, lines: normalized }, items, delivery_site });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /invoicing/lists/:id
 * Body: { name?, delivery_site_id?, wholesale_list_id?, lines? }
 */
router.patch("/lists/:id", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const listId = req.params.id?.trim();
    if (!listId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchErr } = await withTenantFilter(
      supabase
        .from("invoice_lists")
        .select("id, wholesale_list_id")
        .eq("id", listId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "List not found" });

    const patch: Record<string, unknown> = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      patch.name = name;
    }
    if (req.body?.delivery_site_id != null) {
      const deliverySiteId = String(req.body.delivery_site_id).trim();
      if (!deliverySiteId) {
        return res.status(400).json({ error: "delivery_site_id cannot be empty" });
      }
      const siteOk = await assertDeliverySiteInTenant(tenantId, deliverySiteId);
      if (!siteOk) {
        return res.status(400).json({ error: "Invalid delivery_site_id" });
      }
      patch.delivery_site_id = deliverySiteId;
    }
    if (req.body?.wholesale_list_id != null) {
      const wholesaleListId = String(req.body.wholesale_list_id).trim();
      if (!wholesaleListId) {
        return res.status(400).json({ error: "wholesale_list_id cannot be empty" });
      }
      const wlOk = await assertWholesaleListInTenant(tenantId, wholesaleListId);
      if (!wlOk) {
        return res.status(400).json({ error: "Invalid wholesale_list_id" });
      }
      patch.wholesale_list_id = wholesaleListId;
    }
    if (req.body?.lines != null) {
      const normalized = normalizeInvoiceListLines(req.body.lines);
      if ("error" in normalized) {
        return res.status(400).json({ error: normalized.error });
      }
      const itemIds = normalized.map((l) => l.item_id);
      const validIds = await validateInvoicingItemIds(tenantId, itemIds);
      if (validIds.length !== itemIds.length) {
        return res.status(400).json({
          error: "One or more items are invalid or not in this tenant",
        });
      }
      const effectiveWholesaleListId =
        (patch.wholesale_list_id as string | undefined) ??
        existing.wholesale_list_id;
      if (!effectiveWholesaleListId) {
        return res.status(400).json({
          error: "List has no wholesale price list configured",
        });
      }
      patch.lines = normalized;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data: list, error } = await withTenantFilter(
      supabase
        .from("invoice_lists")
        .update(patch)
        .eq("id", listId)
        .select(LIST_COLUMNS),
      req,
    ).single();

    if (error) {
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "An invoice list with this name already exists" });
      }
      return res.status(400).json({ error: error.message });
    }

    const normalized = normalizeInvoiceListLines(list.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }
    const items = await enrichInvoiceListLines(tenantId, normalized);
    const { data: site } = await supabase
      .from("delivery_sites")
      .select("id, name, email")
      .eq("id", list.delivery_site_id)
      .maybeSingle();

    res.json({
      list: { ...list, lines: normalized },
      items,
      delivery_site: site ?? null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/lists/:id
 */
router.delete("/lists/:id", async (req, res) => {
  try {
    const listId = req.params.id?.trim();
    if (!listId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchErr } = await withTenantFilter(
      supabase.from("invoice_lists").select("id").eq("id", listId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "List not found" });

    const { error } = await withTenantFilter(
      supabase.from("invoice_lists").delete().eq("id", listId),
      req,
    );
    if (error) return res.status(400).json({ error: error.message });
    res.status(204).send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/lists/:id/costs
 */
router.get("/lists/:id/costs", async (req, res) => {
  try {
    resolveTenantId(req);
    const listId = req.params.id?.trim();
    if (!listId) return res.status(400).json({ error: "id is required" });

    const { data: list, error: listErr } = await withTenantFilter(
      supabase.from("invoice_lists").select("lines").eq("id", listId),
      req,
    ).maybeSingle();
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    const normalized = normalizeInvoiceListLines(list.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    const { data: listMeta, error: metaErr } = await withTenantFilter(
      supabase
        .from("invoice_lists")
        .select("wholesale_list_id")
        .eq("id", listId),
      req,
    ).maybeSingle();
    if (metaErr) return res.status(500).json({ error: metaErr.message });
    if (!listMeta) return res.status(404).json({ error: "List not found" });
    if (!listMeta.wholesale_list_id) {
      return res.status(400).json({
        error: "List has no wholesale price list configured",
      });
    }

    const itemIds = normalized.map((l) => l.item_id);
    const costs = await computeInvoiceWholesaleCosts(
      listMeta.wholesale_list_id,
      itemIds,
    );
    res.json({ costs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

function parseOptionalIsoDate(
  value: unknown,
  field: string,
): string | null | { error: string } {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { error: `${field} must be YYYY-MM-DD` };
  }
  return s;
}

async function validateBoxInvoiceAmounts(
  tenantId: string,
  lines: InvoiceBoxLineJson[],
  totalAmount: number,
): Promise<string | null> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "At least one line is required";
  }
  const itemIds = lines.map((l) => l.item_id);
  const eachGrams = await fetchEffectiveEachGramsByItemIds(tenantId, itemIds);
  let sum = 0;
  for (const line of lines) {
    const expected = computeInvoicingSubTotal(
      line.unit_size,
      line.unit_size_unit,
      line.units,
      line.cost,
      eachGrams.get(line.item_id) ?? null,
    );
    if (!subTotalsMatch(expected, line.sub_total)) {
      return `sub_total mismatch for "${line.name}"`;
    }
    sum += line.sub_total;
  }
  if (!subTotalsMatch(sum, totalAmount)) {
    return "total_amount does not match sum of line sub_totals";
  }
  return null;
}

/**
 * GET /invoicing/invoices
 */
router.get("/invoices", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("invoice_box_invoices")
        .select(
          "id, invoice_number, invoice_date, company_name, total_amount, delivery_site_name, sent_at, created_at",
        )
        .order("created_at", { ascending: false }),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({ invoices: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/invoices/:id
 */
router.get("/invoices/:id", async (req, res) => {
  try {
    const invoiceId = req.params.id?.trim();
    if (!invoiceId) return res.status(400).json({ error: "id is required" });

    const { data: invoice, error } = await withTenantFilter(
      supabase.from("invoice_box_invoices").select(INVOICE_COLUMNS).eq("id", invoiceId),
      req,
    ).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const normalized = normalizeInvoiceBoxLines(invoice.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    res.json({ invoice: { ...invoice, lines: normalized } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/invoices
 * Save or Save and Send from Generation preview.
 */
router.post("/invoices", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const userId = req.user!.id;

    const listId = String(req.body?.list_id ?? "").trim();
    const deliverySiteId = String(req.body?.delivery_site_id ?? "").trim();
    const send = Boolean(req.body?.send);
    const pdfBase64 =
      typeof req.body?.pdf_base64 === "string"
        ? req.body.pdf_base64.trim()
        : "";

    if (!listId) return res.status(400).json({ error: "list_id is required" });
    if (!deliverySiteId) {
      return res.status(400).json({ error: "delivery_site_id is required" });
    }
    if (send && !pdfBase64) {
      return res.status(400).json({ error: "pdf_base64 is required when send is true" });
    }

    const invoiceDateParsed = parseRequiredInvoiceDateTime(
      req.body?.invoice_date,
      "invoice_date",
    );
    if (typeof invoiceDateParsed === "object" && "error" in invoiceDateParsed) {
      return res.status(400).json({ error: invoiceDateParsed.error });
    }
    const invoiceDateIso = invoiceDateParsed as string;

    const invoiceDateYmdResult = parseOptionalInvoiceDateYmd(
      req.body?.invoice_date_ymd,
    );
    if (
      invoiceDateYmdResult !== null &&
      typeof invoiceDateYmdResult === "object" &&
      "error" in invoiceDateYmdResult
    ) {
      return res.status(400).json({ error: invoiceDateYmdResult.error });
    }
    const invoiceDateYmd =
      typeof invoiceDateYmdResult === "string" ? invoiceDateYmdResult : null;
    const invoiceCalendarYmd = resolveInvoiceNumberCalendarYmd(
      invoiceDateIso,
      invoiceDateYmd,
    );

    const invoiceDateDisplay =
      typeof req.body?.invoice_date_display === "string" &&
      req.body.invoice_date_display.trim()
        ? String(req.body.invoice_date_display).trim()
        : formatInvoiceDateTimeDisplayUtc(invoiceDateIso);

    const orderReceivedParsed = parseOptionalIsoDate(
      req.body?.order_received_date,
      "order_received_date",
    );
    if (
      typeof orderReceivedParsed === "object" &&
      orderReceivedParsed !== null &&
      "error" in orderReceivedParsed
    ) {
      return res.status(400).json({ error: orderReceivedParsed.error });
    }
    const deliveryDateParsed = parseOptionalIsoDate(
      req.body?.delivery_date,
      "delivery_date",
    );
    if (
      typeof deliveryDateParsed === "object" &&
      deliveryDateParsed !== null &&
      "error" in deliveryDateParsed
    ) {
      return res.status(400).json({ error: deliveryDateParsed.error });
    }

    const totalAmount = Number(req.body?.total_amount);
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return res.status(400).json({ error: "total_amount must be >= 0" });
    }

    const normalizedLines = normalizeInvoiceBoxLines(req.body?.lines);
    if ("error" in normalizedLines) {
      return res.status(400).json({ error: normalizedLines.error });
    }

    const amountError = await validateBoxInvoiceAmounts(
      tenantId,
      normalizedLines,
      totalAmount,
    );
    if (amountError) {
      return res.status(400).json({ error: amountError });
    }

    const { data: list, error: listErr } = await withTenantFilter(
      supabase.from("invoice_lists").select(LIST_COLUMNS).eq("id", listId),
      req,
    ).maybeSingle();
    if (listErr) return res.status(500).json({ error: listErr.message });
    if (!list) return res.status(404).json({ error: "List not found" });

    if (list.delivery_site_id !== deliverySiteId) {
      return res.status(400).json({ error: "delivery_site_id does not match list" });
    }

    const siteOk = await assertDeliverySiteInTenant(tenantId, deliverySiteId);
    if (!siteOk) {
      return res.status(400).json({ error: "Invalid delivery_site_id" });
    }

    const { data: site, error: siteErr } = await supabase
      .from("delivery_sites")
      .select("id, name, email, invoicing_accounts ( company_name )")
      .eq("tenant_id", tenantId)
      .eq("id", deliverySiteId)
      .maybeSingle();
    if (siteErr) return res.status(500).json({ error: siteErr.message });
    if (!site) return res.status(400).json({ error: "Delivery site not found" });

    const joinedAccount = site.invoicing_accounts as
      | { company_name: string }
      | { company_name: string }[]
      | null;
    const companyName = Array.isArray(joinedAccount)
      ? (joinedAccount[0]?.company_name ?? "")
      : (joinedAccount?.company_name ?? "");

    const listLines = normalizeInvoiceListLines(list.lines);
    if ("error" in listLines) {
      return res.status(500).json({ error: listLines.error });
    }

    const coverageError = validateBoxLinesCoverAllListLines(
      listLines,
      normalizedLines,
    );
    if (coverageError) {
      return res.status(400).json({ error: coverageError });
    }

    if (!list.wholesale_list_id) {
      return res.status(400).json({
        error: "List has no wholesale price list configured",
      });
    }

    const itemIds = normalizedLines.map((l) => l.item_id);
    const wholesaleCosts = await computeInvoiceWholesaleCosts(
      list.wholesale_list_id,
      itemIds,
    );
    const costError = validateBoxLineCostsAgainstRpc(
      normalizedLines,
      wholesaleCosts,
    );
    if (costError) {
      return res.status(400).json({ error: costError });
    }

    const requestedNumber =
      typeof req.body?.invoice_number === "string"
        ? req.body.invoice_number.trim()
        : "";

    let invoiceNumber: string;
    if (requestedNumber) {
      const { data: dup, error: dupErr } = await supabase
        .from("invoice_box_invoices")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("invoice_number", requestedNumber)
        .maybeSingle();
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if (dup) {
        return res.status(409).json({
          error: "Invoice number already used; regenerate preview",
        });
      }
      invoiceNumber = requestedNumber;
    } else {
      invoiceNumber = await allocateInvoiceNumber(
        tenantId,
        site.name,
        invoiceCalendarYmd,
        (prefix) => fetchExistingInvoiceNumbers(tenantId, prefix),
      );
    }

    const updatedListLines = mergeUnitSizesIntoListLines(
      listLines,
      normalizedLines,
    );

    const { data: invoiceRow, error: saveErr } = await supabase.rpc(
      "save_invoicing_box_invoice_atomic",
      {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_list_id: listId,
        p_delivery_site_id: deliverySiteId,
        p_invoice_number: invoiceNumber,
        p_delivery_site_name: site.name,
        p_delivery_email: site.email,
        p_company_name: companyName,
        p_order_received_date: orderReceivedParsed,
        p_delivery_date: deliveryDateParsed,
        p_invoice_date: invoiceDateIso,
        p_total_amount: totalAmount,
        p_lines: normalizedLines,
        p_updated_list_lines: updatedListLines,
      },
    );

    if (saveErr) {
      if (saveErr.code === "23505") {
        return res.status(409).json({ error: "Invoice number conflict; retry" });
      }
      return res.status(400).json({ error: saveErr.message });
    }

    const invoice = invoiceRow as Record<string, unknown>;
    const invoiceId = String(invoice.id ?? "");

    let sentAt: string | null = null;
    let emailSent = false;
    let emailError: string | undefined;

    if (send) {
      try {
        await sendInvoiceEmail({
          to: site.email,
          deliverySiteName: site.name,
          invoiceNumber,
          invoiceDate: invoiceDateDisplay,
          totalAmount,
          pdfBase64,
        });
        emailSent = true;
        const now = new Date().toISOString();
        const { data: sentRow, error: sentErr } = await supabase
          .from("invoice_box_invoices")
          .update({ sent_at: now })
          .eq("id", invoiceId)
          .eq("tenant_id", tenantId)
          .select(INVOICE_COLUMNS)
          .single();
        if (sentErr) {
          console.error("Invoice saved but sent_at update failed:", sentErr);
          emailError = "Email sent but failed to record Sent status";
        } else {
          sentAt = sentRow.sent_at;
        }
      } catch (emailErr: unknown) {
        emailError =
          emailErr instanceof Error ? emailErr.message : String(emailErr);
      }
    }

    res.status(201).json({
      invoice: {
        ...invoice,
        lines: normalizedLines,
        sent_at: sentAt ?? invoice.sent_at ?? null,
      },
      email_sent: send ? emailSent : undefined,
      email_error: emailError,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/invoices/:id/send
 */
router.post("/invoices/:id/send", async (req, res) => {
  try {
    const invoiceId = req.params.id?.trim();
    if (!invoiceId) return res.status(400).json({ error: "id is required" });

    const pdfBase64 =
      typeof req.body?.pdf_base64 === "string"
        ? req.body.pdf_base64.trim()
        : "";
    if (!pdfBase64) {
      return res.status(400).json({ error: "pdf_base64 is required" });
    }

    const { data: invoice, error: fetchErr } = await withTenantFilter(
      supabase.from("invoice_box_invoices").select(INVOICE_COLUMNS).eq("id", invoiceId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const invoiceDateRaw = invoice.invoice_date ?? "";
    if (!invoiceDateRaw) {
      return res.status(400).json({ error: "Invoice has no invoice_date" });
    }
    const invoiceDateDisplay = formatInvoiceDateTimeDisplayUtc(invoiceDateRaw);

    try {
      await sendInvoiceEmail({
        to: invoice.delivery_email,
        deliverySiteName: invoice.delivery_site_name,
        invoiceNumber: invoice.invoice_number,
        invoiceDate: invoiceDateDisplay,
        totalAmount: Number(invoice.total_amount),
        pdfBase64,
      });
    } catch (emailErr: unknown) {
      const message =
        emailErr instanceof Error ? emailErr.message : String(emailErr);
      return res.status(502).json({ error: `Email failed: ${message}` });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await withTenantFilter(
      supabase
        .from("invoice_box_invoices")
        .update({ sent_at: now })
        .eq("id", invoiceId)
        .select(INVOICE_COLUMNS),
      req,
    ).single();
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const normalized = normalizeInvoiceBoxLines(updated.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    res.json({ invoice: { ...updated, lines: normalized } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/invoices/:id
 */
router.delete("/invoices/:id", async (req, res) => {
  try {
    const invoiceId = req.params.id?.trim();
    if (!invoiceId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchErr } = await withTenantFilter(
      supabase.from("invoice_box_invoices").select("id").eq("id", invoiceId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "Invoice not found" });

    const { error } = await withTenantFilter(
      supabase.from("invoice_box_invoices").delete().eq("id", invoiceId),
      req,
    );
    if (error) return res.status(400).json({ error: error.message });

    res.status(204).send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

export default router;
