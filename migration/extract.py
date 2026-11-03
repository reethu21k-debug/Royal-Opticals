#!/usr/bin/env python3
"""
Royal Opticals — source extraction into a STAGING database (SQLite).

Principles (see docs/source-data-audit.md):
  1. LOSSLESS FIRST: every non-empty cell of every sheet of every workbook is staged
     with file / sheet / coordinate / raw value / formula / cached value.
  2. INTERPRETATION SECOND: power-matrix "blocks" and per-variant records are derived
     from staged cells and never replace them.
  3. NOTHING IS "FIXED": blank != 0, source typos are preserved, errors (#REF!) are kept.
  4. Original files are opened read-only and never modified.

Usage:  python3 extract.py <Excel-root> <out.sqlite>
"""
import os, re, sys, json, hashlib, sqlite3
import openpyxl
from openpyxl.utils import get_column_letter

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/src/Excel"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/royal-opticals/migration/staging.sqlite"

NUM_RE = re.compile(r"^\s*[+-]?\d+(\.\d+)?\s*$")
COMP_RE = re.compile(r"^\s*([+-]?\d+(?:\.\d+)?)\s*([+-]\d+(?:\.\d+)?)\s*$")
AXIS_TXT_RE = re.compile(r"^\(?[+-]?\d*\)?\s*(CYL|SPH)\)?|COMP|ADD", re.I)
TRIAD = ("STOCK LENS", "ORDER LENS", "LENS QUANTITY")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_num(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    return isinstance(v, str) and bool(NUM_RE.match(v))


def to_num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str) and NUM_RE.match(v):
        return float(v.strip())
    return None


def norm_label(v):
    """Comparable key for an axis label. Does NOT alter the stored original."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return f"{float(v):.2f}"
    s = str(v).strip().replace(" ", "")
    m = COMP_RE.match(str(v))
    if m:
        return f"{float(m.group(1)):+.2f}|{float(m.group(2)):+.2f}"
    if NUM_RE.match(s):
        return f"{float(s):.2f}"
    return s


SCHEMA = """
CREATE TABLE source_files(
  id INTEGER PRIMARY KEY, rel_path TEXT UNIQUE, ext TEXT, size INTEGER, sha256 TEXT,
  family TEXT, level1 TEXT, level2 TEXT, level3 TEXT, folder_chain TEXT,
  role TEXT, duplicate_of TEXT, n_sheets INTEGER);
CREATE TABLE source_sheets(
  id INTEGER PRIMARY KEY, file_id INTEGER, sheet_name TEXT, sheet_index INTEGER, state TEXT,
  dims TEXT, merged TEXT, n_cells INTEGER, n_formulas INTEGER, n_errors INTEGER, layout TEXT);
CREATE TABLE staged_cells(
  sheet_id INTEGER, coord TEXT, row INTEGER, col INTEGER, vtype TEXT,
  raw_value TEXT, formula TEXT, cached_value TEXT);
CREATE TABLE blocks(
  id INTEGER PRIMARY KEY, sheet_id INTEGER, block_index INTEGER, header_row INTEGER,
  col_axis TEXT, row_axis TEXT, header_cell TEXT, label_col INTEGER, title_cell TEXT, title_text TEXT,
  n_rows INTEGER, n_cols INTEGER, layout TEXT, header_notes TEXT);
CREATE TABLE block_cells(
  block_id INTEGER, sheet_id INTEGER, coord TEXT, row_label_raw TEXT, col_label_raw TEXT,
  row_key TEXT, col_key TEXT, vtype TEXT, raw_value TEXT, formula TEXT, cached_value TEXT);
CREATE TABLE variant_records(
  id INTEGER PRIMARY KEY, file_id INTEGER, block_index INTEGER, layout TEXT,
  col_axis TEXT, row_axis TEXT, row_label_raw TEXT, col_label_raw TEXT, row_key TEXT, col_key TEXT, row_occurrence INTEGER,
  target_cell TEXT, target_raw TEXT, stock_cell TEXT, stock_raw TEXT, stock_vtype TEXT,
  order_cell TEXT, order_formula TEXT, order_cached TEXT,
  target_num REAL, stock_num REAL, order_cached_num REAL,
  excel_recompute REAL, app_rule REAL, app_rule_if_blank_is_zero REAL, flags TEXT);
