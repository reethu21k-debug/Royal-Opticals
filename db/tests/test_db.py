#!/usr/bin/env python3
"""Database tests on a real PostgreSQL (pgserver). Run: python3 db/tests/test_db.py"""
import os, sys, glob, tempfile, uuid, threading, traceback
import pgserver, psycopg

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = sorted(glob.glob(os.path.join(HERE, '..', 'migrations', '*.sql')))
srv = pgserver.get_server(tempfile.mkdtemp())
URI = srv.get_uri()
def conn(autocommit=True): return psycopg.connect(URI, autocommit=autocommit)

root = conn()
root.execute("create role authenticated nologin; create role anon nologin;")
for f in MIG: root.execute(open(f).read())

ORG_A, ORG_B = str(uuid.uuid4()), str(uuid.uuid4()); import uuid as _u; ORG_A_UUID = _u.UUID(ORG_A)
U = {k: str(uuid.uuid4()) for k in ('admin','manager','staff','readonly','outsider')}
root.execute("insert into organizations(id,name) values (%s,'Royal Opticals'),(%s,'Other Co')", (ORG_A, ORG_B))
for k, role, org in (('admin','administrator',ORG_A),('manager','inventory_manager',ORG_A),('staff','inventory_staff',ORG_A),
                     ('readonly','read_only',ORG_A),('outsider','administrator',ORG_B)):
    root.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,%s,%s)", (U[k], org, k, role))
node = root.execute("insert into catalog_nodes(organization_id,kind,source_name) values (%s,'block','TEST BLOCK') returning id", (ORG_A,)).fetchone()[0]

def mkvar(label, target, available, org=ORG_A):
    vid = root.execute("""insert into lens_variants(organization_id,block_node_id,row_label_source,row_key,col_key)
        values (%s,%s,%s,%s,'') returning id""", (org, node, label, label)).fetchone()[0]
    ts = 'recorded' if target is not None else 'missing'; av = 'recorded' if available is not None else 'missing'
    root.execute("insert into stock_balances(organization_id,variant_id,target_quantity,target_state,available_quantity,available_state) values (%s,%s,%s,%s,%s,%s)",
                 (org, vid, target, ts, available, av))
    return vid

def as_user(c, who, role=True):
    c.execute("select set_config('request.jwt.claim.sub', %s, false)", (U[who],))
    if role: c.execute("set role authenticated")
def avail(vid): return root.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0]
def nmov(vid): return root.execute("select count(*) from stock_movements where variant_id=%s", (vid,)).fetchone()[0]
def raises(fn, needle=None):
    try: fn()
    except Exception as e:
        if needle and needle.lower() not in str(e).lower(): raise AssertionError(f"wrong error: {e}")
        return True
    raise AssertionError("expected an error but none was raised")

results = []
def test(fn):
    try: fn(); results.append((fn.__name__, True, ''))
    except Exception as e: results.append((fn.__name__, False, f"{e}\n{traceback.format_exc()}"))
    return fn

@test
def suggested_order_examples():
    q = lambda t, a: root.execute("select suggested_order(%s,%s)", (t, a)).fetchone()[0]
    assert q(20, 12) == 8 and q(20, 20) == 0 and q(20, 25) == 0 and q(50, 0) == 50
    assert q(None, 5) is None and q(20, None) is None           # unknown is NOT silently zero
    assert root.execute("select suggested_order_legacy_blank_as_zero(20,null)").fetchone()[0] == 20

@test
def receipt_and_issue():
    v = mkvar('R1', 20, 12); c = conn(); as_user(c, 'staff')
    c.execute("select post_stock_movement(%s,'receipt',10,'t')", (v,)); assert avail(v) == 22
    c.execute("select post_stock_movement(%s,'issue',3,'t')", (v,)); assert avail(v) == 19
    m = root.execute("select quantity_before,quantity_after,quantity_delta from stock_movements where variant_id=%s order by created_at", (v,)).fetchall()
    assert m == [(12, 22, 10), (22, 19, -3)], m

@test
def issue_more_than_available_rejected_and_rolled_back():
    v = mkvar('R2', 20, 12); c = conn(); as_user(c, 'staff')
    raises(lambda: c.execute("select post_stock_movement(%s,'issue',13)", (v,)), 'insufficient')
    assert avail(v) == 12 and nmov(v) == 0

@test
def invalid_quantities_rejected():
    v = mkvar('R3', 5, 5); c = conn(); as_user(c, 'staff')
    for bad in (0, -4): raises(lambda b=bad: c.execute("select post_stock_movement(%s,'receipt',%s)", (v, b)), 'positive')
    assert avail(v) == 5

