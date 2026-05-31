#!/usr/bin/env node
/**
 * Cost RPC integration verify — asserts RPC output against supabase/test/cost-rpc-expected.json
 *
 * Prerequisite: local DB already has schema-baseline + cost-rpc-fixture-base (+ WL SQL per group).
 * Usually invoked via: ./supabase/test/run-cost-rpc-verify.sh
 *
 * Env:
 *   DATABASE_URL — Postgres connection string (required unless --database-url)
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const TEST_DIR = __dirname;
const EXPECTED_PATH = path.join(TEST_DIR, "cost-rpc-expected.json");

function parseArgs(argv) {
  const out = { databaseUrl: process.env.DATABASE_URL || "", wlFilter: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--database-url" && argv[i + 1]) {
      out.databaseUrl = argv[++i];
    } else if (argv[i] === "--expected" && argv[i + 1]) {
      out.expectedPath = argv[++i];
    } else if (argv[i] === "--wl" && argv[i + 1]) {
      out.wlFilter = argv[++i];
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      out.help = true;
    }
  }
  out.expectedPath = out.expectedPath || EXPECTED_PATH;
  return out;
}

function usage() {
  console.log(`Usage: node verify-cost-rpc.js [--database-url URL] [--expected path] [--wl KEY]

Asserts calculate_item_costs_with_breakdown_scoped / _wholesale_overrides
against cost-rpc-expected.json (docs/cost-rpc-integration-test-plan.txt §6).

  --wl KEY   Run only cases for this WL group (e.g. none, C01B). Used by run-cost-rpc-verify.sh.

Run full flow: ./supabase/test/run-cost-rpc-verify.sh`);
}

function loadExpected(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!raw.cases?.length) throw new Error(`No cases in ${filePath}`);
  return raw;
}

function near(a, b, tol) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= tol;
}

function groupCasesByWl(cases) {
  const order = [];
  const map = new Map();
  for (const c of cases) {
    const key = c.wl ?? "none";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(c);
  }
  return { order, map };
}

async function callScoped(client, tenantId, seedId) {
  const { rows } = await client.query(
    `SELECT out_item_id,
            out_food_cost_per_gram::float8 AS food,
            out_labor_cost_per_gram::float8 AS labor,
            out_total_cost_per_gram::float8 AS total
       FROM calculate_item_costs_with_breakdown_scoped($1::uuid, 0, ARRAY[$2::uuid]::uuid[])`,
    [tenantId, seedId],
  );
  return rows;
}

async function callWholesale(client, tenantId, seedId, wlId) {
  const { rows } = await client.query(
    `SELECT out_item_id,
            out_food_cost_per_gram::float8 AS food,
            out_labor_cost_per_gram::float8 AS labor,
            out_total_cost_per_gram::float8 AS total
       FROM calculate_item_costs_with_breakdown_wholesale_overrides(
         $1::uuid, 0, ARRAY[$2::uuid]::uuid[], $3::uuid)`,
    [tenantId, seedId, wlId],
  );
  return rows;
}

function findRow(rows, seedId) {
  return rows.find((r) => r.out_item_id === seedId);
}

function formatNum(n) {
  if (n === null || n === undefined) return "null";
  return Number(n).toFixed(8);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.databaseUrl) {
    console.error("DATABASE_URL is required (or pass --database-url).");
    usage();
    process.exit(1);
  }

  const spec = loadExpected(args.expectedPath);
  const { tenantId, wholesaleListId, tolerance, items } = spec;
  let cases = spec.cases;
  if (args.wlFilter !== null) {
    cases = cases.filter((c) => (c.wl ?? "none") === args.wlFilter);
    if (cases.length === 0) {
      console.error(`No cases for --wl ${args.wlFilter}`);
      process.exit(1);
    }
  }
  const { order, map } = groupCasesByWl(cases);

  const client = new Client({ connectionString: args.databaseUrl });
  await client.connect();

  let passed = 0;
  let failed = 0;
  const failures = [];

  try {
    for (const wlKey of order) {
      const batch = map.get(wlKey);
      console.log(`\n--- WL: ${wlKey} (${batch.length} assertions) ---`);

      for (const tc of batch) {
        const seedId = items[tc.seed];
        if (!seedId) {
          failed++;
          failures.push({ id: tc.id, error: `Unknown seed symbol: ${tc.seed}` });
          continue;
        }

        const callTenantId = tc.tenantId || tenantId;

        let rows;
        try {
          if (tc.rpc === "scoped") {
            rows = await callScoped(client, callTenantId, seedId);
          } else if (tc.rpc === "wholesale") {
            rows = await callWholesale(client, callTenantId, seedId, wholesaleListId);
          } else {
            throw new Error(`Unknown rpc: ${tc.rpc}`);
          }
        } catch (err) {
          failed++;
          failures.push({ id: tc.id, error: `RPC error: ${err.message}` });
          continue;
        }

        const row = findRow(rows, seedId);
        if (!row) {
          failed++;
          failures.push({
            id: tc.id,
            error: `No row for seed ${tc.seed} (${seedId}); got ${rows.length} row(s)`,
          });
          continue;
        }

        if (tc.rpc === "scoped") {
          const okFood = near(row.food, tc.food, tolerance);
          const okLabor = near(row.labor, tc.labor, tolerance);
          const okTotal = near(row.total, tc.total, tolerance);
          if (okFood && okLabor && okTotal) {
            passed++;
            console.log(`  OK  ${tc.id}`);
          } else {
            failed++;
            failures.push({
              id: tc.id,
              error: `scoped mismatch`,
              expected: { food: tc.food, labor: tc.labor, total: tc.total },
              actual: { food: row.food, labor: row.labor, total: row.total },
            });
            console.log(`  FAIL ${tc.id}`);
            console.log(
              `       food   exp=${formatNum(tc.food)} act=${formatNum(row.food)}`,
            );
            console.log(
              `       labor  exp=${formatNum(tc.labor)} act=${formatNum(row.labor)}`,
            );
            console.log(
              `       total  exp=${formatNum(tc.total)} act=${formatNum(row.total)}`,
            );
          }
        } else {
          const okTotal = near(row.total, tc.total, tolerance);
          if (okTotal) {
            passed++;
            console.log(`  OK  ${tc.id}`);
          } else {
            failed++;
            failures.push({
              id: tc.id,
              error: `wholesale total mismatch`,
              expected: { total: tc.total },
              actual: { total: row.total },
            });
            console.log(`  FAIL ${tc.id}`);
            console.log(
              `       total  exp=${formatNum(tc.total)} act=${formatNum(row.total)}`,
            );
          }
        }
      }
    }
  } finally {
    await client.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const f of failures) {
      console.error(`  ${f.id}: ${f.error}`);
      if (f.expected) console.error(`    expected: ${JSON.stringify(f.expected)}`);
      if (f.actual) console.error(`    actual:   ${JSON.stringify(f.actual)}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
