#!/usr/bin/env python3
"""Independent check: every variant_record's target/stock/order cells are re-read from the ORIGINAL xlsx and compared."""
import sqlite3, sys, os, openpyxl, collections
ROOT=sys.argv[1] if len(sys.argv)>1 else '/home/claude/src/Excel'
db=sqlite3.connect(sys.argv[2] if len(sys.argv)>2 else 'staging.sqlite')
cache={}
def wb(rel,dv):
    k=(rel,dv)
    if k not in cache: cache[k]=openpyxl.load_workbook(os.path.join(ROOT,rel),data_only=dv)
    return cache[k]
def sheet(w,name):  # triad sheet names may carry stray spaces
    for ws in w.worksheets:
        if ws.title.strip().upper()==name: return ws
bad=collections.Counter(); n=0; mism=[]
for rel,tc,tr,sc,sr,oc,ocached,of in db.execute("""select f.rel_path,v.target_cell,v.target_raw,v.stock_cell,v.stock_raw,v.order_cell,v.order_cached,v.order_formula
        from variant_records v join source_files f on f.id=v.file_id"""):
    w=wb(rel,True); wf=wb(rel,False)
    def get(name,coord,formula=False):
        if coord is None: return None
        ws=sheet(wf if formula else w,name); return ws[coord].value
    n+=1
    a=get('LENS QUANTITY',tc); 
    if (None if a is None else str(a))!=tr: bad['target']+=1; mism.append((rel,'T',tc,a,tr))
    b=get('STOCK LENS',sc)
    if (None if b is None else str(b))!=sr: bad['stock']+=1; mism.append((rel,'S',sc,b,sr))
    c=get('ORDER LENS',oc); 
    if (None if c is None else str(c))!=ocached: bad['order_cached']+=1; mism.append((rel,'O',oc,c,ocached))
    f=get('ORDER LENS',oc,True)
    isf=isinstance(f,str) and f.startswith('=')
    if (f if isf else None)!=of: bad['order_formula']+=1; mism.append((rel,'F',oc,f,of))
print('records re-checked against original files:',n,'mismatches:',dict(bad))
for m in mism[:10]: print(m)
sys.exit(1 if bad else 0)
