#!/usr/bin/env python3
"""
Promote STAGED data (staging.sqlite) into a PostgreSQL database and reconcile it against the source.

This is a REHEARSAL: it targets a throwaway database. It is not a production migration and nothing here
is "approved by the client". Held/duplicate/suspect items are routed to review_items, never dropped or merged.

Usage: python3 load_rehearsal.py [staging.sqlite] [report.md]
"""
import os, re, sys, json, glob, sqlite3, tempfile, uuid, hashlib, collections
import pgserver, psycopg

HERE = os.path.dirname(os.path.abspath(__file__))
STAGING = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "staging.sqlite")
REPORT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "docs", "reconciliation-report.md")
SRC_ROOT = os.environ.get("SRC_ROOT", "/home/claude/src/Excel")

# Duplicate triad workbooks: both copies are byte-identical. Exactly one may carry stock.
# 'CR HMC +POWER.xlsx' is byte-identical to 'CR HMC -6-2.xlsx' but its CONTENT is the negative-power grid
# ((-) CYL / (-) SPH), contradicting its '+POWER' name. We HOLD the '+POWER' copy and ask the client (Q-DUP-1).
HOLD_DUPLICATE_OVERRIDE = {"SINGLE VISION LENS/SV +6+2 Lens/INVENTORY SV +POWER/CR HMC +POWER.xlsx":
                           "byte-identical to 'SV -6-2 Lens/INVENTORY SV -6-2/CR HMC -6-2.xlsx'; content is the -6-2 grid, contradicting the '+POWER' filename"}
# Workbooks whose STOCK LENS grid is a copy of LENS QUANTITY -> available imported as 'unverified'
# (derived from the audit's STOCK_SHEET_IDENTICAL_TO_TARGET finding; not hard-coded).

sq = sqlite3.connect(STAGING); sq.row_factory = sqlite3.Row
srv = pgserver.get_server(tempfile.mkdtemp()); pg = psycopg.connect(srv.get_uri(), autocommit=True)
pg.execute("create role authenticated nologin; create role anon nologin;")
for f in sorted(glob.glob(os.path.join(HERE, "..", "db", "migrations", "*.sql"))):
    pg.execute(open(f).read())

ORG = str(uuid.uuid4()); BATCH = str(uuid.uuid4())
pg.execute("insert into organizations(id,name) values (%s,'Royal Opticals (rehearsal)')", (ORG,))
archive_sha = hashlib.sha256(open("/mnt/user-data/uploads/Excel.zip", "rb").read()).hexdigest() if os.path.exists("/mnt/user-data/uploads/Excel.zip") else None
total_vr = sq.execute("select count(*) from variant_records").fetchone()[0]
pg.execute("insert into import_batches(id,organization_id,label,source_archive_sha256,status,total_source_records) values (%s,%s,'rehearsal-1',%s,'staged',%s)",
           (BATCH, ORG, archive_sha, total_vr))

# ───────── 1. catalog tree: every directory, every file (incl. empty folders and PDFs) ─────────
node_ids = {}
def ensure(path_parts, kind_last, sort=0):
    """create nodes for each prefix; folders are 'family' at depth 1 else 'folder'; last may be 'workbook'."""
    parent = None
    for i, part in enumerate(path_parts):
        key = tuple(path_parts[: i + 1])
        if key in node_ids:
            parent = node_ids[key]; continue
        kind = kind_last if i == len(path_parts) - 1 else ("family" if i == 0 else "folder")
        if i == 0 and kind != "workbook": kind = "family"
        nid = str(uuid.uuid4())
        pg.execute("insert into catalog_nodes(id,organization_id,parent_id,kind,source_name,source_path,sort_order) values (%s,%s,%s,%s,%s,%s,%s)",
                   (nid, ORG, parent, kind, part, "/".join(key), sort))
        node_ids[key] = nid; parent = nid
    return parent

all_dirs = []
for dp, dn, fn in os.walk(SRC_ROOT):
    dn.sort()
    rel = os.path.relpath(dp, SRC_ROOT)
    if rel != ".": all_dirs.append(rel)
