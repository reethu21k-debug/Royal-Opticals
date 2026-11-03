# Deployment & operations runbook
**Status: written from tested behaviour; the deployment itself has NOT been performed** (no Vercel/Supabase credentials were available). Everything marked "verified" was exercised locally (PostgreSQL 16 + the production build of the app).

## 1. Environments
Separate **development** and **production** Supabase projects. Never test destructive migrations on production. Migrations live in `db/migrations/0001…0012` (apply in order with the Supabase CLI: `supabase db push`, or the SQL editor). They are idempotent only when applied once and in order.

## 2. Supabase setup (production)
1. Create the project; note `SUPABASE_URL`, `anon` key, **service-role key** (server only), and the **JWT secret** (Settings → API).
2. Apply the migrations. They create the `authenticated`-role grants used by RLS. Roles `authenticated`/`anon` already exist on Supabase.
3. Create the organization row and the **first administrator** (one-time, SQL editor):
   `insert into organizations(id,name) values (gen_random_uuid(),'Royal Opticals');` then create the user in Supabase Auth and
   `insert into profiles(id,organization_id,full_name,role) values ('<auth user id>','<org id>','<name>','administrator');`
   After that, administrators create further users in the app (Users → New user; uses the service-role key server-side).
4. Auth settings: disable public sign-ups; set password policy ≥ 12 chars; enable email confirmation as needed.

## 3. Web app (Vercel)
Environment variables (see `web/.env.example`): `DATABASE_URL` (Supabase connection string; a role allowed to `SET ROLE authenticated`, i.e. the `postgres` role or equivalent), `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**server only; never `NEXT_PUBLIC_*`**), optional `RATE_LIMIT_READS` / `RATE_LIMIT_WRITES` (per user per minute, default 600/120).
- Use the **session-mode or direct** connection, or transaction-mode pooler: the app issues `begin; set_config(...); set local role authenticated` per request, which is compatible with transaction pooling because everything is `LOCAL` to the transaction.
- The in-memory rate limiter is per server instance. On serverless, add an edge/Redis limiter for strict guarantees.
- Security headers/CSP are set in `next.config.mjs`. HTTPS + custom domain via Vercel.
- **Not verified:** a Vercel build/deploy, Supabase pooler behaviour, live Supabase Auth (tested only against a protocol-level mock: `web/tests/mock_gotrue.py`).

## 4. First data load (production migration) — only after the client has approved the production migration (decisions are recorded in `docs/open-questions.md`)
1. Create a staging copy of production and rehearse: `python3 migration/load_rehearsal.py` (throwaway DB) → review `docs/reconciliation-report.md`.
2. Import through the app (**Import Excel**), one workbook at a time, or in bulk: `python3 migration/bulk_import_via_api.py <app-url> <manager-access-token> <Excel-root>` (recreates the exact folder tree and imports every inventory workbook through the same wizard API). Verified end-to-end into an empty database: 57 workbooks / 7,706 variants, every quantity and state identical to the verified source, 479 findings queued for review, re-run harmless (`web/tests/bulk_import_e2e.py`).
3. The wizard computes the stored display order and refreshes planner statistics after each import (`refresh_variant_order`). For very large changes also run `VACUUM ANALYZE`.
4. Work through the **Data review** queue; counts for blank/unverified stock via **Stock counts**. The client signs off the reconciliation before the app becomes the authoritative record.

## 5. Backups & recovery
- Enable Supabase **daily backups / PITR** (plan-dependent) — **not verified here**.
- Logical backup drill (verified locally, `ops/backup_restore_test.py`, 12 checks): `pg_dump -Fc --no-owner <url> -f backup.dump` → `pg_restore --no-owner -d <new-db-url> backup.dump`. **Do not use `--no-privileges`** (the restored database then denies the app role — found by the drill). The `authenticated`/`anon` roles must exist on the target before restoring. The drill proved: all 23 tables identical by content checksum after a simulated accidental data change, RLS/policies/triggers/functions intact, the ledger still equals the balances, workflows work for an end user.
- Not in a database dump: uploaded workbook originals are stored in `import_files` (inside the DB, so they are included); there is no Supabase Storage dependency.
- Recovery objective is the customer's decision (daily backup ⇒ up to 24 h of data loss unless PITR is enabled). Rehearse a restore quarterly.

## 6. Operations
- **Users:** administrators manage roles/deactivation in the app; every change is in the audit log (Reports → Inventory audit log).
- **Mistaken import:** Import Excel → batch → *Roll back* (refused if later movements/orders/counts touched those items; ledger stays append-only via `reversal` movements and archiving).
- **Stock discrepancy:** a manager creates a **Stock count** session; approval posts only lines whose balance did not move since the snapshot.
- **Monitoring:** watch Vercel function errors and Supabase logs; the API never returns stack traces (details go to server logs).
- **Performance:** see `docs/performance.md`. Re-run `ops/load_test.py` and `db/tests/perf_test.py` after significant changes.
- **Maintenance owner:** to be named by the client (open).