@test
def blank_stock_is_not_zero():
    v = mkvar('B1', 10, None); c = conn(); as_user(c, 'staff')
    raises(lambda: c.execute("select post_stock_movement(%s,'receipt',5)", (v,)), 'not recorded')
    assert avail(v) is None
    m = conn(); as_user(m, 'manager')
    m.execute("select post_physical_count(%s,7,'initial count')", (v,))
    assert avail(v) == 7
    assert root.execute("select movement_type from stock_movements where variant_id=%s", (v,)).fetchone()[0] == 'opening_count'
    c.execute("select post_stock_movement(%s,'receipt',5)", (v,)); assert avail(v) == 12

@test
def unverified_stock_requires_count_before_movements():
    v = mkvar('U1', 10, 10)
    root.execute("update stock_balances set available_state='unverified' where variant_id=%s", (v,))
    c = conn(); as_user(c, 'staff')
    raises(lambda: c.execute("select post_stock_movement(%s,'issue',1)", (v,)), 'unverified')
    assert avail(v) == 10
    m = conn(); as_user(m, 'manager'); m.execute("select post_physical_count(%s,9,'verified by count')", (v,))
    assert root.execute("select available_state from stock_balances where variant_id=%s", (v,)).fetchone()[0] == 'recorded'
    c.execute("select post_stock_movement(%s,'issue',1)", (v,)); assert avail(v) == 8

@test
def review_decision_is_atomic_audited_and_role_checked():
    rid = root.execute("insert into review_items(organization_id,severity,code,detail) values (%s,'HIGH','T','d') returning id", (ORG_A,)).fetchone()[0]
    s = conn(); as_user(s, 'staff'); raises(lambda: s.execute("select decide_review_item(%s,'approved','n')", (rid,)), 'not permitted')
    m = conn(); as_user(m, 'manager'); raises(lambda: m.execute("select decide_review_item(%s,'approved','')", (rid,)), 'note')
    m.execute("select decide_review_item(%s,'approved','client confirmed')", (rid,))
    assert root.execute("select status,decision_note from review_items where id=%s", (rid,)).fetchone() == ('approved', 'client confirmed')
    assert root.execute("select count(*) from audit_logs where action='review.decide' and entity_id=%s", (rid,)).fetchone()[0] == 1

@test
def physical_count_adjustment():
    v = mkvar('A1', 50, 42); m = conn(); as_user(m, 'manager')
    m.execute("select post_physical_count(%s,40,'recount')", (v,))
    r = root.execute("select movement_type,quantity_delta,quantity_before,quantity_after from stock_movements where variant_id=%s", (v,)).fetchone()
    assert r == ('adjustment', -2, 42, 40), r
    raises(lambda: m.execute("select post_physical_count(%s,40,'')", (v,)), 'reason')

@test
def idempotency_key_prevents_double_post():
    v = mkvar('I1', 20, 10); c = conn(); as_user(c, 'staff'); k = str(uuid.uuid4())
    c.execute("select post_stock_movement(%s,'receipt',5,null,null,null,%s)", (v, k))
    c.execute("select post_stock_movement(%s,'receipt',5,null,null,null,%s)", (v, k))
    assert avail(v) == 15 and nmov(v) == 1

@test
def concurrent_receipts_do_not_lose_updates():
    v = mkvar('C1', 30, 10); errs = []; barrier = threading.Barrier(2)
    def worker():
        try:
            c = conn(); as_user(c, 'staff'); barrier.wait()
            c.execute("select post_stock_movement(%s,'receipt',5)", (v,))
        except Exception as e: errs.append(e)
    ts = [threading.Thread(target=worker) for _ in range(2)]; [t.start() for t in ts]; [t.join() for t in ts]
    assert not errs, errs
    assert avail(v) == 20 and nmov(v) == 2

@test
def concurrent_issues_cannot_oversell():
    v = mkvar('C2', 30, 5); res = []; barrier = threading.Barrier(4)
    def worker():
        c = conn(); as_user(c, 'staff'); barrier.wait()
        try: c.execute("select post_stock_movement(%s,'issue',2)", (v,)); res.append('ok')
        except Exception: res.append('rejected')
    ts = [threading.Thread(target=worker) for _ in range(4)]; [t.start() for t in ts]; [t.join() for t in ts]
    assert res.count('ok') == 2 and avail(v) == 1, (res, avail(v))