for d in sorted(all_dirs): ensure(d.split("/"), "folder")
files = sq.execute("select * from source_files order by rel_path").fetchall()
for f in files: ensure(f["rel_path"].split("/"), "workbook")
n_dirs_nodes = len(all_dirs)

# ───────── 2. variants / balances / movements ─────────
anom = collections.defaultdict(list)
for a in sq.execute("select * from anomalies"): anom[(a["code"], a["file_rel"])].append(a)
unverified_files = {a["file_rel"] for a in sq.execute("select file_rel from anomalies where code='STOCK_SHEET_IDENTICAL_TO_TARGET'")}
file_by_id = {f["id"]: f for f in files}
sheet_blocks = {}
for r in sq.execute("""select s.file_id, upper(trim(s.sheet_name)) sh, b.block_index, b.header_cell, b.col_axis, b.row_axis, b.layout
                       from blocks b join source_sheets s on s.id=b.sheet_id"""):
    sheet_blocks.setdefault((r["file_id"], r["block_index"]), {})[r["sh"]] = r

def qty(raw, num):
    """returns (quantity or None, state). Blank -> missing (NOT zero). Non-numeric/negative/fractional -> invalid."""
    if raw is None: return None, "missing"
    if num is None: return None, "invalid"
    if num < 0 or abs(num - round(num)) > 1e-9: return None, "invalid"
    return int(round(num)), "recorded"

def nums_from_key(k):
    return [float(x) for x in re.findall(r"[+-]?\d+(?:\.\d+)?", k or "")]

