const fs = require("fs");
const path = require("path");
const { isAuthorized } = require("@cedar-policy/cedar-wasm/nodejs");

const schemaPath = path.join(__dirname, "../src/authz/unified/schema.json");
const policiesPath = path.join(__dirname, "../src/authz/unified/policies.cedar");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const policies = fs.readFileSync(policiesPath, "utf8");

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const USER_ID = "user-1";

function principalEntity(tenantRole) {
  return {
    uid: { type: "Principal", id: USER_ID },
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

function costResourceItem(itemKind) {
  return {
    uid: { type: "CostResource", id: `item-${itemKind}` },
    attrs: {
      id: `item-${itemKind}`,
      type: "item",
      tenant_id: TENANT_ID,
      owner_tenant_id: TENANT_ID,
      item_kind: itemKind,
      user_id: "user-owner",
    },
    parents: [],
  };
}

function decide({ tenantRole, action, resource, context }) {
  const principal = principalEntity(tenantRole);
  const call = {
    principal: principal.uid,
    action: { type: "Action", id: action },
    resource: resource.uid,
    context: context ?? {},
    schema,
    validateRequest: true,
    policies: { staticPolicies: policies },
    entities: [principal, resource],
  };

  const ans = isAuthorized(call);
  const decision = ans?.response?.decision ?? "failure";
  const errors =
    ans?.response?.diagnostics?.errors?.map((e) => e?.error?.message ?? e?.message) ??
    undefined;
  return { decision, errors };
}

const actions = {
  list: "tenant::list_resources",
  createItem: "tenant::create_item",
  readItem: "tenant::read_resource",
  updateItem: "tenant::update_item",
  deleteItem: "tenant::delete_item",
  manageSettings: "tenant::manage_settings",
  manageTenant: "tenant::manage_tenant",
  manageMembers: "tenant::manage_members",
};

function run() {
  const tenantRes = tenantResource();
  const rawItem = costResourceItem("raw");
  const preppedItem = costResourceItem("prepped");

  const contexts = {
    none: { is_owner: false, is_shared: false },
    owner: { is_owner: true, is_shared: false },
    shared: { is_owner: false, is_shared: true },
  };

  const roles = ["staff", "manager", "admin", "director"];

  const cases = [
    { label: "list_resources on Tenant", action: actions.list, resource: tenantRes },
    { label: "create_item on Tenant", action: actions.createItem, resource: tenantRes },
    { label: "manage_settings on Tenant", action: actions.manageSettings, resource: tenantRes },
    { label: "manage_tenant on Tenant", action: actions.manageTenant, resource: tenantRes },
    { label: "manage_members on Tenant", action: actions.manageMembers, resource: tenantRes },

    { label: "read_resource on raw item (context none)", action: actions.readItem, resource: rawItem, context: contexts.none },
    { label: "read_resource on prepped item (context none)", action: actions.readItem, resource: preppedItem, context: contexts.none },
    { label: "read_resource on prepped item (context owner)", action: actions.readItem, resource: preppedItem, context: contexts.owner },
    { label: "read_resource on prepped item (context shared)", action: actions.readItem, resource: preppedItem, context: contexts.shared },

    { label: "update_item on prepped item (context none)", action: actions.updateItem, resource: preppedItem, context: contexts.none },
    { label: "update_item on prepped item (context owner)", action: actions.updateItem, resource: preppedItem, context: contexts.owner },
    { label: "update_item on prepped item (context shared)", action: actions.updateItem, resource: preppedItem, context: contexts.shared },

    { label: "update_item on raw item (context none)", action: actions.updateItem, resource: rawItem, context: contexts.none },
    { label: "delete_item on prepped item (context none)", action: actions.deleteItem, resource: preppedItem, context: contexts.none },
    { label: "delete_item on prepped item (context owner)", action: actions.deleteItem, resource: preppedItem, context: contexts.owner },
    { label: "delete_item on prepped item (context shared)", action: actions.deleteItem, resource: preppedItem, context: contexts.shared },
  ];

  const out = {};
  for (const role of roles) {
    out[role] = {};
    for (const c of cases) {
      const r = decide({ tenantRole: role, action: c.action, resource: c.resource, context: c.context });
      out[role][c.label] = r;
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

run();

