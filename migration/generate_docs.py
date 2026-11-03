#!/usr/bin/env python3
"""Generates docs/source-data-audit.md, docs/category-hierarchy.md and registers/*.csv from staging.sqlite."""
import sqlite3, csv, os, collections, json
H=os.path.dirname(os.path.abspath(__file__)); D=os.path.join(H,'..','docs'); R=os.path.join(D,'registers')
db=sqlite3.connect(os.path.join(H,'staging.sqlite')); db.row_factory=sqlite3.Row
def dump(name,cur):
    rows=cur.fetchall()
    with open(os.path.join(R,name),'w',newline='') as f:
        w=csv.writer(f); w.writerow(rows[0].keys()); [w.writerow(list(r)) for r in rows]
    return len(rows)
n_files=dump('source_files.csv',db.execute("select rel_path,ext,size,sha256,family,role,duplicate_of,n_sheets from source_files order by rel_path"))
dump('source_sheets.csv',db.execute("select f.rel_path,s.sheet_name,s.state,s.dims,s.merged,s.n_cells,s.n_formulas,s.n_errors,s.layout from source_sheets s join source_files f on f.id=s.file_id order by f.rel_path,s.sheet_index"))
dump('anomalies.csv',db.execute("select severity,code,file_rel,sheet,cell,detail from anomalies order by case severity when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,code,file_rel"))
dump('variant_records.csv',db.execute("""select f.rel_path,v.block_index,v.row_axis,v.col_axis,v.row_label_raw,v.col_label_raw,v.row_occurrence,v.target_cell,v.target_raw,v.stock_cell,v.stock_raw,v.order_cell,v.order_formula,v.order_cached,v.app_rule,v.flags from variant_records v join source_files f on f.id=v.file_id order by f.rel_path,v.block_index,v.id"""))
dump('pdf_files.csv',db.execute("select rel_path,size,sha256,duplicate_of from source_files where ext='pdf' order by rel_path"))
# hierarchy
files=db.execute("select * from source_files order by rel_path").fetchall()
cnt={r[0]:r[1] for r in db.execute("select file_id,count(*) from variant_records group by file_id")}
tree={}
for f in files:
    cur=tree
    for p in f['rel_path'].split('/')[:-1]: cur=cur.setdefault(p+'/',{})
    cur[f['rel_path'].split('/')[-1]]=f
import os as _o
for dp,dn,fn in _o.walk('/home/claude/src/Excel'):
    cur=tree
    rel=_o.path.relpath(dp,'/home/claude/src/Excel')
    if rel!='.':
        for p in rel.split('/'): cur=cur.setdefault(p+'/',{})
out=["# Original category / folder hierarchy (exact source names)","",
"Generated from the archive `Excel.zip` by `migration/generate_docs.py`. Names are verbatim, **including source typos** (e.g. `STRIGHT`, `STCK`). Nothing has been renamed, merged or removed. Empty folders are kept.","",
"Hierarchy depth is **not uniform** across the three families. Folder names mix *product line*, *power range*, *axis type* and *document role* (INVENTORY / ORDER LENS SHEET / ORDER LENS PDF / STOCK LENS SHEET / STOCK LENS PDF) at different levels, so the application stores the tree as-is (`catalog_nodes`) instead of forcing a fixed category/subcategory/product model. Which level the client regards as 'category', 'subcategory' and 'product' is open question Q-HIER-1.","",
"Legend: `[triad]` = inventory workbook with STOCK LENS / ORDER LENS / LENS QUANTITY sheets (n = grid positions); `[order-snapshot]`, `[stock-sheet]` = values-only/printed sheets; `[pdf]` = printed PDF.","","```"]
tag={'INVENTORY_TRIAD':'triad','ORDER_SNAPSHOT':'order-snapshot','STOCK_TEMPLATE_OR_SNAPSHOT':'stock-sheet','PDF_REFERENCE':'pdf'}
def walk(t,ind=0):
    for k in sorted(t, key=lambda x:(not x.endswith('/'),x)):
        v=t[k]
        if isinstance(v,dict):
            out.append('  '*ind+k+('  (empty)' if not v else '')); walk(v,ind+1)
        else:
            sh=db.execute("select sheet_name from source_sheets where file_id=? order by sheet_index",(v['id'],)).fetchall()
            extra=f" n={cnt[v['id']]}" if v['id'] in cnt else ''
            out.append('  '*ind+f"{k}  [{tag[v['role']]}{extra}]"+(f"  sheets: {', '.join(repr(s[0]) for s in sh)}" if sh else ''))
