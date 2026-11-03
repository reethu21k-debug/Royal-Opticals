# Acceptance checklist (v4) — "Verified" = an automated test or script in this repo proves it

## Data fidelity
- [x] Every file/folder/sheet/cell staged losslessly; staged records equal the original files; no orphaned cell — `migration/verify_*.py`
- [x] Exact hierarchy (incl. empty folders, source typos) reproduced in the app — bulk import test (58 folders, 119 file nodes)
- [x] Blank != 0; invalid kept as `invalid`; suspect stock `unverified` — DB, API, bulk tests
- [x] Duplicates/conflicts queued for review, never merged; identical file re-import rejected — wizard + bulk tests
- [x] Imported quantities equal approved source records (7,706 variants, 0 differences) — `bulk_import_e2e.py`
- [x] **Client answers to the 17 questions in `docs/open-questions.md`** — received and implemented (migration `0014`, tests `client_decision_*`)
- [ ] Client follow-ups: real user names/emails (Q-ROLE-1), supplier details (Q-SUP-1), `CR HMC +POWER.xlsx` confirmation (Q-DUP-1), physical counts for unverified/blank stock, unit convention (Q-UNIT-1) — OPEN
- [ ] Client approval of the production migration and sign-off of the reconciliation on real data — OPEN
- [ ] **Production import performed** — NOT DONE

## Inventory & stock
- [x] Receive / issue / count / target / history, idempotent, concurrent-safe, no oversell (also under HTTP load) — DB, API, load tests
- [x] Suggested order = MAX(0, T−A), NULL if unknown; optional net replenishment (off by default, separate column)
- [x] Count sessions (folder/workbook/block), Excel sheet export/import, manager approval, stale-line protection
- [x] Bulk targets: by folder, by Excel (dry run), history + reasons
- [x] Power matrix in source order; SPH/CYL/ADD range filters; archive; configurable issue reasons

## Purchasing
- [x] Suppliers (+ preferred-supplier links by folder/block/variant, inherited), suggested → draft PO, confirm, partial receipts, over-receipt rejected, cancel/close-short, printable PO (browser print)
- [x] PO PDF export (server-side, exact labels) — Verified (API, text extracted from the PDF)

## Reports / admin
- [x] 10 reports with date filters + Excel export, consistent with the dashboard; dashboard needs-attention/recent activity/pending imports
- [x] Users: roles, deactivate, last-admin guard, **create accounts** (service-role key server-side), audit log; settings; folder admin (display labels, archive)
- [x] Review queue: per-item and bulk decisions, audited

## Security
- [x] JWT verified server-side, RLS on every table, stock tables write-protected from clients, append-only ledger/audit
- [x] Rate limiting (per instance), same-origin check, CSP/security headers, upload type/size checks, SQL injection test, httpOnly cookies, refresh-token rotation (mock)
- [ ] Live Supabase Auth / Admin API — only a protocol-level mock tested
- [ ] Shared rate limiter, malware scanning of uploads, penetration test — NOT DONE

## Quality & operations
- [x] 27 DB + 32 API + 16 browser + 11 bulk-import + 6 unit/parity tests; axe audit 0 violations; backup/restore drill 12/12; load + scale tests
- [ ] Manual accessibility / screen-reader review, usability test with real staff — NOT DONE
- [ ] Deployment, managed backups/PITR verified, monitoring — NOT DONE (`docs/deployment.md` is the runbook)
- [ ] Training and handover; named maintainer — NOT DONE