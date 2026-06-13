import { Router, type NextFunction, type Request, type Response } from "express";
import { supabase } from "../config/supabase";
import { authorizeInvoicingAccess } from "../authz/unified/authorize";
import { withCompanyFilter, withTenantFilter } from "../middleware/tenant-filter";
import { sendInvoiceEmail } from "../services/email";
import {
  allocateInvoiceNumber,
  computeInvoicingSubTotal,
  subTotalsMatch,
} from "../lib/invoicing-calc";
import {
  LIST_COLUMNS,
  ORDER_COLUMNS,
  assertDeliverySiteInCompany,
  assertInvoicingAccountInCompany,
  assertWholesaleListInTenant,
  buildInitialLines,
  computeInvoiceWholesaleCosts,
  enrichInvoiceListLines,
  fetchEffectiveEachGramsByItemIds,
  fetchInvoicingItemCandidates,
  mergeUnitSizesIntoListLines,
  normalizeInvoiceListLines,
  normalizeOrderLines,
  validateInvoicingItemIds,
  validateInvoicingItemsForWholesaleList,
  validateOrderLineCostsAgainstRpc,
  validateOrderLinesCoverAllListLines,
  PAYMENT_COLUMNS,
  assertAccountInCompany,
  fetchCompanyInvoicingAccounts,
  resolveCompanyIdForTenant,
  type OrderLineJson,
} from "../services/invoicing-data";
import {
  assertExistingOrderOpen,
  assertOrderDateOpen,
  assertPaymentOpen,
  buildAccountLedger,
  closeMonthForCompany,
  currentCalendarPeriodForCompany,
  fetchCompanyClosedPeriods,
  formatOpenPeriodLabel,
  isAccountPeriodClosed,
  isValidPeriod,
} from "../services/invoicing-ledger";
import { getCompanyTimezoneIfSet } from "../lib/company-timezone";
import { getDocumentPresignedUrl } from "../lib/r2-upload";
import { resendMonthlyStatement } from "../services/monthly-statement-send";

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
  "id, company_id, account_id, name, street, city, state, zip, phone_1, phone_2, email, created_at, updated_at";

const ACCOUNT_COLUMNS =
  "id, company_id, company_name, poc_phone, poc_email, send_monthly_statement, created_at, updated_at";

const STATEMENT_COLUMNS =
  "id, company_id, account_id, period, account_company_name, sent_to, closing_balance, r2_key, status, error_message, sent_at, created_at";

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
  send_monthly_statement?: boolean;
};

