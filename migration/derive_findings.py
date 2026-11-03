#!/usr/bin/env python3
"""Adds workbook-level findings to staging.sqlite `anomalies` (idempotent)."""
import sqlite3, re, sys, json
db=sqlite3.connect(sys.argv[1] if len(sys.argv)>1 else 'staging.sqlite')
db.execute("DELETE FROM anomalies WHERE code IN ('STOCK_SHEET_IDENTICAL_TO_TARGET','NO_STOCK_QUANTITIES_RECORDED','EXTERNAL_WORKBOOK_LINK','AXIS_ANGLE_CONFLICT','EXACT_DUPLICATE_FILE','STOCK_MOSTLY_BLANK')")
ins=lambda sev,code,rel,sheet,cell,d: db.execute("INSERT INTO anomalies(severity,code,file_rel,sheet,cell,detail) VALUES(?,?,?,?,?,?)",(sev,code,rel,sheet,cell,d))
for fid,rel in db.execute("select id,rel_path from source_files where role='INVENTORY_TRIAD'").fetchall():
    n,nt,ns,neq,blank=db.execute("""select count(*),sum(target_num is not null),sum(stock_num is not null),
        sum(stock_num is not null and target_num is not null and stock_num=target_num),sum(stock_num is null and target_num is not null) from variant_records where file_id=?""",(fid,)).fetchone()
    nt,ns,neq,blank=nt or 0,ns or 0,neq or 0,blank or 0
    if ns>=10 and neq==ns and ns>=0.95*nt:
        ins('HIGH','STOCK_SHEET_IDENTICAL_TO_TARGET',rel,'STOCK LENS',None,f"all {ns} numeric STOCK LENS cells equal LENS QUANTITY ({neq}/{ns}); likely a copy of the target grid, not a physical count")
    elif nt>0 and ns==0:
        ins('HIGH','NO_STOCK_QUANTITIES_RECORDED',rel,'STOCK LENS',None,f"{nt} target cells but 0 stock cells; legacy Excel would order the full target everywhere (blank treated as 0)")
    elif nt>0 and blank/nt>=0.5:
        ins('MEDIUM','STOCK_MOSTLY_BLANK',rel,'STOCK LENS',None,f"{blank}/{nt} target positions have a blank stock cell ({100*blank/nt:.0f}%)")
for rel,sheet,n in db.execute("""select f.rel_path,s.sheet_name,count(*) from staged_cells c join source_sheets s on s.id=c.sheet_id join source_files f on f.id=s.file_id where c.formula like '%[1]%' group by 1,2"""):
    ins('HIGH','EXTERNAL_WORKBOOK_LINK',rel,sheet,None,f"{n} formulas reference an external workbook '[1]' (cached values come from a file that is not in the archive)")
# axis angle: filename vs block row-axis names
for fid,rel in db.execute("select id,rel_path from source_files where ext='xlsx'").fetchall():
    fn=rel.split('/')[-1]
    m=re.search(r"'\s*(\d{2,3})\s*\.xlsx$",fn)
    if not m: continue
    angle=m.group(1)
    axes=[(r[0],r[1]) for r in db.execute("select s.sheet_name,b.row_axis from blocks b join source_sheets s on s.id=b.sheet_id where s.file_id=? and b.row_axis is not null",(fid,))]
    found={re.search(r"(\d{2,3})",a).group(1) for _,a in axes if re.search(r"(\d{2,3})",a)}
    if found and angle not in found:
        ins('MEDIUM','AXIS_ANGLE_CONFLICT',rel,None,None,f"filename says axis {angle} but sheet axis labels say {sorted(found)}")
for h,fs in db.execute("select sha256,group_concat(rel_path,' || ') from source_files group by sha256 having count(*)>1"):
    ins('INFO','EXACT_DUPLICATE_FILE',fs.split(' || ')[0],None,None,"byte-identical copies: "+fs)
db.commit()
for r in db.execute("select severity,code,count(*) from anomalies group by 1,2 order by 1,3 desc"): print(r)
