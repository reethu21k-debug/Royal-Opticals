#!/usr/bin/env python3
"""Billing tests on a real PostgreSQL (pgserver). Run: python3 db/tests/test_billing.py
Covers the business rule: ONLY inventory lines are deducted (at finalize); external lines never touch stock."""
import os, sys, glob, tempfile, uuid, json, traceback
import pgserver, psycopg

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = sorted(glob.glob(os.path.join(HERE, '..', 'migrations', '*.sql')))
srv = pgserver.get_server(tempfile.mkdtemp())
URI = srv.get_uri()
def conn(autocommit=True): return psycopg.connect(URI, autocommit=autocommit)

root = conn()
root.execute("create role authenticated nologin; create role anon nologin;")
for f in MIG: root.execute(open(f, encoding='utf-8').read())

ORG_A, ORG_B = str(uuid.uuid4()), str(uuid.uuid4())
U = {k: str(uuid.uuid4()) for k in ('admin', 'manager', 'staff', 'readonly', 'outsider')}
root.execute("insert into organizations(id,name) values (%s,'Royal Opticals'),(%s,'Other Co')", (ORG_A, ORG_B))
for k, role, org in (('admin', 'administrator', ORG_A), ('manager', 'inventory_manager', ORG_A), ('staff', 'inventory_staff', ORG_A),
                     ('readonly', 'read_only', ORG_A), ('outsider', 'administrator', ORG_B)):
    root.execute("insert into profiles(id,organization_id,full_name,role) values (%s,%s,%s,%s)", (U[k], org, k, role))
wb = root.execute("insert into catalog_nodes(organization_id,kind,source_name) values (%s,'workbook','CR.1.56 HMC') returning id", (ORG_A,)).fetchone()[0]
node = root.execute("insert into catalog_nodes(organization_id,parent_id,kind,source_name) values (%s,%s,'block','SPH x CYL') returning id", (ORG_A, wb)).fetchone()[0]

def mkvar(label, available, state='recorded', org=ORG_A, col=''):
    vid = root.execute("insert into lens_variants(organization_id,block_node_id,row_label_source,col_label_source,row_key,col_key) values (%s,%s,%s,%s,%s,%s) returning id",
                       (org, node, label, col or None, label, col)).fetchone()[0]
    root.execute("insert into stock_balances(organization_id,variant_id,target_quantity,target_state,available_quantity,available_state) values (%s,%s,10,'recorded',%s,%s)",
                 (org, vid, available, state if available is not None else 'missing'))
    return vid

def as_user(c, who):
    c.execute("select set_config('request.jwt.claim.sub', %s, false)", (U[who],)); c.execute("set role authenticated")
def avail(vid): return root.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0]
def nmov(vid): return root.execute("select count(*) from stock_movements where variant_id=%s", (vid,)).fetchone()[0]
def raises(fn, needle=None):
    try: fn()
    except Exception as e:
        if needle and needle.lower() not in str(e).lower(): raise AssertionError(f"wrong error: {e}")
        return True
    raise AssertionError("expected an error but none was raised")

def inv(line, side, vid, qty=1, rate=100, **kw): return dict(lineNo=line, side=side, source='inventory', variantId=str(vid), quantity=qty, rate=rate, **kw)
def ext(line, side, qty=1, rate=250, lens='Special order 1.67 -9.00', **kw): return dict(lineNo=line, side=side, source='external', lensType=lens, quantity=qty, rate=rate, **kw)
def save(who, items, finalize=False, header=None, bill=None, key=None):
    c = conn(); as_user(c, who)
    r = c.execute("select * from save_bill(%s,%s::jsonb,%s::jsonb,%s,%s)", (bill, json.dumps(header or {}), json.dumps(items), finalize, key))
    cols = [d.name for d in r.description]; row = r.fetchone(); c.close()
    return dict(zip(cols, row))

results = []
def test(fn):
    try: fn(); results.append((fn.__name__, True, ''))
    except Exception as e: results.append((fn.__name__, False, f"{e}\n{traceback.format_exc()}"))
    return fn

