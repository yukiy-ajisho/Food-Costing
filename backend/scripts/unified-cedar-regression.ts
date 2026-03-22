import fs from "fs";
import path from "path";
import { isAuthorized, type EntityUid } from "@cedar-policy/cedar-wasm/nodejs";

const schemaPath = path.join(__dirname, "../src/authz/unified/schema.json");
const policiesPath = path.join(__dirname, "../src/authz/unified/policies.cedar");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const policies = fs.readFileSync(policiesPath, "utf8");

type TenantRole = "staff" | "manager" | "admin" | "director";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const USER_ID = "user-1";

function principalUid(): EntityUid {
  return { type: "Principal", id: USER_ID };
}

function principalEntity(tenantRole: TenantRole) {
  return {
    uid: principalUid(),
    attrs: {
      id: USER_ID,
      tenant_role: tenantRole,
      tenant_id: TENANT_ID,
    },
    parents: [],
  };
}

function tenantResource() {
  return {
    uid: { type: "Tenant", id: TENANT_ID },
    attrs: {
      id: TENANT_ID,
      company_id: COMPANY_ID,
    },
    parents: [],
  };
}

function costResourceItem(itemKind: "raw" | "prepped") {
  return {
    uid: { type: "CostResource", id: `item-${itemKind}` },
    attrs: {
      id: `item-${itemKind}`,
      type: "item",
      tenant_id: TENANT_ID,
      owner_tenant_id: TENANT_ID,
      item_kind: itemKind,
      // endpoint が通常持っている user_id/responsible_user_id のためのダミー
      user_id: "user-owner",
      responsible_user_id: "user-responsible",
    },
    parents: [],
  };
}

function decide(args: {
  tenantRole: TenantRole;
  action: string;
  resource: ReturnType<typeof tenantResource> | ReturnType<typeof costResourceItem>;
  context?: Record<string, unknown>;
}): { decision: string; errors?: string[] } {
  const principal = principalEntity(args.tenantRole);
  const context = args.context ?? {};

  const call = {
    principal: principal.uid,
    action: { type: "Action", id: args.action },
    resource: args.resource.uid,
    context,
    schema,
    validateRequest: true,
    policies: { staticPolicies: policies },
    entities: [principal, args.resource],
  };

  const ans = isAuthorized(call);
  const decision = ans?.response?.decision ?? "failure";
  const errors =
    ans?.response?.diagnostics?.errors?.map((e: any) => e?.error?.message ?? e?.message) ??
    undefined;

  return { decision, errors };
}

const actions = {
  list: "tenant::list_resources",
  readTenant: "tenant::read_resource",
  createItem: "tenant::create_item",
  readItem: "tenant::read_resource",
  updateItem: "tenant::update_item",
  deleteItem: "tenant::delete_item",
  manageSettings: "tenant::manage_settings",
  manageTenant: "tenant::manage_tenant",
  manageMembers: "tenant::manage_members",
} as const;

function run() {
  const tenantRes = tenantResource();
  const rawItem = costResourceItem("raw");
  const preppedItem = costResourceItem("prepped");

  const contexts = {
    none: {},
    owner: { is_owner: true, is_shared: false },
    shared: { is_owner: false, is_shared: true },
    both: { is_owner: true, is_shared: true },
  } as const;

  const roles: TenantRole[] = ["staff", "manager", "admin", "director"];

  const cases: Array<{
    label: string;
    action: string;
    resource: typeof tenantRes | typeof rawItem | typeof preppedItem;
    context?: Record<string, unknown>;
  }> = [
    { label: "staff list/read Tenant", action: actions.list, resource: tenantRes },
    { label: "staff create item (deny)", action: actions.createItem, resource: tenantRes },
    { label: "staff manage settings", action: actions.manageSettings, resource: tenantRes },
    { label: "staff manage tenant", action: actions.manageTenant, resource: tenantRes },
    { label: "staff manage members", action: actions.manageMembers, resource: tenantRes },

    { label: "raw item read (admin/staff allowed)", action: actions.readItem, resource: rawItem, context: contexts.none },
    { label: "prepped item read (manager depends on context)", action: actions.readItem, resource: preppedItem, context: contexts.none },

    { label: "prepped item update (manager owner)", action: actions.updateItem, resource: preppedItem, context: contexts.owner },
    { label: "prepped item update (manager shared)", action: actions.updateItem, resource: preppedItem, context: contexts.shared },
    { label: "prepped item update (manager none)", action: actions.updateItem, resource: preppedItem, context: contexts.none },

    { label: "raw item update (manager allow)", action: actions.updateItem, resource: rawItem, context: contexts.none },

    { label: "prepped item delete (manager none)", action: actions.deleteItem, resource: preppedItem, context: contexts.none },
  ];

  const out: Record<string, any> = {};

  for (const role of roles) {
    out[role] = {};
    for (const c of cases) {
      const r = decide({ tenantRole: role, action: c.action, resource: c.resource as any, context: c.context });
      out[role][c.label] = { decision: r.decision, errors: r.errors };
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

run();