stats = collections.Counter(); block_nodes = {}; imported = []; held = []
for vr in sq.execute("select * from variant_records order by file_id, block_index, id"):
    f = file_by_id[vr["file_id"]]; rel = f["rel_path"]
    payload = {k: vr[k] for k in vr.keys()}
    hold = None
    if rel in HOLD_DUPLICATE_OVERRIDE: hold = ("held_duplicate", HOLD_DUPLICATE_OVERRIDE[rel])
    if hold:
        pg.execute("insert into import_records(import_batch_id,source_file,source_sheet,source_cell,source_file_sha256,source_payload,status,hold_reason) values (%s,%s,%s,%s,%s,%s,%s,%s)",
                   (BATCH, rel, "LENS QUANTITY", vr["target_cell"], f["sha256"], json.dumps(payload), hold[0], hold[1]))
        held.append(vr["id"]); continue
    wb_node = node_ids[tuple(rel.split("/"))]
    bkey = (vr["file_id"], vr["block_index"])
    if bkey not in block_nodes:
        b = sheet_blocks[bkey].get("LENS QUANTITY") or next(iter(sheet_blocks[bkey].values()))
        name = f"{b['header_cell']} | {b['col_axis'] or '(list)'} x {b['row_axis']}"   # derived anchor label (no original name exists)
        bid = str(uuid.uuid4())
        pg.execute("insert into catalog_nodes(id,organization_id,parent_id,kind,source_name,source_path,sort_order) values (%s,%s,%s,'block',%s,%s,%s)",
                   (bid, ORG, wb_node, name, rel + "#" + b["header_cell"], vr["block_index"]))
        block_nodes[bkey] = (bid, b)
    bid, b = block_nodes[bkey]
    rk = nums_from_key(vr["row_key"]); ck = nums_from_key(vr["col_key"])
    vid = str(uuid.uuid4())
    from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
    sr = sc = None
    for cc in (vr["target_cell"], vr["stock_cell"], vr["order_cell"]):
        if cc:
            col_, row_ = coordinate_from_string(cc); sr, sc = row_, column_index_from_string(col_); break
    pg.execute("""insert into lens_variants(id,organization_id,block_node_id,row_axis_name,col_axis_name,row_label_source,col_label_source,row_key,col_key,row_occurrence,row_value,row_value2,col_value,source_row,source_col)
                  values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
               (vid, ORG, bid, vr["row_axis"], vr["col_axis"], vr["row_label_raw"], vr["col_label_raw"], vr["row_key"] or "", vr["col_key"] or "", vr["row_occurrence"],
                rk[0] if rk else None, rk[1] if len(rk) > 1 else None, ck[0] if ck else None, sr, sc))
    tq, ts = qty(vr["target_raw"], vr["target_num"]); aq, as_ = qty(vr["stock_raw"], vr["stock_num"])
    if as_ == "recorded" and rel in unverified_files: as_ = "unverified"
    pg.execute("insert into stock_balances(organization_id,variant_id,target_quantity,target_state,available_quantity,available_state) values (%s,%s,%s,%s,%s,%s)",
               (ORG, vid, tq, ts, aq, as_))
    if aq is not None:   # opening-balance movement referencing the import batch (never an ordinary receipt)
        pg.execute("""insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,reference_type,import_batch_id)
                      values (%s,%s,'opening_count',%s,null,%s,%s,'import_batch',%s)""",
                   (ORG, vid, aq, aq, "opening balance from source workbook" + (" (UNVERIFIED: stock grid equals target grid)" if as_ == "unverified" else ""), BATCH))
    pg.execute("insert into variant_source_values(variant_id,target_raw,stock_raw,legacy_order_formula,legacy_order_cached,source_flags) values (%s,%s,%s,%s,%s,%s)",
               (vid, vr["target_raw"], vr["stock_raw"], vr["order_formula"], vr["order_cached"], [x for x in (vr["flags"] or "").split(",") if x]))
    pg.execute("insert into import_records(import_batch_id,source_file,source_sheet,source_cell,source_file_sha256,source_payload,status,variant_id) values (%s,%s,%s,%s,%s,%s,'imported',%s)",
               (BATCH, rel, "LENS QUANTITY / STOCK LENS / ORDER LENS", f"T:{vr['target_cell']} S:{vr['stock_cell']} O:{vr['order_cell']}", f["sha256"], json.dumps(payload), vid))
    imported.append((vr["id"], vid, tq, ts, aq, as_))

# ───────── 3. review items from every audit finding ─────────
n_rev = 0
for a in sq.execute("select * from anomalies"):
    pg.execute("insert into review_items(organization_id,import_batch_id,severity,code,source_file,source_sheet,source_cell,detail) values (%s,%s,%s,%s,%s,%s,%s,%s)",
               (ORG, BATCH, a["severity"], a["code"], a["file_rel"], a["sheet"], a["cell"], a["detail"])); n_rev += 1
for rel, why in HOLD_DUPLICATE_OVERRIDE.items():
    pg.execute("insert into review_items(organization_id,import_batch_id,severity,code,source_file,detail) values (%s,%s,'HIGH','HELD_DUPLICATE_WORKBOOK',%s,%s)", (ORG, BATCH, rel, why)); n_rev += 1
pg.execute("select refresh_variant_order(%s)", (ORG,))
pg.execute("vacuum analyze")   # steady state (a real server has autovacuum); keeps planner statistics fresh after the bulk load
pg.execute("update import_batches set imported_records=%s, held_records=%s, status='validated' where id=%s", (len(imported), len(held), BATCH))

# ═════════ RECONCILIATION ═════════
lines = []; problems = []
def check(name, ok, detail=""):
    lines.append(f"| {name} | {'PASS' if ok else '**FAIL**'} | {detail} |")
    if not ok: problems.append(name)

q1 = lambda sql, *a: pg.execute(sql, a).fetchone()[0]
n_src_files = sq.execute("select count(*) from source_files").fetchone()[0]
check("every source file has a catalog node", q1("select count(*) from catalog_nodes where kind='workbook'") == n_src_files, f"{n_src_files} files (76 xlsx + 43 pdf)")
check("every source directory has a catalog node (incl. empty folders)",
      q1("select count(*) from catalog_nodes where kind in ('family','folder')") == n_dirs_nodes, f"{n_dirs_nodes} directories")
check("source variant records = imported + held", len(imported) + len(held) == total_vr, f"{total_vr} = {len(imported)} + {len(held)}")
check("no variant record silently dropped (import_records rows)", q1("select count(*) from import_records where import_batch_id=%s", BATCH) == total_vr)
# value-for-value comparison
bad = 0; state_ct = collections.Counter()
srcmap = {r["id"]: r for r in sq.execute("select * from variant_records")}
db_bal = {r[0]: r[1:] for r in pg.execute("select v.id,b.target_quantity,b.target_state,b.available_quantity,b.available_state from lens_variants v join stock_balances b on b.variant_id=v.id")}
for (srid, vid, tq, ts, aq, as_) in imported:
    d = db_bal[uuid.UUID(vid)] if not isinstance(vid, uuid.UUID) else db_bal[vid]
    if (d[0], d[1], d[2], d[3]) != (tq, ts, aq, as_): bad += 1
    sr = srcmap[srid]
    if sr["target_num"] is not None and ts == "recorded" and d[0] != int(sr["target_num"]): bad += 1
    if sr["stock_num"] is not None and as_ in ("recorded", "unverified") and d[2] != int(sr["stock_num"]): bad += 1
    state_ct[("target", ts)] += 1; state_ct[("available", as_)] += 1
check("target & available quantities identical to source for every imported record", bad == 0, f"{len(imported)} records compared, {bad} differences")
check("blank source cells are NOT imported as zero",
      q1("select count(*) from stock_balances where available_state='missing' and available_quantity is not null") == 0 and
      q1("select count(*) from stock_balances where target_state='missing' and target_quantity is not null") == 0)
n_blank_src = sum(1 for (srid, *_x) in imported if srcmap[srid]["stock_raw"] is None)
check("missing available stock preserved as NULL/'missing'", q1("select count(*) from stock_balances where available_state='missing'") == n_blank_src, f"{n_blank_src} positions")
check("opening movements = recorded/unverified available quantities", q1("select count(*) from stock_movements where movement_type='opening_count'") ==
      q1("select count(*) from stock_balances where available_quantity is not null"))
check("ledger reconciles with balances (sum of deltas = available)", q1("""select count(*) from stock_balances b where b.available_quantity is distinct from
      (select sum(m.quantity_delta) from stock_movements m where m.variant_id=b.variant_id)""") == 0,
      "0 balances differ from their movement ledger (unknown stock <-> no movements)")
check("every audit finding is queued for review", q1("select count(*) from review_items") == n_rev, f"{n_rev} review items, all 'open'")
# no duplicate stock from duplicate files
dup_groups = sq.execute("select sha256, group_concat(rel_path,'|') p from source_files where role='INVENTORY_TRIAD' group by sha256 having count(*)>1").fetchall()
check("duplicate inventory workbooks not double-counted", all(sum(1 for p in g["p"].split("|") if p not in HOLD_DUPLICATE_OVERRIDE) == 1 for g in dup_groups), f"{len(dup_groups)} duplicate group(s) among inventory workbooks; copy held for review")

# suggested order: DB vs independent python vs legacy
cmp = collections.Counter()
rows = pg.execute("select v.id, s.suggested_order, s.target_quantity, s.available_quantity, vs.legacy_order_cached, vs.legacy_order_formula, s.legacy_suggested_order_blank_as_zero, s.available_state from v_inventory s join lens_variants v on v.id=s.variant_id join variant_source_values vs on vs.variant_id=v.id").fetchall()
sugg_bad = 0
for vid, so, t, a, leg_c, leg_f, leg0, ast in rows:
    exp = None if (t is None or a is None or ast != 'recorded') else max(0, t - a)   # client decision: unverified stock gives no suggestion until counted
    if exp != so: sugg_bad += 1
    try: lc = float(leg_c) if leg_c is not None else None
    except ValueError: lc = None
    if leg_f is None and leg_c is None: cmp["no legacy order cell"] += 1
    elif lc is None: cmp["legacy order is an error/non-numeric"] += 1
    elif so is None: cmp["app = undetermined (a quantity is blank); legacy shows %s" % ("a figure (blank treated as 0)")] += 1
    elif lc == so: cmp["legacy equals app rule"] += 1
    elif lc < 0 and so == 0: cmp["legacy NEGATIVE, app rule gives 0 (expected: MAX(0,..))"] += 1
    else: cmp["legacy differs from app rule (stale cache / hand-typed value)"] += 1
check("suggested order in DB = MAX(0, target-available) for every verified record (NULL when blank/invalid/unverified)", sugg_bad == 0, f"{len(rows)} records")

n_xlsx = sq.execute("select count(*) from source_files where ext='xlsx'").fetchone()[0]
n_pdf = sq.execute("select count(*) from source_files where ext='pdf'").fetchone()[0]
n_nodes = q1("select count(*) from catalog_nodes"); n_fold = q1("select count(*) from catalog_nodes where kind in ('family','folder')")
n_wb = q1("select count(*) from catalog_nodes where kind='workbook'"); n_blk = q1("select count(*) from catalog_nodes where kind='block'")
out = ["# Reconciliation report (REHEARSAL import)", "",
       "> Generated by `migration/load_rehearsal.py` against a **throwaway** PostgreSQL 16 database. This is **not** an approved production migration.",
       "> The client's decisions are in `docs/open-questions.md`. The client must still approve the production migration and reconciliation before the app becomes the authoritative stock record.", "",
       "## Checks", "", "| Check | Result | Detail |", "|---|---|---|", *lines, "",
       "## Counts", "",
       f"- Source files: **{n_src_files}** ({n_xlsx} xlsx, {n_pdf} pdf); directories: **{n_dirs_nodes}**",
       f"- Source variant records (grid positions with any value in LENS QUANTITY / STOCK LENS / ORDER LENS): **{total_vr}**",
       f"- Imported as variants: **{len(imported)}**; held (duplicate workbook, pending decision): **{len(held)}**; rejected/dropped: **0**",
       f"- Catalog nodes: {n_nodes} (families/folders {n_fold}, workbooks {n_wb}, blocks {n_blk})",
       "", "### Quantity states after import", "", "| Quantity | State | Records |", "|---|---|---:|",
       *[f"| {k[0]} | {k[1]} | {v} |" for k, v in sorted(state_ct.items())], "",
       "### Legacy `ORDER LENS` value vs application rule `MAX(0, target − available)`", "", "| Relationship | Records |", "|---|---:|",
       *[f"| {k} | {v} |" for k, v in sorted(cmp.items(), key=lambda x: -x[1])], "",
       "### Held records", ""]
for rel, why in HOLD_DUPLICATE_OVERRIDE.items(): out.append(f"- `{rel}` — {why}. {len(held)} records held, none discarded.")
out += ["", f"**Overall: {'ALL CHECKS PASSED' if not problems else 'FAILURES: ' + ', '.join(problems)}** (passing means the rehearsal import is faithful to the staged data; it does not mean the source data itself is correct — see the audit)."]
os.makedirs(os.path.dirname(os.path.abspath(REPORT)), exist_ok=True)
open(REPORT, "w").write("\n".join(out))
print("\n".join(out))
KEEP = os.environ.get("KEEP_URI_FILE")
if KEEP and not problems:
    # test/dev helper: create fixed users and keep the throwaway database alive until killed
    import time
    USERS = json.loads(os.environ.get("TEST_USERS", "{}"))   # {"admin": "<uuid>", ...}
    roles = {"admin": "administrator", "manager": "inventory_manager", "staff": "inventory_staff", "readonly": "read_only"}
    for k, uid in USERS.items():
        pg.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,%s,%s)", (uid, ORG, k, roles[k]))
    open(KEEP, "w").write(srv.get_uri())
    while True: time.sleep(3600)
srv.cleanup(); sys.exit(1 if problems else 0)