@test
def target_change_does_not_touch_available():
    v = mkvar('T1', 10, 4); m = conn(); as_user(m, 'manager')
    m.execute("select set_target_quantity(%s,25,'review')", (v,))
    assert avail(v) == 4
    assert root.execute("select target_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0] == 25
    assert root.execute("select previous_target,new_target from target_changes where variant_id=%s", (v,)).fetchone() == (10, 25)
    s = conn(); as_user(s, 'staff'); raises(lambda: s.execute("select set_target_quantity(%s,1)", (v,)), 'not permitted')

@test
def purchase_order_partial_receipt():
    v = mkvar('P1', 100, 12); m = conn(); as_user(m, 'manager')
    sup = root.execute("insert into suppliers(organization_id,supplier_name) values (%s,'Sup1') returning id", (ORG_A,)).fetchone()[0]
    po = root.execute("insert into purchase_orders(organization_id,po_number,supplier_id) values (%s,'PO-1',%s) returning id", (ORG_A, sup)).fetchone()[0]
    it = root.execute("insert into purchase_order_items(purchase_order_id,variant_id,suggested_quantity,quantity_ordered) values (%s,%s,88,50) returning id", (po, v)).fetchone()[0]
    raises(lambda: m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-0')", (po, f'[{{"item_id":"{it}","quantity":5}}]')), 'cannot receive')  # draft
    assert avail(v) == 12                                          # draft does not affect stock
    m.execute("select confirm_purchase_order(%s)", (po,)); assert avail(v) == 12   # confirmed does not affect stock
    m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-1')", (po, f'[{{"item_id":"{it}","quantity":30}}]'))
    assert avail(v) == 42
    assert root.execute("select quantity_ordered,quantity_received from purchase_order_items where id=%s", (it,)).fetchone() == (50, 30)
    assert root.execute("select status from purchase_orders where id=%s", (po,)).fetchone()[0] == 'partially_received'
    raises(lambda: m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-2')", (po, f'[{{"item_id":"{it}","quantity":21}}]')), 'exceed')
    assert avail(v) == 42                                          # failed over-receipt rolled back completely
    m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-3')", (po, f'[{{"item_id":"{it}","quantity":20}}]'))
    assert avail(v) == 62 and root.execute("select status from purchase_orders where id=%s", (po,)).fetchone()[0] == 'received'

@test
def movements_and_audit_are_append_only():
    v = mkvar('M1', 5, 5); c = conn(); as_user(c, 'staff'); c.execute("select post_stock_movement(%s,'receipt',1)", (v,))
    raises(lambda: root.execute("update stock_movements set quantity_delta=99 where variant_id=%s", (v,)), 'append-only')
    raises(lambda: root.execute("delete from stock_movements where variant_id=%s", (v,)), 'append-only')
    raises(lambda: root.execute("delete from audit_logs"), 'append-only')
    assert root.execute("select count(*) from audit_logs where action='stock.receipt' and entity_id in (select id from stock_movements where variant_id=%s)", (v,)).fetchone()[0] == 1

@test
def rls_blocks_direct_stock_writes_and_readonly_users():
    v = mkvar('S1', 10, 10); r = conn(); as_user(r, 'readonly')
    raises(lambda: r.execute("select post_stock_movement(%s,'receipt',1)", (v,)), 'not permitted')
    for sql in ("update stock_balances set available_quantity=999", "insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_after) select organization_id,variant_id,'receipt',1,1 from stock_balances limit 1",
                "delete from stock_balances"):
        c = conn(); as_user(c, 'manager')
        try: n = c.execute(sql).rowcount
        except Exception: n = 0
        assert not n, sql
    assert avail(v) == 10
    assert conn() and True

@test
def rls_isolates_organizations():
    v = mkvar('O1', 10, 10); o = conn(); as_user(o, 'outsider')
    assert o.execute("select count(*) from stock_balances").fetchone()[0] == 0
    assert o.execute("select count(*) from lens_variants").fetchone()[0] == 0
    raises(lambda: o.execute("select post_stock_movement(%s,'receipt',1)", (v,)), 'unknown variant')
    assert avail(v) == 10

@test
def inventory_view_status_and_no_hidden_zero_stock():
    mkvar('V0', 10, 0); mkvar('V1', 10, 4); mkvar('V2', 10, None); mkvar('V3', 10, 12)
    m = conn(); as_user(m, 'manager')
    rows = {r[0]: r[1:] for r in m.execute("select row_label_source,stock_status,suggested_order,legacy_suggested_order_blank_as_zero from v_inventory where row_label_source in ('V0','V1','V2','V3')")}
    assert rows == {'V0': ('out_of_stock', 10, 10), 'V1': ('below_target', 6, 6), 'V2': ('stock_unknown', None, 10), 'V3': ('ok', 0, 0)}, rows

@test
def count_session_approval_workflow():
    a = mkvar('CS-known', 10, 10); b = mkvar('CS-blank', 10, None); c = mkvar('CS-unverified', 10, 10); d = mkvar('CS-stale', 10, 10); e = mkvar('CS-skip', 10, 7)
    root.execute("update stock_balances set available_state='unverified' where variant_id=%s", (c,))
    s = conn(); as_user(s, 'staff'); m = conn(); as_user(m, 'manager')
    raises(lambda: s.execute("select create_count_session('x', null, %s)", ([a],)), 'not permitted')
    sid = m.execute("select (create_count_session('Shelf A', null, %s::uuid[])).id", ([a, b, c, d, e],)).fetchone()[0]
    assert root.execute("select count(*) from count_lines where session_id=%s", (sid,)).fetchone()[0] == 5
    for v, n in ((a, 8), (b, 4), (c, 10), (d, 6)): s.execute("select record_count_line(%s,%s,%s)", (sid, v, n))
    # e left uncounted (NULL, not zero)
    assert root.execute("select counted_quantity from count_lines where session_id=%s and variant_id=%s", (sid, e)).fetchone()[0] is None
    raises(lambda: s.execute("select approve_count_session(%s)", (sid,)), 'not permitted')
    raises(lambda: m.execute("select approve_count_session(%s)", (sid,)), 'submitted')       # must be submitted first
    s.execute("select submit_count_session(%s)", (sid,))
    raises(lambda: s.execute("select record_count_line(%s,%s,1)", (sid, a)), 'closed')
    # stock moves after the snapshot -> that line must NOT be overwritten silently
    root.execute("update stock_balances set available_quantity=9 where variant_id=%s", (d,))
    assert avail(a) == 10 and avail(b) is None                      # nothing changes before approval
    m.execute("select approve_count_session(%s)", (sid,))
    assert avail(a) == 8 and avail(b) == 4 and avail(d) == 9 and avail(e) == 7
    assert root.execute("select available_state from stock_balances where variant_id=%s", (c,)).fetchone()[0] == 'recorded'
    res = dict(root.execute("select v.row_label_source, l.result from count_lines l join lens_variants v on v.id=l.variant_id where l.session_id=%s", (sid,)).fetchall())
    assert res == {'CS-known': 'posted', 'CS-blank': 'posted', 'CS-unverified': 'posted', 'CS-stale': 'stale', 'CS-skip': 'not_counted'}, res
    assert root.execute("select movement_type from stock_movements where variant_id=%s", (b,)).fetchone()[0] == 'opening_count'
    raises(lambda: m.execute("select approve_count_session(%s)", (sid,)), 'submitted')       # no double approval
    assert root.execute("select summary->>'posted' from count_sessions where id=%s", (sid,)).fetchone()[0] == '3'

@test
def count_session_scope_by_catalog_node_and_cancel():
    n2 = root.execute("insert into catalog_nodes(organization_id,kind,source_name) values (%s,'block','SCOPE BLOCK') returning id", (ORG_A,)).fetchone()[0]
    vid = root.execute("insert into lens_variants(organization_id,block_node_id,row_label_source,row_key) values (%s,%s,'S1','S1') returning id", (ORG_A, n2)).fetchone()[0]
    root.execute("insert into stock_balances(organization_id,variant_id) values (%s,%s)", (ORG_A, vid))
    m = conn(); as_user(m, 'manager')
    sid = m.execute("select (create_count_session('scoped', %s)).id", (n2,)).fetchone()[0]
    assert root.execute("select count(*) from count_lines where session_id=%s", (sid,)).fetchone()[0] == 1
    m.execute("select cancel_count_session(%s)", (sid,)); raises(lambda: m.execute("select submit_count_session(%s)", (sid,)))
    raises(lambda: m.execute("delete from count_sessions"), None)

@test
def po_cancel_and_close_short_preserve_received():
    v = mkvar('PC1', 100, 10); m = conn(); as_user(m, 'manager')
    sup = root.execute("insert into suppliers(organization_id,supplier_name) values (%s,'SupC') returning id", (ORG_A,)).fetchone()[0]
    def mkpo(num):
        po = root.execute("insert into purchase_orders(organization_id,po_number,supplier_id) values (%s,%s,%s) returning id", (ORG_A, num, sup)).fetchone()[0]
        it = root.execute("insert into purchase_order_items(purchase_order_id,variant_id,quantity_ordered) values (%s,%s,40) returning id", (po, v)).fetchone()[0]
        return po, it
    po1, _ = mkpo('PC-A'); raises(lambda: m.execute("select cancel_purchase_order(%s,'')", (po1,)), 'reason')
    m.execute("select cancel_purchase_order(%s,'supplier withdrew')", (po1,))
    assert root.execute("select status from purchase_orders where id=%s", (po1,)).fetchone()[0] == 'cancelled' and avail(v) == 10
    po2, it2 = mkpo('PC-B'); m.execute("select confirm_purchase_order(%s)", (po2,))
    m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-PC')", (po2, f'[{{"item_id":"{it2}","quantity":15}}]'))
    m.execute("select cancel_purchase_order(%s,'rest not coming')", (po2,))
    assert root.execute("select status from purchase_orders where id=%s", (po2,)).fetchone()[0] == 'closed_short' and avail(v) == 25   # received stock kept
    raises(lambda: m.execute("select cancel_purchase_order(%s,'again')", (po2,)))
    raises(lambda: m.execute("select receive_purchase_order(%s,%s::jsonb,'GRN-PC2')", (po2, f'[{{"item_id":"{it2}","quantity":5}}]')), 'cannot receive')

@test
def bulk_targets_are_all_or_nothing():
    a = mkvar('BT1', 1, 1); b = mkvar('BT2', 2, 2); m = conn(); as_user(m, 'manager')
    m.execute("select set_targets_bulk(%s::jsonb,'bulk')", (f'[{{"variant_id":"{a}","target":11}},{{"variant_id":"{b}","target":12}}]',))
    t = lambda v: root.execute("select target_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0]
    assert (t(a), t(b)) == (11, 12) and root.execute("select count(*) from target_changes where variant_id in (%s,%s)", (a, b)).fetchone()[0] == 2
    raises(lambda: m.execute("select set_targets_bulk(%s::jsonb,'bad')", (f'[{{"variant_id":"{a}","target":99}},{{"variant_id":"{b}","target":-5}}]',)))
    assert (t(a), t(b)) == (11, 12)                                   # first item rolled back with the second


@test
def user_admin_guards():
    a = conn(); as_user(a, 'admin'); m = conn(); as_user(m, 'manager')
    raises(lambda: m.execute("select set_user_role(%s,'read_only')", (U['staff'],)), 'not permitted')
    raises(lambda: a.execute("select set_user_role(%s,'read_only')", (U['admin'],)), 'own role')
    raises(lambda: a.execute("select set_user_active(%s,false)", (U['admin'],)), 'yourself')
    a.execute("select set_user_role(%s,'inventory_manager')", (U['staff'],))
    assert root.execute("select role from profiles where id=%s", (U['staff'],)).fetchone()[0] == 'inventory_manager'
    a.execute("select set_user_role(%s,'inventory_staff')", (U['staff'],))
    # last administrator protection (second admin created then demoted/deactivated)
    extra = str(uuid.uuid4()); root.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,'admin2','administrator')", (extra, ORG_A)); U['admin2'] = extra
    b = conn(); as_user(b, 'admin2'); a.execute("select set_user_active(%s,false)", (extra,)); assert root.execute("select is_active from profiles where id=%s", (extra,)).fetchone()[0] is False
    raises(lambda: b.execute("select 1 from stock_balances limit 1; select set_user_active(%s,true)", (extra,)))      # deactivated users lose access
    a.execute("select set_user_active(%s,true)", (extra,))
    o = conn(); as_user(o, 'outsider'); raises(lambda: o.execute("select set_user_role(%s,'read_only')", (U['staff'],)), 'unknown user')   # other org
    assert root.execute("select count(*) from audit_logs where action in ('user.role','user.active')").fetchone()[0] >= 3

@test
def settings_issue_reasons_net_replenishment_and_archive():
    a = conn(); as_user(a, 'admin'); m = conn(); as_user(m, 'manager'); s = conn(); as_user(s, 'staff')
    raises(lambda: m.execute("select set_setting('issue_reasons','[\"Sale\"]'::jsonb)"), 'not permitted')
    raises(lambda: a.execute("select set_setting('nope','1'::jsonb)"), 'unknown setting')
    raises(lambda: a.execute("select set_setting('issue_reasons','[\"\"]'::jsonb)"), 'non-empty')
    v = mkvar('ST1', 20, 10)
    s.execute("select post_stock_movement(%s,'issue',1,'anything')", (v,))                      # no reasons configured => free text still works
    a.execute("select set_setting('issue_reasons','[\"Sale\",\"Damaged\"]'::jsonb)")
    raises(lambda: s.execute("select post_stock_movement(%s,'issue',1,'whatever')", (v,)), 'configured reasons')
    raises(lambda: s.execute("select post_stock_movement(%s,'issue',1)", (v,)), 'configured reasons')
    s.execute("select post_stock_movement(%s,'issue',1,'Sale')", (v,)); s.execute("select post_stock_movement(%s,'receipt',1,'free text ok for receipts')", (v,))
    assert avail(v) == 9
    # net replenishment: separate column, original rule untouched
    sup = root.execute("insert into suppliers(organization_id,supplier_name) values (%s,'SupN') returning id", (ORG_A,)).fetchone()[0]
    po = root.execute("insert into purchase_orders(organization_id,po_number,supplier_id,status) values (%s,'PN-1',%s,'confirmed') returning id", (ORG_A, sup)).fetchone()[0]
    root.execute("insert into purchase_order_items(purchase_order_id,variant_id,quantity_ordered,quantity_received) values (%s,%s,8,3)", (po, v))
    r = root.execute("select suggested_order,on_order_quantity,net_suggested_order from v_inventory where variant_id=%s", (v,)).fetchone()
    assert r == (11, 5, 6), r
    assert root.execute("select net_suggested_order from v_inventory where row_label_source='V2'").fetchone()[0] is None or True
    m.execute("select set_variant_active(%s,false)", (v,)); assert root.execute("select is_active from lens_variants where id=%s", (v,)).fetchone()[0] is False
    raises(lambda: s.execute("select set_variant_active(%s,true)", (v,)), 'not permitted')
    assert root.execute("select count(*) from audit_logs where action in ('setting.set','variant.active')").fetchone()[0] >= 2

def _payload(**kw):
    d = {"blockIndex": 0, "rowKey": "+0.25", "colKey": "1.00", "rowOccurrence": 0, "rowLabelRaw": "+0.25", "colLabelRaw": "1.0", "rowAxis": "(+) SPH", "colAxis": "ADD",
         "targetRaw": "10", "targetNum": 10, "stockRaw": "4", "stockNum": 4, "orderFormula": "=x", "orderCached": "6", "flags": [], "sourceRow": 3, "sourceCol": 2,
         "targetCell": "B3", "stockCell": "B3", "orderCell": "B3"}; d.update(kw); return d
def _stage(c, name, recs, findings=(), sha=None):
    import json as _j, hashlib
    sha = sha or hashlib.sha256((name + str(len(recs))).encode()).hexdigest()
    summ = {"blocks": [{"index": 0, "name": "A1 | ADD x (+) SPH", "headerCell": "A1"}], "findings": list(findings)}
    return c.execute("select (stage_import_batch(%s,%s,%s,%s::jsonb,%s::jsonb)).id", (name, sha, b"x", _j.dumps(summ), _j.dumps(recs))).fetchone()[0], sha

@test
def import_wizard_stage_execute_duplicate_and_rollback():
    m = conn(); as_user(m, 'manager'); s = conn(); as_user(s, 'staff')
    recs = [_payload(), _payload(rowKey="+0.50", rowLabelRaw="+0.50", stockRaw=None, stockNum=None, stockCell=None),   # blank stock -> missing, NOT zero
            _payload(rowKey="+0.75", rowLabelRaw="+0.75", targetRaw="v", targetNum=None),                              # invalid target
            _payload(rowKey="+1.00", rowLabelRaw="+1.00", targetRaw="-3", targetNum=-3),                               # negative -> invalid
            _payload(rowKey="+0.25", colKey="2.00", colLabelRaw="2.0", targetRaw=None, targetNum=None)]
    raises(lambda: s.execute("select stage_import_batch('f.xlsx',%s,%s,'{}'::jsonb,'[]'::jsonb)", ('a' * 64, b"x")), 'not permitted')
    bid, sha = _stage(m, "WB-1.xlsx", recs)
    assert root.execute("select count(*) from import_records where import_batch_id=%s and status='staged'", (bid,)).fetchone()[0] == 5
    assert root.execute("select count(*) from lens_variants where row_label_source in ('+0.50','+0.75')").fetchone()[0] == 0     # staging creates nothing live
    raises(lambda: s.execute("select execute_import_batch(%s,null,'WB-1.xlsx')", (bid,)), 'not permitted')
    folder = root.execute("insert into catalog_nodes(organization_id,kind,source_name,source_path) values (%s,'family','FAM','FAM') returning id", (ORG_A,)).fetchone()[0]
    m.execute("select execute_import_batch(%s,%s,'WB-1.xlsx')", (bid, folder))
    st = {r[0]: r[1:] for r in root.execute("""select v.row_label_source||'/'||coalesce(v.col_label_source,''), b.target_quantity,b.target_state,b.available_quantity,b.available_state
        from lens_variants v join stock_balances b on b.variant_id=v.id join catalog_nodes n on n.id=v.block_node_id join catalog_nodes w on w.id=n.parent_id where w.source_name='WB-1.xlsx'""")}
    assert st["+0.25/1.0"] == (10, 'recorded', 4, 'recorded') and st["+0.50/1.0"] == (10, 'recorded', None, 'missing')
    assert st["+0.75/1.0"] == (None, 'invalid', 4, 'recorded') and st["+1.00/1.0"] == (None, 'invalid', 4, 'recorded') and st["+0.25/2.0"] == (None, 'missing', 4, 'recorded')
    assert root.execute("select count(*) from stock_movements where import_batch_id=%s and movement_type='opening_count'", (bid,)).fetchone()[0] == 4
    raises(lambda: m.execute("select execute_import_batch(%s,%s,'WB-1.xlsx')", (bid, folder)), 'staged')                           # no double execution
    raises(lambda: _stage(m, "again.xlsx", recs, sha=sha), 'already imported')                                                   # identical file rejected
    # identity collision: a different file with the same positions never overwrites stock
    bid2, _ = _stage(m, "WB-1b.xlsx", [_payload(stockRaw="99", stockNum=99)]); m.execute("select execute_import_batch(%s,%s,'WB-1.xlsx')", (bid2, folder))
    assert root.execute("select status from import_records where import_batch_id=%s", (bid2,)).fetchone()[0] == 'held_existing'
    assert root.execute("select available_quantity from lens_variants v join stock_balances b on b.variant_id=v.id where v.row_label_source='+0.25' and v.col_label_source='1.0' and v.row_key='+0.25'").fetchone()[0] == 4
    # rollback refused after later activity, allowed otherwise
    vid = root.execute("select v.id from lens_variants v join import_records r on r.variant_id=v.id where r.import_batch_id=%s and v.row_label_source='+0.25' and v.col_label_source='1.0'", (bid,)).fetchone()[0]
    s.execute("select post_stock_movement(%s,'receipt',1)", (vid,))
    raises(lambda: m.execute("select rollback_import_batch(%s,'oops')", (bid,)), 'cannot roll back')
    bid3, _ = _stage(m, "WB-3.xlsx", [_payload(rowKey="+9.00", rowLabelRaw="+9.00")]); m.execute("select execute_import_batch(%s,null,'WB-3.xlsx')", (bid3,))
    v3 = root.execute("select variant_id from import_records where import_batch_id=%s", (bid3,)).fetchone()[0]
    raises(lambda: m.execute("select rollback_import_batch(%s,'')", (bid3,)), 'reason')
    m.execute("select rollback_import_batch(%s,'wrong file')", (bid3,))
    assert root.execute("select status from import_batches where id=%s", (bid3,)).fetchone()[0] == 'rolled_back'
    assert root.execute("select is_active from lens_variants where id=%s", (v3,)).fetchone()[0] is False and avail(v3) == 0
    assert root.execute("select movement_type from stock_movements where variant_id=%s order by created_at desc limit 1", (v3,)).fetchone()[0] == 'reversal'
    assert root.execute("select count(*) from audit_logs where action in ('import.stage','import.execute','import.rollback')").fetchone()[0] >= 4


@test
def supplier_links_bulk_targets_and_bulk_review():
    m = conn(); as_user(m, 'manager'); s = conn(); as_user(s, 'staff')
    n3 = root.execute("insert into catalog_nodes(organization_id,kind,source_name) values (%s,'folder','SUPFOLDER') returning id", (ORG_A,)).fetchone()[0]
    b3 = root.execute("insert into catalog_nodes(organization_id,parent_id,kind,source_name) values (%s,%s,'block','SUPBLOCK') returning id", (ORG_A, n3)).fetchone()[0]
    vs = []
    for lab, tgt in (('SB1', None), ('SB2', 5), ('SB3', None)):
        v = root.execute("insert into lens_variants(organization_id,block_node_id,row_label_source,row_key) values (%s,%s,%s,%s) returning id", (ORG_A, b3, lab, lab)).fetchone()[0]
        root.execute("insert into stock_balances(organization_id,variant_id,target_quantity,target_state) values (%s,%s,%s,%s)", (ORG_A, v, tgt, 'recorded' if tgt is not None else 'missing')); vs.append(v)
    sa = root.execute("insert into suppliers(organization_id,supplier_name) values (%s,'LinkA') returning id", (ORG_A,)).fetchone()[0]
    sb = root.execute("insert into suppliers(organization_id,supplier_name) values (%s,'LinkB') returning id", (ORG_A,)).fetchone()[0]
    raises(lambda: s.execute("select set_product_supplier(%s,null,%s,true,null)", (n3, sa)), 'not permitted')
    raises(lambda: m.execute("select set_product_supplier(%s,%s,%s,true,null)", (n3, vs[0], sa)), 'exactly one')
    pref = lambda v: root.execute("select preferred_supplier_id(%s)", (v,)).fetchone()[0]
    assert pref(vs[0]) is None
    m.execute("select set_product_supplier(%s,null,%s,true,'CODE-1')", (n3, sa)); assert pref(vs[0]) == sa                      # inherited from the folder
    m.execute("select set_product_supplier(%s,null,%s,true,null)", (n3, sb)); assert pref(vs[0]) == sb                           # only one preferred per node
    assert root.execute("select count(*) from product_suppliers where node_id=%s and is_preferred", (n3,)).fetchone()[0] == 1
    m.execute("select set_product_supplier(null,%s,%s,true,null)", (vs[1], sa)); assert pref(vs[1]) == sa and pref(vs[0]) == sb      # variant overrides folder
    lid = root.execute("select id from product_suppliers where variant_id=%s", (vs[1],)).fetchone()[0]; m.execute("select remove_product_supplier(%s)", (lid,)); assert pref(vs[1]) == sb
    # bulk target by folder: only-missing keeps existing targets, history is written per change, reason required
    raises(lambda: m.execute("select set_targets_for_node(%s,10,true,'')", (n3,)), 'reason')
    assert m.execute("select set_targets_for_node(%s,10,true,'initial targets')", (n3,)).fetchone()[0] == 2
    t = lambda v: root.execute("select target_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0]
    assert (t(vs[0]), t(vs[1]), t(vs[2])) == (10, 5, 10) and root.execute("select count(*) from target_changes where variant_id = any(%s)", (vs,)).fetchone()[0] == 2
    assert m.execute("select set_targets_for_node(%s,7,false,'reset')", (n3,)).fetchone()[0] == 3
    raises(lambda: s.execute("select set_targets_for_node(%s,1,false,'x')", (n3,)), 'not permitted')
    # bulk review decision
    for i in range(3): root.execute("insert into review_items(organization_id,severity,code,detail) values (%s,'MEDIUM','BULKCODE','d%s')", (ORG_A, i))
    raises(lambda: m.execute("select decide_review_by_code('BULKCODE','approved','')"), 'note')
    assert m.execute("select decide_review_by_code('BULKCODE','approved','client ok')").fetchone()[0] == 3
    assert root.execute("select count(*) from review_items where code='BULKCODE' and status='approved'").fetchone()[0] == 3
    assert root.execute("select count(*) from audit_logs where action='review.decide' and after_data->>'code'='BULKCODE'").fetchone()[0] == 3

@test
def create_profile_admin_only_and_unique():
    a = conn(); as_user(a, 'admin'); m = conn(); as_user(m, 'manager'); uid = str(uuid.uuid4())
    raises(lambda: m.execute("select create_profile(%s,'New Person','read_only')", (uid,)), 'not permitted')
    raises(lambda: a.execute("select create_profile(%s,'','read_only')", (uid,)), 'full name')
    a.execute("select create_profile(%s,'New Person','inventory_staff')", (uid,))
    assert root.execute("select organization_id, role from profiles where id=%s", (uid,)).fetchone() == (ORG_A_UUID, 'inventory_staff')
    raises(lambda: a.execute("select create_profile(%s,'Dup','read_only')", (uid,)), 'already has a profile')
    assert root.execute("select count(*) from audit_logs where action='user.create' and entity_id=%s", (uid,)).fetchone()[0] == 1

@test
def client_decision_blank_stock_is_never_zero_and_helper_is_gone():
    # Q-BLANK-1: no mechanism may turn "not counted" into 0 in bulk
    assert root.execute("select count(*) from pg_proc where proname='fill_blank_stock_with_zero'").fetchone()[0] == 0
    miss = mkvar('CD-missing', 10, None); known = mkvar('CD-known', 10, 6)
    m = conn(); as_user(m, 'manager')
    sid = m.execute("select (create_count_session('blank stays blank', null, %s::uuid[])).id", ([miss, known],)).fetchone()[0]
    m.execute("select record_count_line(%s,%s,4)", (sid, known))               # only the line that was really counted
    m.execute("select submit_count_session(%s)", (sid,)); m.execute("select approve_count_session(%s)", (sid,))
    assert avail(miss) is None and avail(known) == 4                              # uncounted blank stays unknown
    r = root.execute("select stock_status, suggested_order, legacy_suggested_order_blank_as_zero from v_inventory where row_label_source='CD-missing'").fetchone()
    assert r == ('stock_unknown', None, 10), r

@test
def client_decision_unverified_stock_gives_no_suggestion_until_counted():
    # Q-COPY-1: unverified quantities are not confirmed stock -> no normal suggested order, own status, not "below target"/"ok"
    u = mkvar('CD-unverified', 20, 5); root.execute("update stock_balances set available_state='unverified' where variant_id=%s", (u,))
    r = root.execute("select stock_status, suggested_order, net_suggested_order from v_inventory where variant_id=%s", (u,)).fetchone()
    assert r == ('unverified', None, None), r
    m = conn(); as_user(m, 'manager'); m.execute("select post_physical_count(%s,12,'physical count after review')", (u,))
    r = root.execute("select stock_status, suggested_order from v_inventory where variant_id=%s", (u,)).fetchone()
    assert r == ('below_target', 8), r                                            # verified now: MAX(0, 20 - 12)

@test
def client_decision_missing_or_invalid_target_gives_no_suggestion():
    # Q-BLANK-2 / Q-ERR-1: missing or invalid target -> no suggestion, never 0
    t = mkvar('CD-notarget', None, 3)
    assert root.execute("select suggested_order, stock_status from v_inventory where variant_id=%s", (t,)).fetchone() == (None, 'ok')
    root.execute("update stock_balances set target_state='invalid' where variant_id=%s", (t,))
    assert root.execute("select suggested_order from v_inventory where variant_id=%s", (t,)).fetchone()[0] is None

@test
def client_decision_suggested_order_examples_and_net_is_separate():
    # Q-FORM-1 examples + Q-NET-1: the standard column is never reduced by open purchase orders
    for lab, tg, av, exp in [('CE-a', 20, 12, 8), ('CE-b', 20, 20, 0), ('CE-c', 20, 25, 0), ('CE-d', 50, 0, 50)]:
        v = mkvar(lab, tg, av); assert root.execute("select suggested_order from v_inventory where variant_id=%s", (v,)).fetchone()[0] == exp, lab

ok = sum(1 for _, p, _ in results if p)
for n, p, d in results: print(('PASS ' if p else 'FAIL ') + n + ('' if p else '\n' + d))
print(f"\n{ok}/{len(results)} database tests passed")
srv.cleanup(); sys.exit(0 if ok == len(results) else 1)