@test
def scenario1_inventory_lens_is_deducted_on_finalize():
    v = mkvar('+1.00', 10, col='-2.00')
    b = save('staff', [inv(1, 'R', v, 2, 100)], finalize=True)
    assert b['status'] == 'finalized' and avail(v) == 8
    m = root.execute("select movement_type, quantity_delta, reference_type, reference_id from stock_movements where variant_id=%s", (v,)).fetchone()
    assert m == ('issue', -2, 'bill', b['id']), m

@test
def scenario2_external_lens_never_touches_stock_but_counts_in_total():
    v = mkvar('+2.00', 5)
    b = save('staff', [ext(1, 'R', 1, 250)], finalize=True)
    assert b['status'] == 'finalized' and float(b['total_amount']) == 250
    assert avail(v) == 5 and nmov(v) == 0
    assert root.execute("select count(*) from stock_movements where reference_id=%s", (b['id'],)).fetchone()[0] == 0

@test
def mixed_bill_left_inventory_right_external():
    v = mkvar('-1.00', 4)
    b = save('staff', [inv(1, 'L', v, 1, 100), ext(1, 'R', 1, 300)], finalize=True)
    assert avail(v) == 3
    assert float(b['total_amount']) == 400          # both sources contribute to the bill total

@test
def both_inventory_and_neither_inventory():
    a, c_ = mkvar('A1', 6), mkvar('A2', 6)
    save('staff', [inv(1, 'R', a, 1), inv(1, 'L', c_, 1)], finalize=True)
    assert avail(a) == 5 and avail(c_) == 5
    save('staff', [ext(1, 'R'), ext(1, 'L')], finalize=True)
    assert avail(a) == 5 and avail(c_) == 5

@test
def same_lens_on_two_lines_is_deducted_once_in_total_and_checked_together():
    v = mkvar('S1', 3)
    raises(lambda: save('staff', [inv(1, 'R', v, 2), inv(2, 'R', v, 2)], finalize=True), 'not enough stock')
    assert avail(v) == 3
    save('staff', [inv(1, 'R', v, 1), inv(1, 'L', v, 2)], finalize=True)
    assert avail(v) == 0

@test
def insufficient_stock_rolls_back_everything():
    ok, low = mkvar('OK', 5), mkvar('LOW', 1)
    n_before = root.execute("select count(*) from bills").fetchone()[0]
    raises(lambda: save('staff', [inv(1, 'R', ok, 2), inv(1, 'L', low, 2)], finalize=True), 'not enough stock')
    assert avail(ok) == 5 and avail(low) == 1                 # nothing was deducted, not even the lens that had stock
    assert root.execute("select count(*) from bills").fetchone()[0] == n_before   # and no half-saved bill

@test
def stock_never_goes_negative_even_if_called_directly():
    v = mkvar('NEG', 1)
    raises(lambda: save('staff', [inv(1, 'R', v, 5)], finalize=True))
    assert avail(v) == 1

@test
def unrecorded_or_unverified_stock_cannot_be_deducted():
    blank, unver = mkvar('BLANK', None), mkvar('UNVER', 5, state='unverified')
    raises(lambda: save('staff', [inv(1, 'R', blank)], finalize=True), 'not recorded')
    raises(lambda: save('staff', [inv(1, 'R', unver)], finalize=True), 'not recorded')
    assert avail(unver) == 5

@test
def draft_does_not_deduct_then_finalize_does_once():
    v = mkvar('DR', 5)
    b = save('staff', [inv(1, 'R', v, 2)])
    assert b['status'] == 'draft' and avail(v) == 5
    b2 = save('staff', [inv(1, 'R', v, 3)], bill=b['id'])         # editing a draft replaces its lines
    assert float(b2['total_amount']) == 300
    c = conn(); as_user(c, 'staff'); c.execute("select finalize_bill(%s)", (b['id'],))
    assert avail(v) == 2
    raises(lambda: c.execute("select finalize_bill(%s)", (b['id'],)), 'already')   # no double deduction
    assert avail(v) == 2