type DeliverySiteRow = {
  id: string;
  company_id: string;
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

function parseSendMonthlyStatement(value: unknown): boolean | { error: string } {
  if (typeof value === "boolean") return value;
  if (value === undefined) return false;
  return { error: "send_monthly_statement must be a boolean" };
}

function parseInvoicingAccountCreateBody(body: InvoicingAccountBody): {
  company_name: string;
  poc_phone: string | null;
  poc_email: string | null;
  send_monthly_statement: boolean;
} | { error: string } {
  const company_name = body.company_name?.trim() ?? "";
  if (!company_name) return { error: "company_name is required" };
  const sendMonthly = parseSendMonthlyStatement(body.send_monthly_statement);
  if (typeof sendMonthly === "object" && "error" in sendMonthly) {
    return sendMonthly;
  }
  return {
    company_name,
    poc_phone: normalizeOptionalText(body.poc_phone),
    poc_email: normalizeOptionalText(body.poc_email),
    send_monthly_statement: sendMonthly,
  };
}

function parseInvoicingAccountPatchBody(
  body: InvoicingAccountBody,
): {
  company_name?: string;
  poc_phone?: string | null;
  poc_email?: string | null;
  send_monthly_statement?: boolean;
} | { error: string } {
  const updates: {
    company_name?: string;
    poc_phone?: string | null;
    poc_email?: string | null;
    send_monthly_statement?: boolean;
  } = {};

  if (body.company_name !== undefined) {
    const company_name = body.company_name?.trim() ?? "";
    if (!company_name) return { error: "company_name cannot be empty" };
    updates.company_name = company_name;
  }
  if (body.poc_phone !== undefined) {
    updates.poc_phone = normalizeOptionalText(body.poc_phone);
  }
  if (body.poc_email !== undefined) {
    updates.poc_email = normalizeOptionalText(body.poc_email);
  }
  if (body.send_monthly_statement !== undefined) {
    const sendMonthly = parseSendMonthlyStatement(body.send_monthly_statement);
    if (typeof sendMonthly === "object" && "error" in sendMonthly) {
      return sendMonthly;
    }
    updates.send_monthly_statement = sendMonthly;
  }

  if (Object.keys(updates).length === 0) {
    return { error: "No fields to update" };
  }
  return updates;
}

async function fetchExistingInvoiceNumbers(
  tenantId: string,
  prefix: string,
): Promise<string[]> {
  const { data, error: numErr } = await supabase
    .from("orders")
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const { data, error } = await withCompanyFilter(
      supabase
        .from("invoicing_accounts")
        .select(ACCOUNT_COLUMNS)
        .order("company_name", { ascending: true }),
      companyResolved,
    );

    if (error) {
      console.error(
        `invoicing_accounts list error (company ${companyResolved}):`,
        error,
      );
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const parsed = parseInvoicingAccountCreateBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const { data, error } = await supabase
      .from("invoicing_accounts")
      .insert({ company_id: companyResolved, ...parsed })
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accountId = req.params.id?.trim();
    if (!accountId) return res.status(400).json({ error: "id is required" });

    const parsed = parseInvoicingAccountPatchBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const { data: existing, error: fetchError } = await withCompanyFilter(
      supabase.from("invoicing_accounts").select("id").eq("id", accountId),
      companyResolved,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { data, error } = await withCompanyFilter(
      supabase
        .from("invoicing_accounts")
        .update(parsed)
        .eq("id", accountId)
        .select(ACCOUNT_COLUMNS),
      companyResolved,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accountId = req.params.id?.trim();
    if (!accountId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchError } = await withCompanyFilter(
      supabase.from("invoicing_accounts").select("id").eq("id", accountId),
      companyResolved,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { error } = await withCompanyFilter(
      supabase.from("invoicing_accounts").delete().eq("id", accountId),
      companyResolved,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const { data, error } = await withCompanyFilter(
      supabase
        .from("delivery_sites")
        .select(
          `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
        )
        .order("name", { ascending: true }),
      companyResolved,
    );

    if (error) {
      console.error(
        `delivery_sites list error (company ${companyResolved}):`,
        error,
      );
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const parsed = parseDeliverySiteBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const accountOk = await assertInvoicingAccountInCompany(
      companyResolved,
      parsed.account_id,
    );
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const { data, error } = await supabase
      .from("delivery_sites")
      .insert({
        company_id: companyResolved,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const siteId = req.params.id?.trim();
    if (!siteId) return res.status(400).json({ error: "id is required" });

    const parsed = parseDeliverySiteBody(req.body ?? {});
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const accountOk = await assertInvoicingAccountInCompany(
      companyResolved,
      parsed.account_id,
    );
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const { data: existing, error: fetchError } = await withCompanyFilter(
      supabase.from("delivery_sites").select("id").eq("id", siteId),
      companyResolved,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Delivery site not found" });
    }

    const { data, error } = await withCompanyFilter(
      supabase
        .from("delivery_sites")
        .update(parsed)
        .eq("id", siteId)
        .select(
          `${DELIVERY_SITE_COLUMNS}, invoicing_accounts ( company_name )`,
        ),
      companyResolved,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const deliverySiteId = String(req.body?.delivery_site_id ?? "").trim();
    if (!deliverySiteId) {
      return res.status(400).json({ error: "delivery_site_id is required" });
    }

    const orderCreatedDateParsed = parseRequiredIsoDate(
      req.body?.order_created_date,
      "order_created_date",
    );
    if (
      typeof orderCreatedDateParsed === "object" &&
      "error" in orderCreatedDateParsed
    ) {
      return res.status(400).json({ error: orderCreatedDateParsed.error });
    }
    const orderCreatedDate = orderCreatedDateParsed as string;

    const siteOk = await assertDeliverySiteInCompany(
      companyResolved,
      deliverySiteId,
    );
    if (!siteOk) {
      return res.status(400).json({ error: "Invalid delivery_site_id" });
    }

    const { data: site, error: siteErr } = await supabase
      .from("delivery_sites")
      .select("name")
      .eq("company_id", companyResolved)
      .eq("id", deliverySiteId)
      .maybeSingle();
    if (siteErr) return res.status(500).json({ error: siteErr.message });
    if (!site) return res.status(404).json({ error: "Delivery site not found" });

    const invoiceNumber = await allocateInvoiceNumber(
      tenantId,
      orderCreatedDate,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const siteId = req.params.id?.trim();
    if (!siteId) return res.status(400).json({ error: "id is required" });

    const { data: existing, error: fetchError } = await withCompanyFilter(
      supabase.from("delivery_sites").select("id").eq("id", siteId),
      companyResolved,
    ).maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }
    if (!existing) {
      return res.status(404).json({ error: "Delivery site not found" });
    }

    const { error } = await withCompanyFilter(
      supabase.from("delivery_sites").delete().eq("id", siteId),
      companyResolved,
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

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

    const siteOk = await assertDeliverySiteInCompany(
      companyResolved,
      deliverySiteId,
    );
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
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

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
      const siteOk = await assertDeliverySiteInCompany(
        companyResolved,
        deliverySiteId,
      );
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

function parseRequiredIsoDate(
  value: unknown,
  field: string,
): string | { error: string } {
  if (value == null || value === "") {
    return { error: `${field} is required` };
  }
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { error: `${field} must be YYYY-MM-DD` };
  }
  return s;
}

function resolveFirstInvoiceSentDate(
  body: Record<string, unknown>,
): string | { error: string } {
  const parsed = parseOptionalIsoDate(
    body.first_invoice_sent_at,
    "first_invoice_sent_at",
  );
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    return parsed;
  }
  if (typeof parsed === "string") return parsed;
  return new Date().toISOString().slice(0, 10);
}

async function validateOrderAmounts(
  tenantId: string,
  lines: OrderLineJson[],
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
 * GET /invoicing/orders
 */
type OrderSummaryRow = {
  id: string;
  invoice_number: string;
  order_created_date: string | null;
  company_name: string;
  total_amount: number;
  delivery_site_name: string;
  first_invoice_sent_at: string | null;
  created_at?: string;
  delivery_sites?:
    | { account_id: string }
    | { account_id: string }[]
    | null;
};

function mapOrderSummaryRow(row: OrderSummaryRow) {
  const joined = row.delivery_sites;
  const account_id = Array.isArray(joined)
    ? (joined[0]?.account_id ?? null)
    : (joined?.account_id ?? null);
  const { delivery_sites: _s, ...rest } = row;
  return { ...rest, account_id };
}

router.get("/orders", async (req, res) => {
  try {
    const { data, error } = await withTenantFilter(
      supabase
        .from("orders")
        .select(
          "id, invoice_number, order_created_date, company_name, total_amount, delivery_site_name, first_invoice_sent_at, created_at, delivery_sites ( account_id )",
        )
        .order("created_at", { ascending: false }),
      req,
    );
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      orders: (data ?? []).map((row) =>
        mapOrderSummaryRow(row as OrderSummaryRow),
      ),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/orders/:id
 */
router.get("/orders/:id", async (req, res) => {
  try {
    const orderId = req.params.id?.trim();
    if (!orderId) return res.status(400).json({ error: "id is required" });

    const { data: order, error } = await withTenantFilter(
      supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId),
      req,
    ).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const normalized = normalizeOrderLines(order.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    res.json({ order: { ...order, lines: normalized } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/orders
 * Save or Save and Send from Create Order preview.
 */
router.post("/orders", async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

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

    const orderCreatedDateParsed = parseRequiredIsoDate(
      req.body?.order_created_date,
      "order_created_date",
    );
    if (
      typeof orderCreatedDateParsed === "object" &&
      "error" in orderCreatedDateParsed
    ) {
      return res.status(400).json({ error: orderCreatedDateParsed.error });
    }
    const orderCreatedDate = orderCreatedDateParsed as string;

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

    const normalizedLines = normalizeOrderLines(req.body?.lines);
    if ("error" in normalizedLines) {
      return res.status(400).json({ error: normalizedLines.error });
    }

    const amountError = await validateOrderAmounts(
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

    const siteOk = await assertDeliverySiteInCompany(
      companyResolved,
      deliverySiteId,
    );
    if (!siteOk) {
      return res.status(400).json({ error: "Invalid delivery_site_id" });
    }

    const periodLockErr = await assertOrderDateOpen(
      companyResolved,
      deliverySiteId,
      orderCreatedDate,
    );
    if (periodLockErr) {
      return res.status(409).json({ error: periodLockErr });
    }

    const { data: site, error: siteErr } = await supabase
      .from("delivery_sites")
      .select("id, name, email, invoicing_accounts ( company_name )")
      .eq("company_id", companyResolved)
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

    const coverageError = validateOrderLinesCoverAllListLines(
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
    const costError = validateOrderLineCostsAgainstRpc(
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
        .from("orders")
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
        orderCreatedDate,
        (prefix) => fetchExistingInvoiceNumbers(tenantId, prefix),
      );
    }

    const updatedListLines = mergeUnitSizesIntoListLines(
      listLines,
      normalizedLines,
    );

    const { data: orderRow, error: saveErr } = await supabase.rpc(
      "save_order_atomic",
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
        p_order_created_date: orderCreatedDate,
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

    const order = orderRow as Record<string, unknown>;
    const orderId = String(order.id ?? "");

    let sentDate: string | null = null;
    let emailSent = false;
    let emailError: string | undefined;

    if (send) {
      const sentDateParsed = resolveFirstInvoiceSentDate(
        req.body as Record<string, unknown>,
      );
      if (typeof sentDateParsed === "object" && "error" in sentDateParsed) {
        return res.status(400).json({ error: sentDateParsed.error });
      }
      try {
        await sendInvoiceEmail({
          to: site.email,
          deliverySiteName: site.name,
          invoiceNumber,
          invoiceDate: orderCreatedDate,
          totalAmount,
          pdfBase64,
        });
        emailSent = true;
        const { data: sentRow, error: sentErr } = await supabase
          .from("orders")
          .update({ first_invoice_sent_at: sentDateParsed })
          .eq("id", orderId)
          .eq("tenant_id", tenantId)
          .select(ORDER_COLUMNS)
          .single();
        if (sentErr) {
          console.error("Order saved but first_invoice_sent_at update failed:", sentErr);
          emailError = "Email sent but failed to record Sent status";
        } else {
          sentDate = sentRow.first_invoice_sent_at;
        }
      } catch (emailErr: unknown) {
        emailError =
          emailErr instanceof Error ? emailErr.message : String(emailErr);
      }
    }

    res.status(201).json({
      order: {
        ...order,
        lines: normalizedLines,
        first_invoice_sent_at:
          sentDate ?? (order.first_invoice_sent_at as string | null) ?? null,
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
 * POST /invoicing/orders/:id/send
 */
router.post("/orders/:id/send", async (req, res) => {
  try {
    const orderId = req.params.id?.trim();
    if (!orderId) return res.status(400).json({ error: "id is required" });

    const pdfBase64 =
      typeof req.body?.pdf_base64 === "string"
        ? req.body.pdf_base64.trim()
        : "";
    if (!pdfBase64) {
      return res.status(400).json({ error: "pdf_base64 is required" });
    }

    const { data: order, error: fetchErr } = await withTenantFilter(
      supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const orderCreatedDateRaw = order.order_created_date ?? "";
    if (!orderCreatedDateRaw) {
      return res.status(400).json({ error: "Order has no order_created_date" });
    }
    const orderCreatedDateDisplay =
      /^\d{4}-\d{2}-\d{2}$/.test(orderCreatedDateRaw.trim())
        ? orderCreatedDateRaw.trim()
        : orderCreatedDateRaw.slice(0, 10);

    try {
      await sendInvoiceEmail({
        to: order.delivery_email,
        deliverySiteName: order.delivery_site_name,
        invoiceNumber: order.invoice_number,
        invoiceDate: orderCreatedDateDisplay,
        totalAmount: Number(order.total_amount),
        pdfBase64,
      });
    } catch (emailErr: unknown) {
      const message =
        emailErr instanceof Error ? emailErr.message : String(emailErr);
      return res.status(502).json({ error: `Email failed: ${message}` });
    }

    const sentDateParsed = resolveFirstInvoiceSentDate(
      req.body as Record<string, unknown>,
    );
    if (typeof sentDateParsed === "object" && "error" in sentDateParsed) {
      return res.status(400).json({ error: sentDateParsed.error });
    }

    const { data: updated, error: updateErr } = await withTenantFilter(
      supabase
        .from("orders")
        .update({ first_invoice_sent_at: sentDateParsed })
        .eq("id", orderId)
        .select(ORDER_COLUMNS),
      req,
    ).single();
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const normalized = normalizeOrderLines(updated.lines);
    if ("error" in normalized) {
      return res.status(500).json({ error: normalized.error });
    }

    res.json({ order: { ...updated, lines: normalized } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

type PaymentRow = {
  id: string;
  company_id: string;
  account_id: string;
  amount: number;
  type: string;
  adjustment_direction: string | null;
  note: string | null;
  payment_date: string;
  created_at: string;
  created_by: string | null;
  invoicing_accounts?:
    | { company_name: string }
    | { company_name: string }[]
    | null;
};

function mapPaymentRow(row: PaymentRow) {
  const joined = row.invoicing_accounts;
  const account_name = Array.isArray(joined)
    ? (joined[0]?.company_name ?? "")
    : (joined?.company_name ?? "");
  const { invoicing_accounts: _a, ...rest } = row;
  return { ...rest, account_name: account_name.trim() || "—" };
}

async function resolveInvoicingCompanyId(
  req: Request,
): Promise<string | { error: string; status: number }> {
  const tenantId = resolveTenantId(req);
  const companyId = await resolveCompanyIdForTenant(tenantId);
  if (!companyId) {
    return {
      error: "No company linked to the current tenant",
      status: 400,
    };
  }
  const timezone = await getCompanyTimezoneIfSet(companyId);
  if (!timezone) {
    return {
      error: "Company timezone is not configured",
      status: 403,
    };
  }
  return companyId;
}

const PAYMENT_TYPES = ["payment", "adjustment"] as const;
type PaymentType = (typeof PAYMENT_TYPES)[number];

const ADJUSTMENT_DIRECTIONS = ["decrease", "increase"] as const;
type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

function parseAdjustmentDirection(
  value: unknown,
): AdjustmentDirection | { error: string } {
  const direction = String(value ?? "decrease").trim();
  if (direction === "decrease" || direction === "increase") {
    return direction;
  }
  return { error: "adjustment_direction must be decrease or increase" };
}

function parsePaymentType(value: unknown): PaymentType | { error: string } {
  if (value == null || value === "") {
    return "payment";
  }
  const type = String(value).trim();
  if (type === "payment" || type === "adjustment") {
    return type;
  }
  return { error: "type must be payment or adjustment" };
}

function parsePaymentAmount(
  value: unknown,
): number | { error: string } {
  if (value == null || value === "") {
    return { error: "amount is required" };
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "amount must be a positive number" };
  }
  return amount;
}

function parsePaymentBody(
  body: Record<string, unknown>,
  requireAccount: boolean,
):
  | {
      account_id: string;
      amount: number;
      type: PaymentType;
      adjustment_direction: AdjustmentDirection | null;
      payment_date: string;
      note: string | null;
    }
  | { error: string } {
  const accountId = String(body.account_id ?? "").trim();
  if (requireAccount && !accountId) {
    return { error: "account_id is required" };
  }
  if (!requireAccount && !accountId) {
    return { error: "account_id is required" };
  }

  const amountParsed = parsePaymentAmount(body.amount);
  if (typeof amountParsed !== "number") {
    return amountParsed;
  }

  const paymentDateParsed = parseRequiredIsoDate(
    body.payment_date,
    "payment_date",
  );
  if (typeof paymentDateParsed !== "string") {
    return paymentDateParsed;
  }

  const noteRaw = body.note;
  const note =
    noteRaw == null || String(noteRaw).trim() === ""
      ? null
      : String(noteRaw).trim();

  const payment_date = paymentDateParsed;

  const typeParsed = parsePaymentType(body.type);
  if (typeof typeParsed !== "string") {
    return typeParsed;
  }

  let adjustment_direction: AdjustmentDirection | null = null;
  if (typeParsed === "adjustment") {
    const directionParsed = parseAdjustmentDirection(body.adjustment_direction);
    if (typeof directionParsed !== "string") {
      return directionParsed;
    }
    adjustment_direction = directionParsed;
  }

  return {
    account_id: accountId,
    amount: amountParsed,
    type: typeParsed,
    adjustment_direction,
    payment_date,
    note,
  };
}

function parsePaymentPatchBody(
  body: Record<string, unknown>,
):
  | {
      account_id?: string;
      amount?: number;
      payment_date?: string;
      note?: string | null;
    }
  | { error: string } {
  const patch: {
    account_id?: string;
    amount?: number;
    payment_date?: string;
    note?: string | null;
  } = {};

  if (body.account_id !== undefined) {
    const accountId = String(body.account_id ?? "").trim();
    if (!accountId) return { error: "account_id cannot be empty" };
    patch.account_id = accountId;
  }

  if (body.amount !== undefined) {
    const amountParsed = parsePaymentAmount(body.amount);
    if (typeof amountParsed !== "number") {
      return amountParsed;
    }
    patch.amount = amountParsed;
  }

  if (body.payment_date !== undefined) {
    const paymentDateParsed = parseRequiredIsoDate(
      body.payment_date,
      "payment_date",
    );
    if (typeof paymentDateParsed !== "string") {
      return paymentDateParsed;
    }
    patch.payment_date = paymentDateParsed;
  }

  if (body.note !== undefined) {
    const noteRaw = body.note;
    patch.note =
      noteRaw == null || String(noteRaw).trim() === ""
        ? null
        : String(noteRaw).trim();
  }

  if (
    patch.account_id === undefined &&
    patch.amount === undefined &&
    patch.payment_date === undefined &&
    patch.note === undefined
  ) {
    return { error: "No fields to update" };
  }

  return patch;
}

/**
 * GET /invoicing/payments/accounts
 * All invoicing accounts for tenants under the seller company.
 */
router.get("/payments/accounts", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accounts = await fetchCompanyInvoicingAccounts(companyResolved);
    res.json({ accounts });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/payments
 */
router.get("/payments", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accountId = String(req.query.account_id ?? "").trim();
    let query = supabase
      .from("payments")
      .select(
        `${PAYMENT_COLUMNS}, invoicing_accounts ( company_name )`,
      )
      .eq("company_id", companyResolved)
      .order("created_at", { ascending: false });

    if (accountId) {
      query = query.eq("account_id", accountId);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      payments: (data ?? []).map((row) =>
        mapPaymentRow(row as PaymentRow),
      ),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/payments
 */
router.post("/payments", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const parsed = parsePaymentBody(
      (req.body ?? {}) as Record<string, unknown>,
      true,
    );
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const accountOk = await assertAccountInCompany(
      companyResolved,
      parsed.account_id,
    );
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const paymentLockErr = await assertPaymentOpen(
      companyResolved,
      parsed.account_id,
      parsed.payment_date,
    );
    if (paymentLockErr) {
      return res.status(409).json({ error: paymentLockErr });
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        company_id: companyResolved,
        account_id: parsed.account_id,
        amount: parsed.amount,
        type: parsed.type,
        adjustment_direction: parsed.adjustment_direction,
        note: parsed.note,
        payment_date: parsed.payment_date,
        created_by: req.user!.id,
      })
      .select(`${PAYMENT_COLUMNS}, invoicing_accounts ( company_name )`)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ payment: mapPaymentRow(data as PaymentRow) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /invoicing/payments/:id
 */
router.patch("/payments/:id", async (req, res) => {
  try {
    const paymentId = req.params.id?.trim();
    if (!paymentId) return res.status(400).json({ error: "id is required" });

    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const parsed = parsePaymentPatchBody(
      (req.body ?? {}) as Record<string, unknown>,
    );
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("payments")
      .select("id, account_id, payment_date")
      .eq("id", paymentId)
      .eq("company_id", companyResolved)
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "Payment not found" });

    const existingLockErr = await assertPaymentOpen(
      companyResolved,
      existing.account_id,
      existing.payment_date,
    );
    if (existingLockErr) {
      return res.status(409).json({ error: existingLockErr });
    }

    if (parsed.account_id) {
      const accountOk = await assertAccountInCompany(
        companyResolved,
        parsed.account_id,
      );
      if (!accountOk) {
        return res.status(400).json({ error: "Invalid account_id" });
      }
    }

    const nextAccountId = parsed.account_id ?? existing.account_id;
    const nextPaymentDate =
      parsed.payment_date !== undefined
        ? parsed.payment_date
        : existing.payment_date;
    const nextLockErr = await assertPaymentOpen(
      companyResolved,
      nextAccountId,
      nextPaymentDate,
    );
    if (nextLockErr) {
      return res.status(409).json({ error: nextLockErr });
    }

    const { data, error } = await supabase
      .from("payments")
      .update(parsed)
      .eq("id", paymentId)
      .eq("company_id", companyResolved)
      .select(`${PAYMENT_COLUMNS}, invoicing_accounts ( company_name )`)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ payment: mapPaymentRow(data as PaymentRow) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/payments/:id
 */
router.delete("/payments/:id", async (req, res) => {
  try {
    const paymentId = req.params.id?.trim();
    if (!paymentId) return res.status(400).json({ error: "id is required" });

    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("payments")
      .select("id, account_id, payment_date")
      .eq("id", paymentId)
      .eq("company_id", companyResolved)
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "Payment not found" });

    const { error } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId)
      .eq("company_id", companyResolved);
    if (error) return res.status(400).json({ error: error.message });

    res.status(204).send();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/balance/ledger?account_id=
 */
router.get("/balance/ledger", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accountId = String(req.query.account_id ?? "").trim();
    if (!accountId) {
      return res.status(400).json({ error: "account_id is required" });
    }

    const accountOk = await assertAccountInCompany(companyResolved, accountId);
    if (!accountOk) {
      return res.status(400).json({ error: "Invalid account_id" });
    }

    const accounts = await fetchCompanyInvoicingAccounts(companyResolved);
    const account = accounts.find((row) => row.id === accountId);
    const openPeriod = await currentCalendarPeriodForCompany(companyResolved);
    const openPeriodClosed = await isAccountPeriodClosed(
      companyResolved,
      accountId,
      openPeriod,
    );

    const { rows, current_balance } = await buildAccountLedger(
      companyResolved,
      accountId,
    );

    res.json({
      account_id: accountId,
      account_name: account?.company_name ?? "—",
      current_balance,
      open_period: openPeriod,
      open_period_label: formatOpenPeriodLabel(openPeriod),
      open_period_closed: openPeriodClosed,
      ledger: rows,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/balance/closed-periods
 */
router.get("/balance/closed-periods", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const accountId = String(req.query.account_id ?? "").trim();
    if (accountId) {
      const accountOk = await assertAccountInCompany(
        companyResolved,
        accountId,
      );
      if (!accountOk) {
        return res.status(400).json({ error: "Invalid account_id" });
      }
    }

    const closed = await fetchCompanyClosedPeriods(
      companyResolved,
      accountId || undefined,
    );
    res.json({ closed_periods: closed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/balance/close-month
 * Body: { period: "YYYY-MM" }
 */
router.post("/balance/close-month", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const period = String(req.body?.period ?? "").trim();
    if (!period) {
      return res.status(400).json({ error: "period is required (YYYY-MM)" });
    }
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: "Invalid period (expected YYYY-MM)" });
    }

    const result = await closeMonthForCompany(
      companyResolved,
      period,
      req.user!.id,
    );
    res.status(201).json({
      period,
      period_label: formatOpenPeriodLabel(period),
      closed_count: result.closed_count,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("already closed")) {
      return res.status(409).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /invoicing/orders/:id
 */
router.delete("/orders/:id", async (req, res) => {
  try {
    const orderId = req.params.id?.trim();
    if (!orderId) return res.status(400).json({ error: "id is required" });

    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const tenantId = resolveTenantId(req);

    const { data: existing, error: fetchErr } = await withTenantFilter(
      supabase.from("orders").select("id").eq("id", orderId),
      req,
    ).maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: "Order not found" });

    const { error } = await withTenantFilter(
      supabase.from("orders").delete().eq("id", orderId),
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
 * GET /invoicing/statements
 */
router.get("/statements", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const { data, error } = await withCompanyFilter(
      supabase
        .from("monthly_statements")
        .select(STATEMENT_COLUMNS)
        .order("period", { ascending: false })
        .order("account_company_name", { ascending: true }),
      companyResolved,
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ statements: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /invoicing/statements/:id/pdf-url
 */
router.get("/statements/:id/pdf-url", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const statementId = req.params.id?.trim();
    if (!statementId) return res.status(400).json({ error: "id is required" });

    const { data: statement, error } = await withCompanyFilter(
      supabase
        .from("monthly_statements")
        .select("id, r2_key")
        .eq("id", statementId),
      companyResolved,
    ).maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!statement) return res.status(404).json({ error: "Statement not found" });

    const r2Key = statement.r2_key?.trim();
    if (!r2Key) {
      return res.status(404).json({ error: "No PDF available for this statement" });
    }

    const url = await getDocumentPresignedUrl(r2Key);
    res.json({ url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /invoicing/statements/:id/resend
 */
router.post("/statements/:id/resend", async (req, res) => {
  try {
    const companyResolved = await resolveInvoicingCompanyId(req);
    if (typeof companyResolved === "object" && "error" in companyResolved) {
      return res
        .status(companyResolved.status)
        .json({ error: companyResolved.error });
    }

    const statementId = req.params.id?.trim();
    if (!statementId) return res.status(400).json({ error: "id is required" });

    const result = await resendMonthlyStatement(companyResolved, statementId);

    const { data: statement, error } = await withCompanyFilter(
      supabase
        .from("monthly_statements")
        .select(STATEMENT_COLUMNS)
        .eq("id", statementId),
      companyResolved,
    ).maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!statement) return res.status(404).json({ error: "Statement not found" });

    if (result.status === "failed") {
      return res.status(502).json({
        error: result.error_message ?? "Failed to send monthly statement",
        statement,
      });
    }

    res.json({ statement, status: result.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "Statement not found" || message === "Billing account not found") {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

export default router;
