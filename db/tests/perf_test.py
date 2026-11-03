#!/usr/bin/env python3
"""Scale test: 150k synthetic variants (throwaway DB, NOT client data). Times the app's real inventory/list/count/report queries."""
import glob, os, tempfile, time, uuid, pgserver, psycopg
H = os.path.dirname(os.path.abspath(__file__)); N = int(os.environ.get("N", 150000))
srv = pgserver.get_server(tempfile.mkdtemp()); c = psycopg.connect(srv.get_uri(), autocommit=True)
c.execute("create role authenticated nologin; create role anon nologin;")
for f in sorted(glob.glob(os.path.join(H, "..", "migrations", "*.sql"))): c.execute(open(f).read())
org = c.execute("insert into organizations(name) values ('perf') returning id").fetchone()[0]
fam = c.execute("insert into catalog_nodes(organization_id,kind,source_name) values (%s,'family','F') returning id", (org,)).fetchone()[0]
blocks = []
for i in range(300):
    wb = c.execute("insert into catalog_nodes(organization_id,parent_id,kind,source_name,source_path) values (%s,%s,'workbook',%s,%s) returning id", (org, fam, f"WB {i}", f"F/WB {i}")).fetchone()[0]
    blocks.append(c.execute("insert into catalog_nodes(organization_id,parent_id,kind,source_name,source_path,sort_order) values (%s,%s,'block',%s,%s,0) returning id", (org, wb, f"A1 | (+) SPH x ADD {i}", f"F/WB {i}#A1")).fetchone()[0])
t0 = time.time()
c.execute("""insert into lens_variants(organization_id,block_node_id,row_axis_name,col_axis_name,row_label_source,col_label_source,row_key,col_key,row_value,col_value,source_row,source_col)
  select %s,(%s::uuid[])[1 + (g %% 300)],'(+) SPH','ADD',to_char((g %% 97)*0.25-12,'FM+00.00'),to_char((g %% 9)*0.25,'FM0.00'),g::text,(g %% 9)::text,(g %% 97)*0.25-12,(g %% 9)*0.25,g/9,g%%9
  from generate_series(1,%s) g""", (org, blocks, N))
c.execute("""insert into stock_balances(organization_id,variant_id,target_quantity,target_state,available_quantity,available_state)
  select organization_id,id,10,'recorded',q,case when q is null then 'missing'::quantity_state else 'recorded'::quantity_state end from (select organization_id,id,case when random()<.5 then null else (random()*20)::int end q from lens_variants) x""")
c.execute("""insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after)
  select organization_id,variant_id,'opening_count',available_quantity,null,available_quantity from stock_balances where available_quantity is not null""")
c.execute("select refresh_variant_order(%s)", (org,)); c.execute("analyze"); print(f"loaded {N:,} variants + {c.execute('select count(*) from stock_movements').fetchone()[0]:,} movements in {time.time()-t0:.1f}s")
user = c.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,'u','inventory_manager') returning id", (str(uuid.uuid4()), org)).fetchone()[0]
c.execute("set role authenticated"); c.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(user),))
FROM = "from v_inventory i join lens_variants lv on lv.id=i.variant_id join catalog_nodes bn on bn.id=i.block_node_id join catalog_nodes wn on wn.id=bn.parent_id"
INNER = "select i.variant_id,i.block_node_id,i.row_label_source,i.col_label_source,i.row_occurrence,i.target_quantity,i.available_quantity,i.suggested_order,i.stock_status,wn.source_name as workbook,bn.source_name as block,lv.ord as s1"
ORD = "order by s1,variant_id"
OUTER = "order by p.s1,p.variant_id"
def PAGE(where, lim, pre="", selective=False):
    tail = "select p.*, node_path(p.block_node_id) as path, (select max(m.created_at) from stock_movements m where m.variant_id=p.variant_id) as last_movement"
    if selective:
        pre = (pre.rstrip().rstrip(",") + ", ") if pre else "with "
        return f"{pre}m as materialized ({INNER} {FROM} where {where}) {tail} from (select * from m {ORD} {lim}) p {OUTER}"
    return f"{pre}{tail} from ({INNER} {FROM} where {where} {ORD} {lim}) p {OUTER}"
Q = {
 "page 1, no filter": PAGE("i.is_active","limit 50 offset 0"),
 "page 500 (offset 25k)": PAGE("i.is_active","limit 50 offset 25000"),
 "count, no filter": f"select count(*) {FROM} where i.is_active",
 "status=stock_unknown page": PAGE("i.is_active and i.stock_status='stock_unknown'","limit 50"),
 "search '+0.25' page": PAGE("i.is_active and (i.row_label_source ilike '%+0.25%' or i.col_label_source ilike '%+0.25%' or wn.source_name ilike '%+0.25%' or bn.source_name ilike '%+0.25%')","limit 50",selective=True),
 "subtree of one workbook": PAGE("i.block_node_id in (select id from sub)","limit 50","with recursive sub as (select id from catalog_nodes where source_name='WB 7' union all select c.id from catalog_nodes c join sub on c.parent_id=sub.id) ",selective=True),
 "SPH range filter page": PAGE("i.is_active and lv.row_value between -2 and -1","limit 50",selective=True),
 "dashboard aggregate": "select count(*),sum(available_quantity),count(*) filter (where stock_status='below_target') from v_inventory where is_active",
 "report: not-recorded count": f"select count(*) from (select 1 {FROM} where i.available_state='missing') t",
 "movements page (latest 50)": "select m.id from stock_movements m order by m.created_at desc, m.id limit 50",
}
worst = 0
for name, sql in Q.items():
    ts = []
    for _ in range(3): t = time.time(); c.execute(sql).fetchall(); ts.append(time.time() - t)
    worst = max(worst, min(ts)); print(f"{name:32s} best of 3: {min(ts)*1000:8.1f} ms")
print(f"\nslowest query (best of 3): {worst*1000:.0f} ms at {N:,} variants")
srv.cleanup()