@test
def finalized_bill_cannot_be_edited():
    v = mkvar('ED', 5); b = save('staff', [inv(1, 'R', v)], finalize=True)
    raises(lambda: save('staff', [inv(1, 'R', v, 4)], bill=b['id']), 'only a draft')

@test
def external_line_cannot_carry_a_variant_and_inventory_line_requires_one():
    v = mkvar('XV', 5)
    c = conn(); as_user(c, 'staff')
    raises(lambda: c.execute("select * from save_bill(null,'{}',%s::jsonb)", (json.dumps([dict(lineNo=1, side='R', source='inventory', quantity=1, rate=1)]),)), 'choose a lens')
    raises(lambda: c.execute("select * from save_bill(null,'{}',%s::jsonb)", (json.dumps([dict(lineNo=1, side='R', source='external', quantity=1, rate=1)]),)), 'external')
    # a variant id sent with an external line is ignored (never stored), so it can never be deducted
    b = save('staff', [dict(ext(1, 'R'), variantId=str(v))], finalize=True)
    assert avail(v) == 5
    assert root.execute("select variant_id from bill_items where bill_id=%s", (b['id'],)).fetchone()[0] is None

@test
def totals_and_balance_follow_the_sheet():
    v = mkvar('TOT', 9)
    b = save('staff', [inv(1, 'R', v, 2, 100), ext(1, 'L', 1, 300)],
             header=dict(customerName='Ravi', oldBalance=50, returnAmount=20, advanceAmount=100))
    assert float(b['total_amount']) == 500 and float(b['balance_amount']) == 430   # 50 + 500 - 20 - 100

@test
def idempotent_retry_creates_one_bill():
    v = mkvar('IDEM', 5); k = str(uuid.uuid4())
    a = save('staff', [inv(1, 'R', v)], finalize=True, key=k); b = save('staff', [inv(1, 'R', v)], finalize=True, key=k)
    assert a['id'] == b['id'] and avail(v) == 4

@test
def void_restores_inventory_only_and_only_once():
    v, w = mkvar('VOID', 5), mkvar('VOID2', 5)
    b = save('staff', [inv(1, 'R', v, 2), ext(1, 'L', 1, 300)], finalize=True)
    assert avail(v) == 3
    c = conn(); as_user(c, 'staff'); raises(lambda: c.execute("select void_bill(%s,'oops')", (b['id'],)), 'not permitted')   # staff cannot void
    m = conn(); as_user(m, 'manager'); m.execute("select void_bill(%s,'entered wrong customer')", (b['id'],))
    assert avail(v) == 5
    assert root.execute("select movement_type, quantity_delta from stock_movements where variant_id=%s order by created_at desc limit 1", (v,)).fetchone() == ('reversal', 2)
    raises(lambda: m.execute("select void_bill(%s,'again')", (b['id'],)), 'already void'); assert avail(v) == 5
    d = save('staff', [inv(1, 'R', w, 1)]); m.execute("select void_bill(%s,'draft not needed')", (d['id'],)); assert avail(w) == 5   # voiding a draft deducts/restores nothing

@test
def permissions_and_tenant_isolation():
    v = mkvar('PERM', 5)
    raises(lambda: save('readonly', [inv(1, 'R', v)]), 'not permitted')
    other = mkvar('OTHER', 5, org=ORG_B)
    raises(lambda: save('staff', [inv(1, 'R', other)]), 'does not exist')          # cannot bill another organization's stock
    b = save('staff', [ext(1, 'R')])
    c = conn(); as_user(c, 'outsider'); assert c.execute("select count(*) from bills where id=%s", (b['id'],)).fetchone()[0] == 0
    c = conn(); as_user(c, 'staff'); raises(lambda: c.execute("update bills set total_amount = 0"), None)  # no direct writes
    raises(lambda: c.execute("delete from bill_items"), None)

fails = [r for r in results if not r[1]]
for n, ok, msg in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '\n' + msg))
print(f"\n{len(results) - len(fails)}/{len(results)} passed"); sys.exit(1 if fails else 0)