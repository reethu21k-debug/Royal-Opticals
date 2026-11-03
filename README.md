<<<<<<< HEAD
# Royal Opticals — lens inventory system

## STATUS (honest)

| Area | State | Evidence |
|---|---|---|
| Source audit (119 files, 273 sheets, 31,433 cells) | **Done, verified** | `docs/source-data-audit.md`, `migration/verify_*.py` |
| Database (schema, stock engine, RLS, counts, POs, imports, settings, users, supplier links; perf-tuned) | **Done, tested** | `python3 db/tests/test_db.py` → 27/27; `docs/data-dictionary.md` |
| TypeScript import engine = Python reference | **Proven** | `npm run test:unit` → 6/6 (7,931 records + 479 findings, 0 differences; mutation-checked) |
| Web API (≈45 routes) | **Tested over HTTP** | `python3 web/tests/api_integration.py` → 32/32 |
| Web UI (dashboard, hierarchy tree, search + power/archive filters, matrix, stock screens, counts, imports wizard, suppliers + links, POs, suggested orders (+net), reports, review (+bulk), users (+create), settings, folders admin, login/sign-out) | **Browser-tested** | `python3 web/tests/e2e_browser.py` → 16/16 (Chromium) |
| **Production-path import**: whole archive through the wizard into an empty DB | **Verified**: 57 workbooks, 7,706 variants identical to source, 479/479 findings queued, re-run harmless | `python3 web/tests/bulk_import_e2e.py` → 11/11 |
| Accessibility (automated axe, WCAG 2.0/2.1 A+AA, 18 pages) | **0 violations** (automated only; no manual/screen-reader audit) | `web/tests/a11y_audit.py` |
| Backup / restore drill | **Verified locally** (pg_dump → fresh server; checksums identical) | `ops/backup_restore_test.py` → 12/12 |
| Load / scale | **Measured**: 150k variants slowest query 0.49 s; 25 users 38 req/s on ONE shared core, 0 lost updates | `docs/performance.md`, `ops/load_test.py`, `db/tests/perf_test.py` |
| Security | JWT verify, RLS, rate limit (per instance), origin check, CSP/headers, upload checks, last-admin guard | API tests |
| One command for every gate | `sh ops/verify_all.sh` (≈15 min) | `ops/verify_all.sh`, `.github/workflows/ci.yml` (CI file never executed) |
| **NOT DONE:** live Supabase Auth/Admin API (only a protocol-level mock), Vercel/Supabase deployment, managed backups/PITR, shared (Redis/edge) rate limiter, manual accessibility/usability review, user training | — | `docs/deployment.md` |
| **Production migration** | **NOT PERFORMED** — blocked on 17 client decisions (blank stock = 0?, which folder level is category/product, duplicate CR HMC file, …) | `docs/open-questions.md` |

Nothing in this repository has been deployed. No claim of production readiness is made.

## Reproduce

```bash
pip install openpyxl pgserver "psycopg[binary]"
cd migration
python3 extract.py <path-to>/Excel staging.sqlite     # lossless staging + interpretation
python3 derive_findings.py
python3 verify_staging.py && python3 verify_against_source.py <path-to>/Excel && python3 verify_coverage.py
python3 load_rehearsal.py                              # throwaway PG import + docs/reconciliation-report.md
python3 generate_docs.py
cd .. && python3 db/tests/test_db.py
```

## Key design decisions
- Stock quantities are **nullable with an explicit state** (`recorded|missing|invalid|unverified`); blank is never 0.
- `suggested_order = MAX(0, target − available)`; `NULL` if either is unknown. Legacy-compatible figure shown separately and labelled.
- Stock changes only via `SECURITY DEFINER` functions (row-locked, idempotent, append-only ledger, audited). Clients have no direct write policy on stock tables.
- Catalog is an adjacency tree of verbatim source names; variants hang off *blocks* (grid regions).
=======
# Royal-Opticals
Royal Opticals
>>>>>>> a3793682ea415ab34c56e66511c763f024e70410
