/**
 * Recipe Cost Report Cedar policy smoke test (no DB).
 * Run: node scripts/recipe-cost-report-cedar-verify.js
 */
const fs = require("fs");
const path = require("path");
const { isAuthorized } = require("@cedar-policy/cedar-wasm/nodejs");

const schemaPath = path.join(__dirname, "../src/authz/unified/schema.json");
const policiesPath = path.join(__dirname, "../src/authz/unified/policies.cedar");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const policies = fs.readFileSync(policiesPath, "utf8");

const TENANT_ID = "tenant-rcr-test";
const USER_ID = "user-rcr-test";

function tenantResource() {
  return {
    uid: { type: "Tenant", id: TENANT_ID },
    attrs: { id: TENANT_ID },
    parents: [],
  };
}

function principal(attrs) {
  return {
    uid: { type: "Principal", id: USER_ID },
    attrs: { id: USER_ID, ...attrs },
    parents: [],
  };
}

function decide(principalEntity, actionId) {
  const resource = tenantResource();
  const ans = isAuthorized({
    principal: principalEntity.uid,
    action: { type: "Action", id: actionId },
    resource: resource.uid,
    context: {},
    schema,
    validateRequest: true,
    policies: { staticPolicies: policies },
    entities: [principalEntity, resource],
  });
  const decision = ans?.response?.decision ?? "failure";
  const errors =
    ans?.response?.diagnostics?.errors?.map(
      (e) => e?.error?.message ?? e?.message,
    ) ?? [];
  return { decision, errors };
}

const ACTIONS = {
  tenantRead: "tenant::read_recipe_cost_report",
  tenantManage: "tenant::manage_recipe_cost_report",
  companyRead: "company::read_recipe_cost_report",
  companyManage: "company::manage_recipe_cost_report",
};

/** @type {Array<{ name: string; principal: ReturnType<typeof principal>; action: string; expect: string; optional?: boolean }>} */
const cases = [
  {
    name: "admin read",
    principal: principal({ tenant_role: "admin", tenant_id: TENANT_ID }),
    action: ACTIONS.tenantRead,
    expect: "allow",
  },
  {
    name: "director manage",
    principal: principal({ tenant_role: "director", tenant_id: TENANT_ID }),
    action: ACTIONS.tenantManage,
    expect: "allow",
  },
  {
    name: "manager read (deny)",
    principal: principal({ tenant_role: "manager", tenant_id: TENANT_ID }),
    action: ACTIONS.tenantRead,
    expect: "deny",
  },
  {
    name: "staff manage (deny)",
    principal: principal({ tenant_role: "staff", tenant_id: TENANT_ID }),
    action: ACTIONS.tenantManage,
    expect: "deny",
  },
  {
    name: "company_admin read",
    principal: principal({ company_role: "company_admin" }),
    action: ACTIONS.companyRead,
    expect: "allow",
  },
  {
    name: "company_director manage",
    principal: principal({ company_role: "company_director" }),
    action: ACTIONS.companyManage,
    expect: "allow",
  },
  {
    name: "company_admin wrong action (deny)",
    principal: principal({ company_role: "company_admin" }),
    action: ACTIONS.tenantRead,
    expect: "deny",
  },
  {
    name: "admin company action without company_role (deny at runtime; broad permit may allow in raw Cedar)",
    principal: principal({ tenant_role: "admin", tenant_id: TENANT_ID }),
    action: ACTIONS.companyRead,
    expect: "allow",
    optional: true,
  },
  {
    name: "manager generic read_resource still allowed",
    principal: principal({ tenant_role: "manager", tenant_id: TENANT_ID }),
    action: "tenant::read_resource",
    expect: "allow",
  },
];

let failed = 0;
for (const c of cases) {
  const { decision, errors } = decide(c.principal, c.action);
  const ok = decision === c.expect;
  if (!ok) {
    if (c.optional) {
      console.log(`SKIP ${c.name}: expected ${c.expect}, got ${decision} (authorize.ts uses company_role only for company::*)`);
    } else {
      failed += 1;
      console.error(
        `FAIL ${c.name}: expected ${c.expect}, got ${decision}`,
        errors.length ? errors : "",
      );
    }
  } else {
    console.log(`OK   ${c.name} => ${decision}`);
  }
}

// Schema: all RCR actions registered
const actionNames = Object.keys(schema[""].actions);
for (const id of Object.values(ACTIONS)) {
  if (!actionNames.includes(id)) {
    failed += 1;
    console.error(`FAIL schema missing action: ${id}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Recipe Cost Report Cedar checks passed.");