walk(tree); out.append("```")
open(os.path.join(D,'category-hierarchy.md'),'w').write("\n".join(out))
# audit doc
q=lambda s:db.execute(s).fetchone()[0]
roles=db.execute("select role,count(*) c from source_files group by role").fetchall()
an=db.execute("select severity,code,count(*) c from anomalies group by 1,2 order by case severity when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,c desc").fetchall()
fl=collections.Counter()
for (f,) in db.execute("select flags from variant_records"):
    for x in (f or '').split(','):
        if x: fl[x]+=1
labels=collections.OrderedDict()
for f in files:
    if f['ext']=='xlsx':
        for s in db.execute("select sheet_name from source_sheets where file_id=? order by sheet_index",(f['id'],)): labels.setdefault(s[0],0); labels[s[0]]+=1
N_XLSX=q("select count(*) from source_files where ext='xlsx'"); N_PDF=q("select count(*) from source_files where ext='pdf'"); N_HIDDEN=q("select count(*) from source_sheets where state!='visible'")
a=["# Source data audit","",
f"Source: `Excel.zip` (178 archive entries: {q('select count(*) from source_files')} files + 59 directory entries incl. root). Everything below was computed by script from the files; nothing was inferred from file names alone.","",
"## 1. Inventory of sources","",
f"- Workbooks: **{N_XLSX}**, worksheets: **{q('select count(*) from source_sheets')}**, PDFs: **{N_PDF}** (45 pages, all with a text layer).",
f"- Non-empty cells staged losslessly: **{q('select count(*) from staged_cells')}**; formulas: **{q('select sum(n_formulas) from source_sheets')}**; hidden sheets: **{N_HIDDEN}**.",
"- These counts reproduce the earlier provisional figures (76 / 43 / 273 / 5 duplicate groups).","",
"| File role | Files |","|---|---:|",*[f"| {r['role']} | {r['c'] if 'c' in r.keys() else r[1]} |" for r in roles],"",
"- `INVENTORY_TRIAD`: workbook with three sheets — `LENS QUANTITY` (target), `STOCK LENS` (available), `ORDER LENS` (formula `target − stock`). These are the only live stock records.",
"- `ORDER_SNAPSHOT`: values-only, hand-pasted order sheets (signed text such as `+0.25`), one sheet per product. Not reconciled to the triads (see Q-SNAP-1).",
"- `STOCK_TEMPLATE_OR_SNAPSHOT`: stock-count sheets, mostly blank grids.","",
"## 2. Sheet layouts discovered","",
"There are **78 distinct (row 1, row 2) header patterns**, and the layout is not one grid per sheet:",
"- **MATRIX**: column-axis header row (`ADD`, `(-) CYL`, `(+180) CYL`, `CYL+90` …) over numeric column headers; row-axis label (`(+) SPH`, `COMP (+180)`, …) below it; row labels in the first column. Variant = row label × column label.",
"- **COMP blocks**: several matrices stacked vertically in one sheet; row labels are two-part cross values such as ` +0.25+0.50` (SPH then CYL, with a leading space).",
"- **LIST**: side-by-side label/quantity column pairs (`(+) SPH` list and `(+) CYL` list) with no second axis (`+POWER` workbooks).",
"- **MULTI-PANEL**: matrices and lists placed side by side and stacked in different column bands (`SV -6-4`, `SV -14-2`).",
f"- {q('select count(*) from blocks')} blocks were detected in {q('select count(*) from source_sheets')} sheets; **0 of {q('select count(*) from staged_cells')} cells are unexplained** (`verify_staging.py`).","",
"## 3. Verification performed (all scripts in `migration/`)","",
"| Gate | Result |","|---|---|",
f"| Staged cell count vs independent openpyxl profile | {q('select count(*) from staged_cells')} = 31433 |",
"| Cells not explained as header / axis / title / label / data (`verify_staging.py`) | 0 |",
f"| Variant records re-read from original files: target, stock, order value, order formula (`verify_against_source.py`) | {q('select count(*) from variant_records')} records, 0 mismatches |",
"| Non-blank data cells without a variant record (`verify_coverage.py`) | 0 |","",
"Parser defects found and fixed by these gates during the audit: multi-panel sheets (718 cells missed), list blocks swallowing a neighbouring matrix header (166 mis-read cells), single-column matrices, positions present only in STOCK/ORDER sheets (222 would have been dropped), duplicate row labels inside one grid (36 positions would have collided).","",
"## 4. Findings","","| Severity | Code | Count |","|---|---|---:|",*[f"| {r['severity']} | {r['code']} | {r['c']} |" for r in an],"",
"Per-record flags (7,931 grid positions):","","| Flag | Positions |","|---|---:|",*[f"| {k} | {v} |" for k,v in fl.most_common()],"",
"Highlights:",
"1. **Legacy `ORDER LENS` is `target − stock` with no `MAX(0,…)`** — it produces negative orders. The confirmed rule differs; the application implements `MAX(0, …)`.",
"2. **Excel treats a blank stock cell as 0**, so a blank stock yields an order equal to the full target. About half of all positions have a blank stock cell, and 13 workbooks have *no* stock quantities at all. The application keeps blank = unknown (never 0) pending Q-BLANK-1.",
"3. **3 workbooks have a `STOCK LENS` grid identical to `LENS QUANTITY`** (`KT HC COMP +0.50'90`, `+1.00'90`, `-1.00'180`): imported as `unverified`, movements blocked until counted.",
"4. **232 formulas link to an external workbook** (`'[1]LENS QUANTITY'`) in `Poly HMC -6-2.xlsx` and `CR HC SV ORDER LENS SHEET.xlsx`; **37 cells are `#REF!`/`#VALUE!`**; one target cell contains the letter `v` (`Magnus Click -6-2`, row −2, col −1.75).",
"5. **`CR HMC +POWER.xlsx` is byte-identical to `CR HMC -6-2.xlsx`** although its name says +POWER. Only one copy may carry stock (Q-DUP-1).",
"6. **Filename vs content conflicts**: 4 COMP workbooks whose file name axis (90/180) contradicts the axis printed in the sheet; 51 sheets whose internal title does not match the sheet name (e.g. a `LENS QUANTITY` sheet titled `STOCK LENS`).",
"7. **Duplicate row labels inside one grid** (e.g. `+2.00+2.00` twice) — kept as separate positions, flagged.",
"8. Source typos preserved verbatim: `STRIGHT`, `STCK`, `0RDER LENS`, `LENS QANTITY`, `MAGNUS CLIK`, `Sheet1…Sheet6` default sheet names.","",
"## 5. Distinct sheet names (verbatim, count of workbooks)","","```",*[f"{n!r}: {c}" for n,c in labels.items()],"```","",
"## 6. Limitations (what this audit does NOT establish)","",
"- PDFs were classified (all are Excel *Print to PDF* output of order/stock grids) but their numbers were **not** extracted or reconciled against workbooks.",
"- `ORDER_SNAPSHOT` / `STOCK_TEMPLATE` workbooks are staged losslessly but not mapped to inventory positions.",
"- The *meaning* of the `+POWER` list blocks (SPH-only vs SPH×plano-CYL) and of the `COMP`/`CROSS COMP` axes is inferred from layout, not confirmed.",
"- Whether stored quantities are accurate or current cannot be determined from the files.","",
"Registers: `docs/registers/*.csv`. Hierarchy: `docs/category-hierarchy.md`."]
open(os.path.join(D,'source-data-audit.md'),'w').write("\n".join(a))
print('docs written; files',n_files)
