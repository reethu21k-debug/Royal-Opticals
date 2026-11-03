#!/usr/bin/env python3
"""
Reconcile the 43 PDFs and the ORDER/STOCK 'sheet' workbooks against the live inventory workbooks (REPORT ONLY — nothing is imported).

Method (name-independent): for each PDF / snapshot sheet take the multiset of positive whole numbers it shows (order quantities are the only
integers; headers and labels carry signs/decimals) and compare it with the multiset of positive legacy ORDER LENS values of every inventory workbook
in the same product folder. Similarity = |intersection| / max(|A|,|B|). The best match is reported with its similarity; below 0.5 it is 'unmatched'.
"""
import os, re, sqlite3, subprocess, collections, csv, sys
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.environ.get("SRC_ROOT", "/home/claude/src/Excel")
db = sqlite3.connect(os.path.join(H, "staging.sqlite")); db.row_factory = sqlite3.Row
def sim(a, b):
    if not a and not b: return None
    inter = sum((a & b).values()); return inter / max(sum(a.values()), sum(b.values()))
inv = {}
for f in db.execute("select id,rel_path,family,level1 from source_files where role='INVENTORY_TRIAD'"):
    live = collections.Counter(); app = collections.Counter()
    for r in db.execute("select order_cached_num,app_rule_if_blank_is_zero from variant_records where file_id=?", (f["id"],)):
        if r[0] is not None and r[0] > 0 and float(r[0]).is_integer(): live[int(r[0])] += 1
        if r[1] is not None and r[1] > 0: app[int(r[1])] += 1
    inv[f["rel_path"]] = dict(f=f, live=live, app=app)
def norm(x):
    x = os.path.splitext(os.path.basename(x))[0].upper().replace("ORDER LENS", "").replace("ORDERLENS", "")
    return re.sub(r"[^A-Z0-9+\-.']", "", x)
def best(level_key, ctr, name):
    """returns (similarity, workbook, basis). basis 'name' = a same-folder workbook with the same normalised name exists (strong);
    'content' = best quantity-multiset match only (WEAK: small integers overlap between any two grids)."""
    same = [(p, v) for p, v in inv.items() if (v["f"]["family"], v["f"]["level1"]) == level_key]
    n = norm(name)
    named = [(p, v) for p, v in same if n and (norm(p) == n or (len(norm(p)) > 6 and (norm(p) in n or n in norm(p))))]
    if named:
        p, v = max(named, key=lambda pv: len(norm(pv[0])))
        return sim(ctr, v["live"]), p, "name"
    c = [(sim(ctr, v["live"]), p) for p, v in same if sum(v["live"].values())]
    c = [x for x in c if x[0] is not None]
    return (*max(c), "content") if c else (None, None, "none")
rows = []
# ---- PDFs
for f in db.execute("select rel_path,family,level1 from source_files where ext='pdf' order by rel_path"):
    txt = subprocess.run(["pdftotext", "-layout", os.path.join(ROOT, f["rel_path"]), "-"], capture_output=True, text=True).stdout
    toks = collections.Counter(int(t) for t in re.findall(r"(?<![\d.+\-])\d{1,5}(?![\d.])", txt) if int(t) > 0)
    kind = "stock-count printout" if "STOCK" in f["rel_path"].upper().split("/")[-1] or "STOCK LENS PDF" in f["rel_path"].upper() else "order printout"
    s, p, basis = best((f["family"], f["level1"]), toks, f["rel_path"])
    rows.append(("PDF", f["rel_path"], kind, sum(toks.values()), p, s, basis))
# ---- snapshot sheets
for f in db.execute("select id,rel_path,family,level1,role from source_files where role in ('ORDER_SNAPSHOT','STOCK_TEMPLATE_OR_SNAPSHOT') order by rel_path"):
    for sh in db.execute("select id,sheet_name from source_sheets where file_id=? order by sheet_index", (f["id"],)):
        ctr = collections.Counter()
        for (raw, vt) in db.execute("select raw_value,vtype from block_cells where sheet_id=? and vtype in ('int','float','numstr')", (sh["id"],)):
            try: x = float(raw)
            except: continue
            if x > 0 and x.is_integer() and vt != 'numstr': ctr[int(x)] += 1
        s, p, basis = best((f["family"], f["level1"]), ctr, sh["sheet_name"])
        rows.append(("SHEET", f"{f['rel_path']} :: {sh['sheet_name']}", "order snapshot" if f["role"] == "ORDER_SNAPSHOT" else "stock sheet", sum(ctr.values()), p, s, basis))
with open(os.path.join(H, "..", "docs", "registers", "snapshot_reconciliation.csv"), "w", newline="") as fh:
    w = csv.writer(fh); w.writerow(["type", "source", "kind", "positive_integers", "best_matching_inventory_workbook", "similarity", "match_basis"]); [w.writerow(r) for r in rows]
def bucket(r):
    if r[3] == 0: return "blank (no quantities — an empty template/printout)"
    if r[5] is None: return "no comparable inventory order values"
    lab = "matches ≥ 90%" if r[5] >= .9 else "partial match 50–90%" if r[5] >= .5 else "differs (< 50%)"
    return lab if r[6] == "name" else "content-only guess (weak evidence): " + lab
cnt = collections.Counter((r[0], r[6] if r[3] else "-", bucket(r)) for r in rows)
out = ["# Snapshot & PDF reconciliation (report only — nothing imported)", "",
 "Compares every PDF and every `ORDER LENS SHEET` / `STOCK LENS SHEET` worksheet with the live inventory workbooks of the same product folder, by the multiset of positive whole numbers shown (order quantities). See `migration/reconcile_snapshots.py`.", "",
 "| Source type | Name-matched? | Result | Count |", "|---|---|---|---:|", *[f"| {k[0]} | {k[1]} | {k[2]} | {v} |" for k, v in sorted(cnt.items())], "",
 "**Interpretation limits:** a high similarity **for a name-matched pair** means the printout/snapshot shows the same order quantities as the live workbook (consistent with being a print/copy of it); a low similarity means it differs (older/newer data, hand edits, or a different grid) and the client must say which is authoritative (Q-SNAP-1). Similarity is by quantity multiset, not cell-by-cell, so it does not prove position-level equality. None of this data has been imported as stock.", "",
 "Full per-file results: `docs/registers/snapshot_reconciliation.csv`."]
open(os.path.join(H, "..", "docs", "snapshot-reconciliation.md"), "w").write("\n".join(out))
print("\n".join(out[3:10])); print(len(rows), "sources compared")
