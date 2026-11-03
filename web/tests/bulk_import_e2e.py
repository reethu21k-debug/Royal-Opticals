#!/usr/bin/env python3
"""Imports the ORIGINAL archive through the wizard API into an EMPTY database, then verifies every variant against the verified staging data."""
import os, sys, json, time, uuid, hmac, hashlib, base64, glob, sqlite3, subprocess, signal, socket, tempfile, urllib.request
import pgserver, psycopg
HERE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.dirname(HERE); REPO = os.path.dirname(WEB)
sys.path.insert(0, os.path.join(REPO, "migration")); import bulk_import_via_api as bulk
ROOT = os.environ.get("SRC_ROOT", "/home/claude/src/Excel"); SECRET = "bulk-" + uuid.uuid4().hex; PORT = 3113; BASE = f"http://127.0.0.1:{PORT}"
if socket.socket().connect_ex(("127.0.0.1", PORT)) == 0: raise SystemExit("port in use")
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b64(json.dumps({"sub": sub, "exp": int(time.time()) + 7200}).encode())
    return f"{h}.{p}.{b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"
srv = pgserver.get_server(tempfile.mkdtemp()); URI = srv.get_uri(); db = psycopg.connect(URI, autocommit=True)
db.execute("create role authenticated nologin; create role anon nologin;")
for f in sorted(glob.glob(os.path.join(REPO, "db", "migrations", "*.sql"))): db.execute(open(f).read())
org = str(uuid.uuid4()); mgr = str(uuid.uuid4()); db.execute("insert into organizations(id,name) values (%s,'Royal Opticals')", (org,))
db.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,'mgr','inventory_manager')", (mgr, org))
server = subprocess.Popen(["npx", "next", "start", "-p", str(PORT)], cwd=WEB, env=dict(os.environ, DATABASE_URL=URI, SUPABASE_JWT_SECRET=SECRET, RATE_LIMIT_WRITES="100000", RATE_LIMIT_READS="100000"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
code = 1
try:
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/login"); break
        except Exception: time.sleep(1)
    t0 = time.time(); res = bulk.run(BASE, jwt(mgr), ROOT, log=lambda m: None); print(f"bulk import finished in {time.time()-t0:.0f}s:", json.dumps({k: (v if not isinstance(v, list) else len(v)) for k, v in res.items()}))
    sq = sqlite3.connect(os.path.join(REPO, "migration", "staging.sqlite")); sq.row_factory = sqlite3.Row
    checks = []; ck = lambda n, ok, d="": (checks.append((n, ok, d)), None)
    ck("no import errors", not res["errors"], str(res["errors"][:3]))
    n_dirs = sum(1 for dp, dn, fn in os.walk(ROOT) for _ in dn); n_files = sq.execute("select count(*) from source_files").fetchone()[0]
    q = lambda s, *a: db.execute(s, a).fetchone()[0]
    ck("every directory is a node", q("select count(*) from catalog_nodes where kind in ('family','folder')") == n_dirs, f"{n_dirs}")
    ck("every source file is a node", q("select count(*) from catalog_nodes where kind='workbook'") == n_files, f"{n_files}")
    HOLD = bulk.HOLD
    # expected per-variant values (same rules as the rehearsal loader)
    unver = {r[0] for r in sq.execute("select file_rel from anomalies where code='STOCK_SHEET_IDENTICAL_TO_TARGET'")}
    blk = {(r["file_id"], r["block_index"]): r["header_cell"] for r in sq.execute("select s.file_id,b.block_index,b.header_cell from blocks b join source_sheets s on s.id=b.sheet_id where upper(trim(s.sheet_name))='LENS QUANTITY'")}
    rel = {r["id"]: r["rel_path"] for r in sq.execute("select id,rel_path from source_files")}
    def qty(raw, num):
        if raw is None: return None, "missing"
        if num is None or num < 0 or abs(num - round(num)) > 1e-9: return None, "invalid"
        return int(round(num)), "recorded"
    exp = {}
    for v in sq.execute("select * from variant_records"):
        r = rel[v["file_id"]]
        if r in HOLD: continue
        tq, ts = qty(v["target_raw"], v["target_num"]); aq, as_ = qty(v["stock_raw"], v["stock_num"])
        if as_ == "recorded" and r in unver: as_ = "unverified"
        exp[(f"{r}#{blk[(v['file_id'], v['block_index'])]}", v["row_key"] or "", v["row_occurrence"], v["col_key"] or "")] = (tq, ts, aq, as_)
    got = {}
    for r in db.execute("""select n.source_path, v.row_key, v.row_occurrence, v.col_key, b.target_quantity, b.target_state::text, b.available_quantity, b.available_state::text
                           from lens_variants v join stock_balances b on b.variant_id=v.id join catalog_nodes n on n.id=v.block_node_id"""):
        got[(r[0], r[1], r[2], r[3])] = tuple(r[4:])
    ck("variant count equals verified staging (7,931 - 225 held)", len(got) == len(exp) == 7706, f"db={len(got)} expected={len(exp)}")
    missing = [k for k in exp if k not in got]; extra = [k for k in got if k not in exp]; diff = [k for k in exp if k in got and exp[k] != got[k]]
    ck("no missing / extra variants", not missing and not extra, f"missing={len(missing)} extra={len(extra)} e.g. {missing[:1]} {extra[:1]}")
    ck("every quantity and state identical to source", not diff, f"{len(diff)} differences e.g. {[(k, exp[k], got[k]) for k in diff[:2]]}")
    ck("blank stock never became zero", q("select count(*) from stock_balances where available_state='missing' and available_quantity is not null") == 0)
    ck("ledger = balances", q("select count(*) from stock_balances b where b.available_quantity is distinct from (select sum(quantity_delta) from stock_movements m where m.variant_id=b.variant_id)") == 0)
    ck("duplicate/hold handling", len(res["held_by_decision"]) == 1 and q("select count(*) from import_batches where status='imported'") == 57, f"imported batches={q('select count(*) from import_batches where status=' + chr(39) + 'imported' + chr(39))}")
    CODES = ('VALUE_WITHOUT_TARGET_POSITION','SHEET_TITLE_MISMATCH','DUPLICATE_ROW_LABEL_IN_BLOCK','FORMULA_ERROR_VALUE','AXIS_ANGLE_CONFLICT','STOCK_SHEET_IDENTICAL_TO_TARGET','NO_STOCK_QUANTITIES_RECORDED','STOCK_MOSTLY_BLANK','EXTERNAL_WORKBOOK_LINK')
    triad_imported = {rel[v["file_id"]] for v in sq.execute("select distinct file_id from variant_records v")} - HOLD
    pyc = {}
    for a in sq.execute("select code,file_rel from anomalies"):
        if a["code"] in CODES and a["file_rel"] in triad_imported: pyc[a["code"]] = pyc.get(a["code"], 0) + 1
    dbc = dict(db.execute("select code,count(*)::int from review_items where code = any(%s) group by 1", (list(CODES),)).fetchall())
    ck("every source finding of the imported workbooks is queued for review (exact per-code counts)", pyc == dbc, f"python={sum(pyc.values())} db={sum(dbc.values())} diff={ {k:(pyc.get(k),dbc.get(k)) for k in set(pyc)|set(dbc) if pyc.get(k)!=dbc.get(k)} }")
    # re-running the whole import must not double anything
    res2 = bulk.run(BASE, jwt(mgr), ROOT, log=lambda m: None)
    ck("re-import is rejected/harmless (no doubling)", q("select count(*) from lens_variants") == len(exp) and q("select coalesce(sum(available_quantity),0) from stock_balances") == sum(v[2] or 0 for v in exp.values()), f"re-run errors={len(res2['errors'])}")
    for n, ok, d in checks: print(("PASS " if ok else "FAIL ") + n + (f"  [{d}]" if d else ""))
    bad = [c for c in checks if not c[1]]; print(f"\n{len(checks)-len(bad)}/{len(checks)} bulk-import checks passed"); code = 1 if bad else 0
finally:
    try: os.killpg(server.pid, signal.SIGKILL)
    except Exception: pass
    srv.cleanup()
sys.exit(code)
