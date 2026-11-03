#!/usr/bin/env python3
"""No data cell may be orphaned: each non-blank block data cell of an INVENTORY_TRIAD workbook must be referenced by a variant_record."""
import sqlite3, sys, collections
db=sqlite3.connect(sys.argv[1] if len(sys.argv)>1 else 'staging.sqlite')
ref=collections.defaultdict(set)
for fid,tc,sc,oc in db.execute("select file_id,target_cell,stock_cell,order_cell from variant_records"):
    ref[(fid,'LENS QUANTITY')].add(tc); ref[(fid,'STOCK LENS')].add(sc); ref[(fid,'ORDER LENS')].add(oc)
orph=[]; total=0
for fid,sh,coord,vt in db.execute("""select f.id,upper(trim(s.sheet_name)),bc.coord,bc.vtype from block_cells bc join source_sheets s on s.id=bc.sheet_id
     join source_files f on f.id=s.file_id where f.role='INVENTORY_TRIAD' and bc.vtype!='blank'"""):
    total+=1
    if coord not in ref[(fid,sh)]: orph.append((fid,sh,coord))
print('non-blank data cells in inventory workbooks:',total,' orphaned (no variant record):',len(orph))
for o in orph[:10]: print(o)
sys.exit(1 if orph else 0)
