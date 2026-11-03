#!/bin/sh
# Runs EVERY verification gate in sequence. Needs: python3 + (openpyxl pgserver psycopg[binary] playwright), node 22, the Excel archive at $SRC_ROOT.
# Usage: SRC_ROOT=/path/to/Excel sh ops/verify_all.sh      (about 15 minutes on one CPU core)
set -e
cd "$(dirname "$0")/.."; SRC_ROOT="${SRC_ROOT:-/home/claude/src/Excel}"; export SRC_ROOT PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
step() { printf '\n=== %s ===\n' "$1"; }
step "1/10 staging gates (0 unexplained cells, 0 mismatches vs original files, 0 orphans)"
python3 migration/verify_staging.py migration/staging.sqlite | head -1
python3 migration/verify_against_source.py "$SRC_ROOT" migration/staging.sqlite
python3 migration/verify_coverage.py migration/staging.sqlite
step "2/10 database tests (real PostgreSQL)";            python3 db/tests/test_db.py | tail -1
step "3/10 import rehearsal reconciliation";             python3 migration/load_rehearsal.py | grep -E "Overall"
step "4/10 web build + typecheck + unit/parity tests";   (cd web && npm ci --silent && npx tsc --noEmit && npx next build >/dev/null && npm run test:unit 2>&1 | grep -E "^# (pass|fail)|parity")
step "5/10 HTTP API integration tests";                  (cd web && python3 tests/api_integration.py | tail -1)
step "6/10 browser end-to-end tests (Chromium)";          (cd web && python3 tests/e2e_browser.py | tail -1)
step "7/10 bulk import of the original archive via the wizard"; (cd web && python3 tests/bulk_import_e2e.py | tail -1)
step "8/10 accessibility audit (axe, WCAG A/AA)";          (cd web && python3 tests/a11y_audit.py | tail -1)
step "9/10 backup / restore drill";                      python3 ops/backup_restore_test.py | tail -1
step "10/10 load test (25 users) + 150k-row scale test";  python3 ops/load_test.py | tail -2; python3 db/tests/perf_test.py | tail -1
echo; echo "ALL GATES COMPLETED"