CREATE TABLE anomalies(
  id INTEGER PRIMARY KEY, severity TEXT, code TEXT, file_rel TEXT, sheet TEXT, cell TEXT, detail TEXT);
"""


def folder_levels(rel):
    parts = rel.split("/")
    folders, fname = parts[:-1], parts[-1]
    return folders, fname


def classify_role(rel, sheetnames):
    names = [s.strip().upper() for s in sheetnames]
    if all(t in names for t in TRIAD):
        return "INVENTORY_TRIAD"
    up = rel.upper()
    fn = rel.split("/")[-1].upper()
    if "ORDER LENS" in fn or "ORDER SHEET" in fn or "ORDER LENS SHEET" in up.split("/")[-2]:
        return "ORDER_SNAPSHOT"
    if "STOCK LENS" in fn or "STCK LENS" in fn or "STOCK LENS SHEET" in up.split("/")[-2]:
        return "STOCK_TEMPLATE_OR_SNAPSHOT"
    return "UNCLASSIFIED"


def cell_vtype(v):
    if v is None:
        return "blank"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        if v.startswith("#"):
            return "error"
        return "numstr" if NUM_RE.match(v) else "text"
    return type(v).__name__


def parse_blocks(grid, max_row, max_col):
    """
    Detect blocks anywhere on the sheet (multi-panel safe).
    grid[(r,c)] = (formula_or_value, cached_value, raw_value)  (1-based)

    MATRIX block : header cell (r,c) holds an axis name (ADD, (-) CYL, (+180) CYL, ...) with >=3 numeric
                   column headers to its right (blank columns skipped, a text cell stops the scan).
                   Row r+1 col c holds the row-axis name ((+) SPH, COMP (+180), ...). Data rows follow at r+2.
    LIST block   : header cell (r,c) holds '(+/-) SPH|CYL' with <3 numeric cells to the right; label column = c,
                   quantity column = c+1; data rows follow at r+1.
    Each block runs until the next header in the same label column (or end of sheet).
    """
    def val(r, c):
        t = grid.get((r, c))
        return None if t is None else t[2]

    AX = re.compile(r"^\s*(ADD|\(\s*[+-]?\d*\s*\)\s*(CYL|SPH)|CYL\s*\(?[+-]\d+\)?|CYL[+-]\d+|\(\s*[+-]\s*\)\s*(CYL|SPH))\s*$", re.I)
    consumed = set()
    heads = []
    for r in range(1, max_row + 1):
        for c in range(1, max_col + 1):
            v = val(r, c)
            if (r, c) in consumed or not (isinstance(v, str) and AX.match(v)):
                continue
            nums = []
            for cc in range(c + 1, max_col + 1):
                x = val(r, cc)
                if x is None:
                    continue
                if is_num(x):
                    nums.append((cc, x))
                else:
                    break
            below = val(r + 1, c)
            below_is_axis = isinstance(below, str) and bool(re.search(r"(SPH|CYL|COMP)", below, re.I)) and not is_num(below)
            if len(nums) >= 3 or (len(nums) >= 1 and below_is_axis):
                heads.append(dict(kind="matrix", r=r, c=c, col_headers=nums))
                consumed.add((r + 1, c))
            elif re.search(r"\(\s*[+-]\s*\)\s*(SPH|CYL)", v, re.I):
                nxt = val(r + 1, c)
                if nxt is not None and is_num(nxt):
                    heads.append(dict(kind="list", r=r, c=c, col_headers=[]))
    def span(h):
        if h["kind"] == "matrix":
            return (h["c"], max(cc for cc, _ in h["col_headers"]))
        return (h["c"], h["c"] + 1)

    blocks = []
    for h in heads:
        r0, c = h["r"], h["c"]
        a0, a1 = span(h)
        # a block ends at the next header whose column span overlaps its own (prevents a list from
        # swallowing the header row of a neighbouring matrix, and vice versa)
        later = [x["r"] for x in heads if x is not h and x["r"] > r0 and span(x)[0] <= a1 and span(x)[1] >= a0]
        end = (min(later) - 1) if later else max_row
        if h["kind"] == "matrix":
            row_axis = val(r0 + 1, c)
            title_cell = title_text = None
            for cc in range(c + 1, max_col + 1):
                x = val(r0 + 1, cc)
                if isinstance(x, str) and x.strip() and not is_num(x):
                    title_cell, title_text = f"{get_column_letter(cc)}{r0+1}", x
                    break
            data_cols = [cc for cc, _ in h["col_headers"]]
            notes = [f"{get_column_letter(cc)}{r0}" for cc in range(c + 1, max_col + 1)
                     if isinstance(val(r0, cc), str) and val(r0, cc).strip() and not is_num(val(r0, cc))
                     and not any(x["r"] == r0 and x["c"] == cc for x in heads)]
            rows = []
            for r in range(r0 + 2, end + 1):
                lab = val(r, c)
                has_data = any(grid.get((r, cc)) is not None for cc in data_cols)
                if lab is None and not has_data:
                    continue
                # a text cell in the label column that is itself an axis header (other panel layout) ends the block
                if isinstance(lab, str) and AX.match(lab):
                    continue
                rows.append((r, lab))
            blocks.append(dict(header_row=r0, header_cell=f"{get_column_letter(c)}{r0}", label_col=c, col_axis=str(val(r0, c)).strip(),
                               row_axis=(str(row_axis).strip() if row_axis is not None else None), title_cell=title_cell,
                               title_text=title_text, kind="matrix", col_headers=h["col_headers"], rows=rows, header_notes=notes))
        else:
            qcol = c + 1
            rows = []
            for r in range(r0 + 1, end + 1):
                lab = val(r, c)
                if lab is None and val(r, qcol) is None:
                    continue
                if isinstance(lab, str) and AX.match(lab):
                    continue
                rows.append((r, lab, qcol))
            blocks.append(dict(header_row=r0, header_cell=f"{get_column_letter(c)}{r0}", label_col=c, col_axis=None,
                               row_axis=str(val(r0, c)).strip(), title_cell=None, title_text=None, kind="list",
                               col_headers=[], rows=rows, qty_col=qcol, header_notes=[]))
    blocks.sort(key=lambda b: (b["label_col"], b["header_row"]))
    layout = "MATRIX" if any(b["kind"] == "matrix" for b in blocks) else ("LIST" if blocks else "NONE")
    if len(blocks) > 1 and len({b["label_col"] for b in blocks}) > 1:
        layout += "_MULTIPANEL"
    return layout, blocks


def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    db = sqlite3.connect(OUT)
    db.executescript(SCHEMA)
    files = []
    for dp, dn, fn in os.walk(ROOT):
        dn.sort()
        for f in sorted(fn):
            files.append(os.path.relpath(os.path.join(dp, f), ROOT))
    files.sort()

    by_hash = {}
    for rel in files:
        h = sha256(os.path.join(ROOT, rel))
        by_hash.setdefault(h, []).append(rel)

    file_ids = {}
    sheet_meta = {}
    for rel in files:
        p = os.path.join(ROOT, rel)
        ext = rel.rsplit(".", 1)[-1].lower()
        folders, fname = folder_levels(rel)
        h = sha256(p)
        dup = [x for x in by_hash[h] if x != rel]
        dup_of = sorted(by_hash[h])[0] if dup and sorted(by_hash[h])[0] != rel else None
        wb = None
        sheetnames = []
        if ext == "xlsx":
            wb = openpyxl.load_workbook(p, data_only=False)
            sheetnames = wb.sheetnames
        role = classify_role(rel, sheetnames) if ext == "xlsx" else "PDF_REFERENCE"
        lv = folders + [None] * 3
        cur = db.execute(
            "INSERT INTO source_files(rel_path,ext,size,sha256,family,level1,level2,level3,folder_chain,role,duplicate_of,n_sheets) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (rel, ext, os.path.getsize(p), h, folders[0] if folders else None, lv[1], lv[2], lv[3], " / ".join(folders), role, dup_of, len(sheetnames)))
        fid = cur.lastrowid
        file_ids[rel] = fid
        if ext != "xlsx":
            continue
        wv = openpyxl.load_workbook(p, data_only=True)
        for si, ws in enumerate(wb.worksheets):
            wsv = wv[ws.title]
            grid = {}
            nform = nerr = 0
            ncell = 0
            for row in ws.iter_rows():
                for c in row:
                    if c.value is None:
                        continue
                    ncell += 1
                    cached = wsv[c.coordinate].value
                    is_f = isinstance(c.value, str) and c.value.startswith("=")
                    raw = cached if is_f else c.value
                    if is_f:
                        nform += 1
                    vt = cell_vtype(raw if raw is not None else c.value)
                    if is_f and raw is None:
                        vt = "formula_nocache"
                    if vt == "error" or (isinstance(cached, str) and str(cached).startswith("#")):
                        nerr += 1
                        db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('HIGH','FORMULA_ERROR_VALUE',?,?,?,?)",
                                   (rel, ws.title, c.coordinate, f"formula={c.value!r} cached={cached!r}"))
                    grid[(c.row, c.column)] = (c.value, cached, raw)
                    db.execute("INSERT INTO staged_cells VALUES(?,?,?,?,?,?,?,?)", (None, c.coordinate, c.row, c.column, vt,
                               None if raw is None else str(raw), c.value if is_f else None, None if cached is None else str(cached)))
            # attach sheet id after insert
            layout, blocks = parse_blocks(grid, ws.max_row, ws.max_column)
            cur = db.execute("INSERT INTO source_sheets(file_id,sheet_name,sheet_index,state,dims,merged,n_cells,n_formulas,n_errors,layout) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (fid, ws.title, si, ws.sheet_state, ws.dimensions, json.dumps([str(m) for m in ws.merged_cells.ranges]), ncell, nform, nerr, layout))
            sid = cur.lastrowid
            db.execute("UPDATE staged_cells SET sheet_id=? WHERE sheet_id IS NULL", (sid,))
            sheet_meta[(fid, ws.title)] = (sid, grid, blocks, layout, ws)
            # persist blocks
            for bi, b in enumerate(blocks):
                cur = db.execute("INSERT INTO blocks(sheet_id,block_index,header_row,col_axis,row_axis,header_cell,label_col,title_cell,title_text,n_rows,n_cols,layout,header_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                 (sid, bi, b["header_row"], b["col_axis"], b["row_axis"], b["header_cell"], b["label_col"], b["title_cell"], b["title_text"], len(b["rows"]), len(b["col_headers"]), b["kind"], json.dumps(b.get("header_notes", []))))
                b["id"] = cur.lastrowid
                if b["kind"] == "matrix":
                    for (r, lab) in b["rows"]:
                        for (c, hv) in b["col_headers"]:
                            t = grid.get((r, c))
                            if t is None:
                                # blank cell inside a matrix: keep as explicit blank record
                                db.execute("INSERT INTO block_cells VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                           (b["id"], sid, f"{get_column_letter(c)}{r}", None if lab is None else str(lab), str(hv), norm_label(lab), norm_label(hv), "blank", None, None, None))
                                continue
                            f_, cached, raw = t
                            isf = isinstance(f_, str) and f_.startswith("=")
                            db.execute("INSERT INTO block_cells VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                       (b["id"], sid, f"{get_column_letter(c)}{r}", None if lab is None else str(lab), str(hv), norm_label(lab), norm_label(hv),
                                        cell_vtype(raw if raw is not None else f_), None if raw is None else str(raw), f_ if isf else None, None if cached is None else str(cached)))
                else:
                    for (r, lab, qc) in b["rows"]:
                        t = grid.get((r, qc))
                        f_, cached, raw = (t if t else (None, None, None))
                        isf = isinstance(f_, str) and f_.startswith("=")
                        db.execute("INSERT INTO block_cells VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                   (b["id"], sid, f"{get_column_letter(qc)}{r}", None if lab is None else str(lab), None, norm_label(lab), None,
                                    cell_vtype(raw if raw is not None else f_), None if raw is None else str(raw), f_ if isf else None, None if cached is None else str(cached)))

    # ---------- build variant records for INVENTORY_TRIAD workbooks ----------
    for rel, fid in file_ids.items():
        role = db.execute("SELECT role FROM source_files WHERE id=?", (fid,)).fetchone()[0]
        if role != "INVENTORY_TRIAD":
            continue
        by = {}
        for (f2, name), meta in sheet_meta.items():
            if f2 == fid:
                by[name.strip().upper()] = meta
        qty_sid, qgrid, qblocks, qlayout, _ = by["LENS QUANTITY"]
        stk_sid, sgrid, sblocks, slayout, _ = by["STOCK LENS"]
        ord_sid, ogrid, oblocks, olayout, _ = by["ORDER LENS"]
        if not (len(qblocks) == len(sblocks) == len(oblocks)):
            db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('HIGH','TRIAD_BLOCK_COUNT_MISMATCH',?,?,?,?)",
                       (rel, None, None, f"LENS QUANTITY={len(qblocks)} STOCK LENS={len(sblocks)} ORDER LENS={len(oblocks)} blocks"))
        for bi, qb in enumerate(qblocks):
            sb = sblocks[bi] if bi < len(sblocks) else None
            ob = oblocks[bi] if bi < len(oblocks) else None

            def idx(b, grid):
                d = {}
                if not b:
                    return d
                if b["kind"] == "matrix":
                    colmap = [(c, norm_label(hv)) for c, hv in b["col_headers"]]
                    occ = {}
                    for (r, lab) in b["rows"]:
                        lk = norm_label(lab)
                        n_ = occ.get(lk, 0); occ[lk] = n_ + 1
                        for c, ck in colmap:
                            d[(lk, n_, ck)] = (r, c, grid.get((r, c)), lab, dict(b["col_headers"])[c])
                else:
                    occ = {}
                    for (r, lab, qc) in b["rows"]:
                        lk = norm_label(lab)
                        n_ = occ.get(lk, 0); occ[lk] = n_ + 1
                        d[(lk, n_, None)] = (r, qc, grid.get((r, qc)), lab, None)
                return d

            qi, si_, oi = idx(qb, qgrid), idx(sb, sgrid), idx(ob, ogrid)
            all_keys = list(qi.keys()) + [k for k in list(si_.keys()) + list(oi.keys()) if k not in qi]
            seen_keys = set()
            for k in all_keys:
                if k in seen_keys:
                    continue
                seen_keys.add(k)
                q = qi.get(k)
                s = si_.get(k)
                o = oi.get(k)
                base = q or s or o
                r, c, t, lab, hv = (q if q else (None, None, None, base[3], base[4]))
                coord = f"{get_column_letter(c)}{r}" if q else None
                flags = []
                if k[1] > 0:
                    flags.append("DUPLICATE_ROW_LABEL_IN_BLOCK")
                elif any(kk[0] == k[0] and kk[2] == k[2] and kk[1] > 0 for kk in qi):
                    flags.append("DUPLICATE_ROW_LABEL_IN_BLOCK")
                if q is None:
                    flags.append("TARGET_POSITION_ABSENT")
                if s is None:
                    flags.append("NO_MATCHING_STOCK_CELL")
                if o is None:
                    flags.append("NO_MATCHING_ORDER_CELL")
                tgt_raw = None if t is None else t[2]
                stk_t = s[2] if s else None
                stk_raw = None if stk_t is None else stk_t[2]
                ord_t = o[2] if o else None
                ord_f = ord_cached = None
                if ord_t is not None:
                    ord_f = ord_t[0] if (isinstance(ord_t[0], str) and ord_t[0].startswith("=")) else None
                    ord_cached = ord_t[1] if ord_f else ord_t[2]
                tn, sn = to_num(tgt_raw), to_num(stk_raw)
                on = to_num(ord_cached)
                if t is None and stk_t is None and ord_t is None:
                    continue  # nothing recorded at all in any of the 3 sheets for this position
                if t is None:
                    flags.append("TARGET_BLANK")
                elif tn is None:
                    flags.append("TARGET_NOT_NUMERIC")
                if stk_t is None:
                    flags.append("STOCK_BLANK")
                elif sn is None:
                    flags.append("STOCK_NOT_NUMERIC")
                if tn is not None and tn < 0:
                    flags.append("TARGET_NEGATIVE")
                if sn is not None and sn < 0:
                    flags.append("STOCK_NEGATIVE")
                if ord_t is None:
                    flags.append("ORDER_CELL_BLANK")
                elif ord_f is None:
                    flags.append("ORDER_NOT_A_FORMULA")
                if isinstance(ord_cached, str) and ord_cached.startswith("#"):
                    flags.append("ORDER_ERROR_VALUE")
                excel_re = (tn - (sn if sn is not None else 0.0)) if tn is not None else None
                app = max(0.0, tn - sn) if (tn is not None and sn is not None) else None
                app_b0 = max(0.0, tn - (sn if sn is not None else 0.0)) if tn is not None else None
                if on is not None and excel_re is not None and abs(on - excel_re) > 1e-9:
                    flags.append("ORDER_CACHED_DIFFERS_FROM_TARGET_MINUS_STOCK")
                if on is not None and on < 0:
                    flags.append("ORDER_NEGATIVE_IN_SOURCE")
                if tn is not None and sn is not None and tn == sn:
                    flags.append("STOCK_EQUALS_TARGET")
                db.execute("""INSERT INTO variant_records(file_id,block_index,layout,col_axis,row_axis,row_label_raw,col_label_raw,row_key,col_key,row_occurrence,
                    target_cell,target_raw,stock_cell,stock_raw,stock_vtype,order_cell,order_formula,order_cached,target_num,stock_num,order_cached_num,
                    excel_recompute,app_rule,app_rule_if_blank_is_zero,flags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                           (fid, bi, qb["kind"], qb["col_axis"], qb["row_axis"], None if lab is None else str(lab), None if hv is None else str(hv), k[0], k[2], k[1],
                            coord, None if tgt_raw is None else str(tgt_raw),
                            f"{get_column_letter(s[1])}{s[0]}" if s else None, None if stk_raw is None else str(stk_raw), cell_vtype(stk_raw),
                            f"{get_column_letter(o[1])}{o[0]}" if o else None, ord_f, None if ord_cached is None else str(ord_cached),
                            tn, sn, on, excel_re, app, app_b0, ",".join(flags)))
            # positions present in STOCK or ORDER sheets but absent from LENS QUANTITY
            for nm, ix in (("STOCK LENS", si_), ("ORDER LENS", oi)):
                for k, (r, c, t, lab, hv) in ix.items():
                    if k not in qi and t is not None:
                        db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('MEDIUM','VALUE_WITHOUT_TARGET_POSITION',?,?,?,?)",
                                   (rel, nm, f"{get_column_letter(c)}{r}", f"block {bi} label={lab!r} col={hv!r} value={t[2]!r}: position absent from LENS QUANTITY sheet"))
    for rel, bi_, lab, occn in db.execute("select f.rel_path,v.block_index,v.row_label_raw,count(distinct v.target_cell) from variant_records v join source_files f on f.id=v.file_id where v.row_occurrence>0 group by 1,2,3"):
        db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('MEDIUM','DUPLICATE_ROW_LABEL_IN_BLOCK',?,?,?,?)",
                   (rel, None, None, f"block {bi_}: row label {lab!r} occurs more than once in the same grid (kept as separate positions; one may be a typo)"))
    # sheet title text vs sheet purpose (STOCK LENS / ORDER LENS / LENS QUANTITY) in triad workbooks
    for sid, rel, sh, ttl, tcell in db.execute("""select s.id,f.rel_path,s.sheet_name,b.title_text,b.title_cell from blocks b
            join source_sheets s on s.id=b.sheet_id join source_files f on f.id=s.file_id
            where f.role='INVENTORY_TRIAD' and b.title_text is not null"""):
        if re.sub(r"\s+", " ", ttl.strip().upper()) != re.sub(r"\s+", " ", sh.strip().upper()):
            db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('MEDIUM','SHEET_TITLE_MISMATCH',?,?,?,?)",
                       (rel, sh, tcell, f"sheet is named {sh!r} but its title cell says {ttl!r}"))
    for sid, rel, sh, notes in db.execute("""select s.id,f.rel_path,s.sheet_name,b.header_notes from blocks b
            join source_sheets s on s.id=b.sheet_id join source_files f on f.id=s.file_id where f.role='INVENTORY_TRIAD' and b.header_notes!='[]'"""):
        for n in json.loads(notes):
            cell_txt = db.execute("select raw_value from staged_cells where sheet_id=? and coord=?", (sid, n)).fetchone()[0]
            if re.sub(r"\s+", " ", cell_txt.strip().upper()) != re.sub(r"\s+", " ", sh.strip().upper()):
                db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES('MEDIUM','SHEET_TITLE_MISMATCH',?,?,?,?)",
                           (rel, sh, n, f"sheet is named {sh!r} but header note says {cell_txt!r}"))
    db.commit()
    print("staged:", {t: db.execute(f"select count(*) from {t}").fetchone()[0] for t in
                      ("source_files", "source_sheets", "staged_cells", "blocks", "block_cells", "variant_records", "anomalies")})


if __name__ == "__main__":
    main()
