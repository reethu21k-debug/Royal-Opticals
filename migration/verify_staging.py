#!/usr/bin/env python3
"""Every staged cell must be explained by the block interpretation (header / axis / title / label / data)."""
import sqlite3, re, sys
from openpyxl.utils import get_column_letter, column_index_from_string
db=sqlite3.connect(sys.argv[1] if len(sys.argv)>1 else 'staging.sqlite')
cells={}
for sid,coord,vt,raw in db.execute("select sheet_id,coord,vtype,raw_value from staged_cells"):
    cells.setdefault(sid,{})[coord]=(vt,raw)
explained={sid:set() for sid in cells}
def split(coord):
    m=re.match(r'([A-Z]+)(\d+)',coord); return column_index_from_string(m.group(1)),int(m.group(2))
for sid,bidx,hr,hc,lc,tc,layout,nr,nc,hn in db.execute("select sheet_id,id,header_row,header_cell,label_col,title_cell,layout,n_rows,n_cols,header_notes from blocks"):
    ex=explained.setdefault(sid,set())
    ex.add(hc)
    ex.add(f"{get_column_letter(lc)}{hr+1}") if layout=='matrix' else None
    if tc: ex.add(tc)
    import json
    for n in json.loads(hn or '[]'): ex.add(n)
    for (coord,) in db.execute("select coord from block_cells where block_id=?",(bidx,)):
        ex.add(coord); c,r=split(coord)
        ex.add(f"{get_column_letter(lc)}{r}")        # row label
    if layout=='matrix':
        # column header cells: numeric cells on header row to the right of label col
        for coord,(vt,raw) in cells[sid].items():
            c,r=split(coord)
            if r==hr and c>lc and vt in('int','float','numstr'): ex.add(coord)
        # a list-block's qty cells are in block_cells; a list header cell covered by hc
unexp=[]
names={sid:(f,sh) for sid,f,sh in db.execute("select s.id,f.rel_path,s.sheet_name from source_sheets s join source_files f on f.id=s.file_id")}
for sid,cs in cells.items():
    for coord,(vt,raw) in cs.items():
        if coord not in explained.get(sid,set()):
            unexp.append((names[sid][0].split('/')[-1],names[sid][1],coord,vt,raw))
print('total staged cells:',sum(len(c) for c in cells.values()),' unexplained:',len(unexp))
from collections import Counter
print(Counter((u[0],u[1]) for u in unexp).most_common(20))
for u in unexp[:40]: print(u)
sys.exit(1 if unexp else 0)
