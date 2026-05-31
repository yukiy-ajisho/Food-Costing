#!/usr/bin/env bash
# Local cost RPC integration test: schema-baseline → fixture → automated RPC asserts.
#
# Usage (from repo root):
#   ./supabase/test/run-cost-rpc-verify.sh          # fresh DB + setup + verify
#   ./supabase/test/run-cost-rpc-verify.sh verify   # verify only (DB already set up)
#   ./supabase/test/run-cost-rpc-verify.sh setup    # schema + fixture only
#
# Requires: supabase CLI (for default DB URL), psql, node 20+, npm
# Optional: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$ROOT_DIR/supabase/test"
SCHEMA_BASELINE="$TEST_DIR/schema-baseline-20260520_pre_cost_breakdown_rpc_tests.sql"
FIXTURE_BASE="$TEST_DIR/cost-rpc-fixture-base.sql"
WL_CLEAR="$TEST_DIR/cost-rpc-fixture-wl-clear.sql"
DOCKER_ROLES="$TEST_DIR/cost-rpc-docker-roles.sql"
DOCKER_AUTH_STUB="$TEST_DIR/cost-rpc-docker-auth-stub.sql"
EXPECTED_JSON="$TEST_DIR/cost-rpc-expected.json"

MODE="${1:-all}"

resolve_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    return
  fi
  if command -v supabase >/dev/null 2>&1; then
    local json
    json="$(supabase status -o json 2>/dev/null || true)"
    if [[ -n "$json" ]]; then
      DATABASE_URL="$(node -e "
        const j = JSON.parse(process.argv[1]);
        const u = j.DB_URL || j.db_url || '';
        if (u) process.stdout.write(u);
      " "$json" 2>/dev/null || true)"
    fi
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    echo "DATABASE_URL not set; using default local Supabase: $DATABASE_URL" >&2
  fi
}

psql_file() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1"
}

fresh_public_schema() {
  echo ">> Reset public schema (DROP CASCADE + CREATE)..."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
SQL
}

run_setup() {
  echo ">> Apply schema baseline..."
  psql_file "$SCHEMA_BASELINE"
  echo ">> Apply fixture base..."
  psql_file "$FIXTURE_BASE"
  echo ">> Clear WL (scenario A)..."
  psql_file "$WL_CLEAR"
}

apply_wl_fixture() {
  local wl_key="$1"
  if [[ "$wl_key" == "none" ]]; then
    psql_file "$WL_CLEAR"
    return
  fi
  local file
  file="$(node -e "
    const spec = require(process.argv[1]);
    const f = spec.wlFixtures[process.argv[2]];
    if (!f) { process.stderr.write('Unknown wl key: ' + process.argv[2]); process.exit(1); }
    process.stdout.write(f);
  " "$EXPECTED_JSON" "$wl_key")"
  echo ">> WL fixture: $file"
  psql_file "$TEST_DIR/$file"
}

run_verify() {
  echo ">> Install test deps (pg) if needed..."
  (cd "$TEST_DIR" && npm install --silent --no-fund --no-audit)

  local wl_order
  wl_order="$(node -e "
    const spec = require(process.argv[1]);
    const seen = new Set();
    const order = [];
    for (const c of spec.cases) {
      const k = c.wl ?? 'none';
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    }
    console.log(order.join(' '));
  " "$EXPECTED_JSON")"

  for wl_key in $wl_order; do
    apply_wl_fixture "$wl_key"
    DATABASE_URL="$DATABASE_URL" node "$TEST_DIR/verify-cost-rpc.js" --wl "$wl_key"
  done
}

main() {
  resolve_database_url
  export DATABASE_URL

  case "$MODE" in
    all)
      fresh_public_schema
      psql_file "$DOCKER_ROLES"
      psql_file "$DOCKER_AUTH_STUB"
      run_setup
      run_verify
      ;;
    setup)
      fresh_public_schema
      psql_file "$DOCKER_ROLES"
      psql_file "$DOCKER_AUTH_STUB"
      run_setup
      echo "Setup complete."
      ;;
    verify)
      run_verify
      ;;
    *)
      echo "Unknown mode: $MODE (use: all | setup | verify)" >&2
      exit 1
      ;;
  esac

  echo ">> Cost RPC verify finished OK."
}

main
