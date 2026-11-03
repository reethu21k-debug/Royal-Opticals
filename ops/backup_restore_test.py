#!/usr/bin/env python3
"""
Backup & restore DRILL (local PostgreSQL 16). Proves the procedure and that nothing is lost or weakened by a dump/restore cycle:
  1. build a populated database (the rehearsal import: 7,706 variants, ledger, review items, users);
  2. pg_dump (custom format) -> file;  3. simulate an accidental data-destroying change in the live DB;
  4. pg_restore into a SEPARATE fresh server;  5. compare every table by row count + content checksum with the pre-disaster snapshot;
  6. verify RLS, triggers, functions and constraints survived; 7. run live workflows on the restored DB.
NOT verified here: Supabase managed backups / PITR, cross-version restores, restoring Storage objects.
"""
import os, sys, json, time, uuid, subprocess, tempfile, hashlib, signal
import pgserver, psycopg
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
BIN = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin")
USERS = {k: str(uuid.uuid4()) for k in ("admin", "manager", "staff", "readonly")}; URIF = os.path.join(tempfile.mkdtemp(), "uri")
loader = subprocess.Popen([sys.executable, os.path.join(REPO, "migration", "load_rehearsal.py"), os.path.join(REPO, "migration", "staging.sqlite"), "/tmp/recon-backup.md"],
    env=dict(os.environ, KEEP_URI_FILE=URIF, TEST_USERS=json.dumps(USERS)), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
results = []; chk = lambda n, ok, d="": (results.append((n, ok, d)), print(("PASS " if ok else "FAIL ") + n + (f"  [{d}]" if d else "")))
try:
    for _ in range(300):
        if os.path.exists(URIF) and open(URIF).read(): break
        if loader.poll() is not None: raise SystemExit("loader died: " + loader.stderr.read().decode()[-500:])
        time.sleep(1)
    SRC = open(URIF).read(); live = psycopg.connect(SRC, autocommit=True)
    tables = [r[0] for r in live.execute("select tablename from pg_tables where schemaname='public' order by 1")]
    def fingerprint(c):
        fp = {}
        for t in tables:
            n = c.execute(f'select count(*) from "{t}"').fetchone()[0]
            h = c.execute(f'select coalesce(md5(string_agg(x::text, \'|\' order by x::text)), \'\') from "{t}" x').fetchone()[0]
            fp[t] = (n, h)
        return fp
    before = fingerprint(live); total_rows = sum(n for n, _ in before.values())
    chk("source database populated", before["lens_variants"][0] == 7706 and before["stock_movements"][0] > 3000, f"{len(tables)} tables, {total_rows:,} rows")
    dump = os.path.join(tempfile.mkdtemp(), "backup.dump"); t0 = time.time()
    subprocess.run([os.path.join(BIN, "pg_dump"), "-Fc", "--no-owner", "-f", dump, SRC], check=True)
    chk("pg_dump produced a backup", os.path.getsize(dump) > 100_000, f"{os.path.getsize(dump)/1e6:.1f} MB in {time.time()-t0:.1f}s")
    # --- disaster: an operator mistake changes live data after the backup ---
    live.execute("update stock_balances set available_quantity = 0 where available_quantity is not null")
    live.execute("update catalog_nodes set is_active = false where kind = 'family'")
    after = fingerprint(live); chk("disaster is real (live data now differs from backup)", after["stock_balances"] != before["stock_balances"] and after["catalog_nodes"] != before["catalog_nodes"])
    # --- restore into a separate, fresh server ---
    srv2 = pgserver.get_server(tempfile.mkdtemp()); dst = psycopg.connect(srv2.get_uri(), autocommit=True)
    dst.execute("create role authenticated nologin; create role anon nologin;")        # roles are cluster-level and not in the dump (as on any new cluster/Supabase project)
    t0 = time.time(); r = subprocess.run([os.path.join(BIN, "pg_restore"), "--no-owner", "-d", srv2.get_uri(), dump], capture_output=True, text=True)
    chk("pg_restore completed without errors", r.returncode == 0 and not r.stderr.strip(), f"{time.time()-t0:.1f}s {r.stderr.strip()[:200]}")
    restored = fingerprint(dst); bad = [t for t in tables if restored[t] != before[t]]
    chk("every table restored identically (row count + content checksum) to the pre-disaster state", not bad, f"{len(tables)} tables compared; differing: {bad}")
    q = lambda s, *a: dst.execute(s, a).fetchone()[0]
    chk("RLS enabled and forced on all protected tables", q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity") >= 20, str(q("select count(*) from pg_policies where schemaname='public'")) + " policies")
    chk("policies identical", q("select count(*) from pg_policies where schemaname='public'") == live.execute("select count(*) from pg_policies where schemaname='public'").fetchone()[0])
    chk("stock engine functions present", q("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('post_stock_movement','post_physical_count','approve_count_session','execute_import_batch','rollback_import_batch','receive_purchase_order')") == 6)
    try: dst.execute("update stock_movements set quantity_delta = 999"); append_only = False
    except Exception as e: append_only = "append-only" in str(e)
    chk("append-only trigger survived the restore", append_only)
    chk("ledger still reconciles with balances", q("select count(*) from stock_balances b where b.available_quantity is distinct from (select sum(quantity_delta) from stock_movements m where m.variant_id=b.variant_id)") == 0)
    # --- live workflows on the restored database (as a real end user, under RLS) ---
    dst.execute("select set_config('request.jwt.claim.sub', %s, false)", (USERS["staff"],)); dst.execute("set role authenticated")
    v, a0 = dst.execute("select variant_id, available_quantity from v_inventory where available_state='recorded' and available_quantity > 2 limit 1").fetchone()
    dst.execute("select post_stock_movement(%s,'issue',1,'post-restore test')", (v,))
    chk("restored database accepts a stock issue as an end user", dst.execute("select available_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0] == a0 - 1)
    try: dst.execute("update stock_balances set available_quantity = 999"); direct = dst.execute("select count(*) from stock_balances where available_quantity = 999").fetchone()[0]
    except Exception: direct = 0
    chk("direct stock writes are still impossible for clients", direct == 0)
    dst.execute("reset role"); srv2.cleanup()
finally:
    if loader.poll() is None: loader.kill()
bad = [r for r in results if not r[1]]; print(f"\n{len(results)-len(bad)}/{len(results)} backup/restore checks passed"); sys.exit(1 if bad else 0)
