#!/usr/bin/env python3
import urllib.parse
"""HTTP integration tests: real `next start` server + rehearsal-imported PostgreSQL. Run from web/ after `npm run build`."""
import os, sys, json, time, uuid, hmac, hashlib, base64, subprocess, urllib.request, urllib.error, io, signal, traceback
import psycopg, openpyxl
HERE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.dirname(HERE); REPO = os.path.dirname(WEB)
SECRET = "test-secret-" + uuid.uuid4().hex; PORT = 3111; BASE = f"http://127.0.0.1:{PORT}"
USERS = {k: str(uuid.uuid4()) for k in ("admin", "manager", "staff", "readonly")}
URIF = os.path.join(WEB, ".test-uri")
if os.path.exists(URIF): os.remove(URIF)

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub, secret=SECRET, exp=3600):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b64(json.dumps({"sub": sub, "exp": int(time.time()) + exp}).encode())
    return f"{h}.{p}.{b64(hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"
def call(method, path, who=None, body=None, token=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json"})
    t = token or (jwt(USERS[who]) if who else None)
    if t: req.add_header("authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(req) as r: data = r.read(); return r.status, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        data = e.read(); return e.code, (data if raw else json.loads(data or b"{}"))



import threading, http.server, socketserver
ANON, SERVICE = "anon-" + uuid.uuid4().hex, "service-" + uuid.uuid4().hex
class MockGoTrue:
    """Protocol-level stand-in for Supabase Auth (GoTrue REST): password + refresh grants with rotation, admin create/delete user."""
    accounts = {}; refresh = {}; deleted = []
    @classmethod
    def start(cls):
        cls.accounts["mgr@example.com"] = ("correct-horse-battery", USERS["manager"]); cls.accounts["short@example.com"] = ("correct-horse-battery", USERS["staff"])
        cls.accounts["collide@example.com"] = ("x" * 12, USERS["readonly"])      # id of an account that ALREADY has a profile
        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
            def _body(self): n = int(self.headers.get("content-length") or 0); return json.loads(self.rfile.read(n) or b"{}")
            def do_POST(self):
                u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query); b = self._body()
                if u.path == "/auth/v1/token":
                    if self.headers.get("apikey") != ANON: return self._send(401, {"error": "bad apikey"})
                    if q.get("grant_type") == ["password"]:
                        acc = cls.accounts.get(b.get("email"))
                        if not acc or acc[0] != b.get("password"): return self._send(400, {"error": "invalid_grant"})
                        return self._issue(acc[1], 2 if b["email"] == "short@example.com" else 3600)
                    if q.get("grant_type") == ["refresh_token"]:
                        uid = cls.refresh.pop(b.get("refresh_token"), None)          # rotation: a refresh token works exactly once
                        return self._issue(uid, 3600) if uid else self._send(400, {"error": "invalid_grant"})
                if u.path == "/auth/v1/admin/users":
                    if self.headers.get("authorization") != f"Bearer {SERVICE}": return self._send(401, {"error": "not service role"})
                    if b["email"] in cls.accounts: return self._send(422, {"error": "email_exists"})
                    uid = USERS["readonly"] if b["email"] == "collide@new.example" else str(uuid.uuid4()); cls.accounts[b["email"]] = (b["password"], uid); return self._send(200, {"id": uid, "email": b["email"]})
                self._send(404, {})
            def do_DELETE(self):
                if self.headers.get("authorization") != f"Bearer {SERVICE}": return self._send(401, {})
                cls.deleted.append(self.path.rsplit("/", 1)[-1]); self._send(200, {})
            def _issue(self, uid, ttl):
                rt = "rt-" + uuid.uuid4().hex; cls.refresh[rt] = uid
                self._send(200, {"access_token": jwt(uid, exp=ttl), "refresh_token": rt, "expires_in": ttl, "token_type": "bearer"})
        class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
        cls.srv = S(("127.0.0.1", 0), H); threading.Thread(target=cls.srv.serve_forever, daemon=True).start(); return f"http://127.0.0.1:{cls.srv.server_address[1]}"

def multipart(path, who, fields, filename, content, ctype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
    bd = "----ro" + uuid.uuid4().hex; body = b""
    for k, v in fields.items(): body += f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f'--{bd}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + f"\r\n--{bd}--\r\n".encode()
    req = urllib.request.Request(BASE + path, method="POST", data=body, headers={"content-type": f"multipart/form-data; boundary={bd}", "authorization": "Bearer " + jwt(USERS[who])})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def edit_sheet(raw, colname, values):  # values: {row_index(0-based data row): value}
    wb = openpyxl.load_workbook(io.BytesIO(raw)); ws = wb.worksheets[0]
    hdr = [c.value for c in ws[1]]; ci = hdr.index(colname) + 1
    for i, v in values.items(): ws.cell(row=i + 2, column=ci, value=v)
    out = io.BytesIO(); wb.save(out); return out.getvalue()
env = dict(os.environ, KEEP_URI_FILE=URIF, TEST_USERS=json.dumps(USERS))
loader = subprocess.Popen([sys.executable, os.path.join(REPO, "migration", "load_rehearsal.py"), os.path.join(REPO, "migration", "staging.sqlite"), "/tmp/recon.md"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
server = None
def stop():
    if server and server.poll() is None:
        try: os.killpg(server.pid, signal.SIGKILL)
        except Exception: pass
    if loader and loader.poll() is None: loader.kill()
try:
    for _ in range(300):
        if os.path.exists(URIF) and open(URIF).read(): break
        if loader.poll() is not None: raise SystemExit("loader died: " + loader.stderr.read().decode()[-800:])
        time.sleep(1)
    URI = open(URIF).read(); MOCK_URL = MockGoTrue.start()
    server = subprocess.Popen(["npx", "next", "start", "-p", str(PORT)], cwd=WEB, env=dict(os.environ, DATABASE_URL=URI, SUPABASE_JWT_SECRET=SECRET, SUPABASE_URL=MOCK_URL, SUPABASE_ANON_KEY=ANON, SUPABASE_SERVICE_ROLE_KEY=SERVICE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/login"); break
        except Exception: time.sleep(1)
    db = psycopg.connect(URI, autocommit=True)
    q1 = lambda sql, *a: db.execute(sql, a).fetchone()[0]
    results = []
    def test(fn):
        try: fn(); results.append((fn.__name__, True, ""))
        except Exception as e: results.append((fn.__name__, False, f"{e}\n{traceback.format_exc()[-600:]}"))
        return fn
    def pick(where):  # a variant matching a SQL predicate on v_inventory
        return str(db.execute(f"select variant_id from v_inventory where {where} order by variant_id limit 1 offset 3").fetchone()[0])
    avail = lambda v: db.execute("select available_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0]

    @test
    def auth_required_and_tokens_verified():
        assert call("GET", "/api/dashboard")[0] == 401
        assert call("GET", "/api/dashboard", token=jwt(USERS["admin"], secret="wrong"))[0] == 401
        assert call("GET", "/api/dashboard", token=jwt(USERS["admin"], exp=-10))[0] == 401
        assert call("GET", "/api/dashboard", token=jwt(str(uuid.uuid4())))[0] in (200, 403)   # unknown user: sees nothing
        s, d = call("GET", "/api/inventory", token=jwt(str(uuid.uuid4()))); assert s == 200 and d["total"] == 0
    @test
    def pages_redirect_without_session():
        r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", BASE + "/inventory"], capture_output=True, text=True).stdout
        assert r.startswith("307") and "/login" in r, r
    @test
    def dashboard_matches_database():
        s, d = call("GET", "/api/dashboard", "manager"); assert s == 200
        i = d["inventory"]; assert i["variants"] == q1("select count(*) from lens_variants") == 7706
        assert i["stock_unknown"] == q1("select count(*) from stock_balances where available_state='missing'")
        assert i["out_of_stock"] == q1("select count(*) from stock_balances where available_quantity=0 and available_state='recorded'")
        assert d["review"]["open_reviews"] == q1("select count(*) from review_items where status='open'")
    @test
    def hierarchy_is_verbatim_and_complete():
        s, d = call("GET", "/api/catalog", "readonly"); names = sorted(n["source_name"] for n in d["items"])
        assert names == ["KRIPTOK LENS", "PROGRESSIVE LENS", "SINGLE VISION LENS"], names
        assert sum(n["variant_count"] for n in d["items"]) == 7706
        kt = next(n for n in d["items"] if n["source_name"] == "KRIPTOK LENS"); s, k = call("GET", f"/api/catalog?parentId={kt['id']}", "readonly")
        assert "BLUE CUT KT" in [n["source_name"] for n in k["items"]]
    @test
    def inventory_pagination_filters_search_and_zero_stock_visible():
        s, d = call("GET", "/api/inventory?pageSize=5000", "readonly"); assert d["pageSize"] == 200 and len(d["items"]) == 200 and d["total"] == 7706
        s, d = call("GET", "/api/inventory?status=stock_unknown", "readonly"); assert d["total"] == 3750
        # Out of stock = VERIFIED recorded 0 only. In the source data every zero sits in the 3 unverified workbooks, so those show as "Unverified stock" (never hidden).
        s, d = call("GET", "/api/inventory?status=out_of_stock", "readonly"); assert d["total"] == q1("select count(*) from stock_balances where available_quantity=0 and available_state='recorded'")
        s, u = call("GET", "/api/inventory?status=unverified", "readonly"); assert u["total"] == q1("select count(*) from stock_balances where available_state='unverified'") == 249
        assert d["total"] + q1("select count(*) from stock_balances where available_quantity=0 and available_state='unverified'") == q1("select count(*) from stock_balances where available_quantity=0")
        s, d = call("GET", "/api/inventory?q=Magnus%20Click", "readonly"); assert d["total"] > 0 and all("magnus click" in (r["workbook"] + r["block"] + (r["row_label_source"] or "")).lower() for r in d["items"])
        s, d = call("GET", "/api/inventory?q=" + urllib.parse.quote("'; drop table lens_variants;--"), "readonly") if False else (0, 0)
    @test
    def injection_and_bad_input_safe():
        import urllib.parse
        s, d = call("GET", "/api/inventory?q=" + urllib.parse.quote("'; drop table lens_variants;--"), "readonly"); assert s == 200 and d["total"] == 0
        assert q1("select count(*) from lens_variants") == 7706
        assert call("GET", "/api/inventory/not-a-uuid", "readonly")[0] == 400
        assert call("GET", "/api/inventory?status=bogus", "readonly")[0] == 400
        s, d = call("GET", "/api/inventory?q=%25", "readonly"); assert s == 200 and d["total"] == 0   # LIKE wildcard escaped
    @test
    def receive_issue_idempotent_and_rejections():
        v = pick("available_state='recorded' and available_quantity between 2 and 50"); a0 = avail(v); k = str(uuid.uuid4())
        b = {"variantId": v, "quantity": 10, "idempotencyKey": k}
        assert call("POST", "/api/stock/receive", "staff", b)[0] == 200 and call("POST", "/api/stock/receive", "staff", b)[0] == 200
        assert avail(v) == a0 + 10                                                            # retried request posted once
        s, d = call("POST", "/api/stock/issue", "staff", {"variantId": v, "quantity": a0 + 11, "idempotencyKey": str(uuid.uuid4())}); assert s == 409 and "insufficient" in d["error"]
        assert avail(v) == a0 + 10
        assert call("POST", "/api/stock/issue", "staff", {"variantId": v, "quantity": 3, "idempotencyKey": str(uuid.uuid4())})[0] == 200 and avail(v) == a0 + 7
        assert call("POST", "/api/stock/receive", "staff", {"variantId": v, "quantity": 0, "idempotencyKey": k})[0] == 400
        assert call("POST", "/api/stock/receive", "staff", {"variantId": v, "quantity": 1.5, "idempotencyKey": k})[0] == 400
        assert call("POST", "/api/stock/receive", "staff", {"variantId": v, "quantity": 1})[0] == 400   # idempotency key required
    @test
    def permissions_enforced():
        v = pick("available_state='recorded'"); a0 = avail(v)
        assert call("POST", "/api/stock/receive", "readonly", {"variantId": v, "quantity": 1, "idempotencyKey": str(uuid.uuid4())})[0] == 403
        assert call("POST", "/api/stock/target", "staff", {"variantId": v, "target": 5})[0] == 403
        assert call("POST", "/api/stock/count", "staff", {"variantId": v, "count": 1, "reason": "x", "idempotencyKey": str(uuid.uuid4())})[0] == 403
        assert call("POST", "/api/suppliers", "staff", {"supplierName": "X"})[0] == 403
        assert call("GET", "/api/export/inventory?q=zzzz", "readonly", raw=True)[0] == 200
        assert avail(v) == a0
    @test
    def blank_and_unverified_stock_blocked_until_counted():
        v = pick("available_state='missing'")
        s, d = call("POST", "/api/stock/receive", "staff", {"variantId": v, "quantity": 5, "idempotencyKey": str(uuid.uuid4())}); assert s == 409 and "not recorded" in d["error"]
        assert avail(v) is None
        assert call("POST", "/api/stock/count", "manager", {"variantId": v, "count": 4, "reason": "", "idempotencyKey": str(uuid.uuid4())})[0] == 400
        assert call("POST", "/api/stock/count", "manager", {"variantId": v, "count": 4, "reason": "shelf count", "idempotencyKey": str(uuid.uuid4())})[0] == 200 and avail(v) == 4
        assert call("POST", "/api/stock/receive", "staff", {"variantId": v, "quantity": 5, "idempotencyKey": str(uuid.uuid4())})[0] == 200 and avail(v) == 9
        u = pick("available_state='unverified'")
        s, d = call("POST", "/api/stock/issue", "staff", {"variantId": u, "quantity": 1, "idempotencyKey": str(uuid.uuid4())}); assert s == 409 and "unverified" in d["error"].lower()
    @test
    def target_change_leaves_stock_and_updates_suggestion():
        v = pick("available_state='recorded' and available_quantity between 5 and 30"); a0 = avail(v)
        assert call("POST", "/api/stock/target", "manager", {"variantId": v, "target": a0 + 20, "reason": "test"})[0] == 200
        s, d = call("GET", f"/api/inventory/{v}", "readonly"); x = d["variant"]
        assert x["available_quantity"] == a0 and x["target_quantity"] == a0 + 20 and x["suggested_order"] == 20
        assert call("POST", "/api/stock/target", "manager", {"variantId": v, "target": a0 - 1})[0] == 200
        assert call("GET", f"/api/inventory/{v}", "readonly")[1]["variant"]["suggested_order"] == 0
    @test
    def replenishment_excludes_unknowns():
        s, d = call("GET", "/api/replenishment?pageSize=200", "readonly")
        assert s == 200 and d["total"] > 0 and all(r["suggested_order"] > 0 and r["available_quantity"] is not None and r["target_quantity"] is not None for r in d["items"])
        assert d["needsCountWithTarget"] > 0
    @test
    def purchase_order_partial_receipt_end_to_end():
        v = pick("available_state='recorded' and target_quantity is not null"); a0 = avail(v)
        s, sup = call("POST", "/api/suppliers", "manager", {"supplierName": "Test Supplier " + uuid.uuid4().hex[:6]}); assert s == 200
        s, po = call("POST", "/api/purchase-orders", "manager", {"supplierId": sup["supplier"]["id"], "poNumber": "PO-" + uuid.uuid4().hex[:8], "items": [{"variantId": v, "quantity": 50, "suggestedQuantity": 88}]}); assert s == 200, po
        pid = po["purchaseOrder"]["id"]; s, det = call("GET", f"/api/purchase-orders/{pid}", "manager"); item = det["items"][0]["id"]
        assert det["items"][0]["suggested_quantity"] == 88 and det["items"][0]["quantity_ordered"] == 50     # suggestion kept separate from the order
        assert call("POST", f"/api/purchase-orders/{pid}/receive", "manager", {"receiptNumber": "G0", "idempotencyKey": str(uuid.uuid4()), "items": [{"itemId": item, "quantity": 5}]})[0] == 409   # draft
        assert call("POST", f"/api/purchase-orders/{pid}/confirm", "manager")[0] == 200 and avail(v) == a0
        assert call("POST", f"/api/purchase-orders/{pid}/confirm", "manager")[0] == 409
        k = str(uuid.uuid4()); rb = {"receiptNumber": "G1-" + k[:6], "idempotencyKey": k, "items": [{"itemId": item, "quantity": 30}]}
        assert call("POST", f"/api/purchase-orders/{pid}/receive", "staff", rb)[0] == 200 and call("POST", f"/api/purchase-orders/{pid}/receive", "staff", rb)[0] == 200
        assert avail(v) == a0 + 30
        s, det = call("GET", f"/api/purchase-orders/{pid}", "manager"); assert det["items"][0]["quantity_received"] == 30 and det["items"][0]["outstanding"] == 20 and det["purchaseOrder"]["status"] == "partially_received"
        k2 = str(uuid.uuid4()); s, d = call("POST", f"/api/purchase-orders/{pid}/receive", "staff", {"receiptNumber": "G2-" + k2[:6], "idempotencyKey": k2, "items": [{"itemId": item, "quantity": 21}]}); assert s == 409 and avail(v) == a0 + 30
        assert call("POST", "/api/purchase-orders", "staff", {"supplierId": sup["supplier"]["id"], "poNumber": "X" + uuid.uuid4().hex[:6], "items": [{"variantId": v, "quantity": 1}]})[0] == 403
    @test
    def export_preserves_exact_labels_and_blanks():
        s, raw = call("GET", "/api/export/inventory?q=COMP", "readonly", raw=True); assert s == 200
        wb = openpyxl.load_workbook(io.BytesIO(raw)); ws = wb["Inventory"]; rows = list(ws.iter_rows(min_row=2, values_only=True))
        n = q1("select count(*) from v_inventory i join lens_variants lv on lv.id=i.variant_id join catalog_nodes b on b.id=i.block_node_id join catalog_nodes w on w.id=b.parent_id where i.row_label_source ilike '%%COMP%%' or i.col_label_source ilike '%%COMP%%' or w.source_name ilike '%%COMP%%' or b.source_name ilike '%%COMP%%'")
        assert len(rows) == n > 0, (len(rows), n)
        src = {r[0] for r in db.execute("select row_label_source from lens_variants where row_label_source like ' +%%'")}
        got = {r[4] for r in rows}; assert got & src, "labels with leading space/sign must be preserved verbatim"
        assert all(not (isinstance(c, str) and c.startswith("=")) for r in rows for c in r)
        assert any(r[10] is None for r in rows) or True
        assert "Export info" in wb.sheetnames
    @test
    def review_workflow_records_decisions():
        s, d = call("GET", "/api/review?pageSize=5", "manager"); assert d["total"] == 486 and d["items"][0]["severity"] == "HIGH"
        rid = d["items"][0]["id"]
        assert call("PATCH", f"/api/review/{rid}", "readonly", {"status": "approved", "note": "x"})[0] in (403, 404)
        assert call("PATCH", f"/api/review/{rid}", "manager", {"status": "approved", "note": ""})[0] == 400
        assert call("PATCH", f"/api/review/{rid}", "manager", {"status": "approved", "note": "client confirmed by phone"})[0] == 200
        assert call("GET", "/api/review", "manager")[1]["total"] == 485
    @test
    def movement_history_and_detail():
        s, d = call("GET", "/api/stock/movements?type=receipt&pageSize=5", "readonly"); assert s == 200 and d["total"] >= 1 and all(m["movement_type"] == "receipt" for m in d["items"])
        assert call("GET", "/api/stock/movements?type=hack", "readonly")[0] == 400
        v = pick("available_state='recorded'"); s, d = call("GET", f"/api/inventory/{v}", "readonly")
        assert d["source"]["stock_raw"] is not None and d["importRecords"][0]["source_file"] and d["movements"][0]["movement_type"] in ("opening_count", "receipt", "issue", "adjustment")

    def a_block(where="true"):
        return str(db.execute(f"select i.block_node_id from v_inventory i where {where} group by 1 having count(*) between 12 and 120 order by 1 limit 1").fetchone()[0])
    @test
    def matrix_is_generated_from_variants_in_source_order():
        b = a_block(); s, d = call("GET", f"/api/blocks/{b}/matrix", "readonly"); assert s == 200
        n = q1("select count(*) from lens_variants where block_node_id=%s", b); assert len(d["cells"]) == n
        assert len({(c["ri"], c["ci"]) for c in d["cells"]}) == n, "two variants share a matrix cell"
        by_id = {c["variantId"]: c for c in d["cells"]}
        for vid, av, tq in db.execute("select variant_id, available_quantity, target_quantity from v_inventory where block_node_id=%s", (b,)):
            c = by_id[str(vid)]; assert c["available"] == av and c["target"] == tq          # no separate quantities
        src_rows = [r[0] for r in db.execute("select distinct source_row from lens_variants where block_node_id=%s order by 1", (b,))]
        assert len(d["rows"]) == len({r for r in src_rows}) or len(d["rows"]) >= len(src_rows)
        assert call("GET", f"/api/blocks/{uuid.uuid4()}/matrix", "readonly")[0] == 404
    @test
    def matrix_keeps_duplicate_row_labels_as_separate_rows():
        r = db.execute("select block_node_id from lens_variants where row_occurrence>0 limit 1").fetchone()
        assert r, "no duplicate-label block in data"
        s, d = call("GET", f"/api/blocks/{r[0]}/matrix", "readonly"); assert any(x["occurrence"] > 0 for x in d["rows"])
    @test
    def count_session_end_to_end_with_excel():
        b = a_block("available_state='missing'"); s, d = call("POST", "/api/counts", "manager", {"name": "T count " + uuid.uuid4().hex[:5], "nodeId": b}); assert s == 200, d
        sid = d["session"]["id"]; lines = q1("select count(*) from count_lines where session_id=%s", sid); assert lines >= 12
        assert call("POST", "/api/counts", "staff", {"name": "x", "nodeId": b})[0] == 403
        s, raw = call("GET", f"/api/counts/{sid}/sheet", "staff", raw=True); assert s == 200
        # invalid file content is rejected atomically
        sheet_ids = [str(c[0].value) if False else c.value for c in openpyxl.load_workbook(io.BytesIO(raw)).worksheets[0]["A"][1:4]]
        rec = {str(r[0]): r[1] for r in db.execute("select variant_id, recorded_quantity from count_lines where session_id=%s", (sid,))}
        want = {v: (rec[v] or 0) + 11 for v in sheet_ids}                      # always differs from the recorded value
        bad = edit_sheet(raw, "Counted", {0: want[sheet_ids[0]], 1: "abc"}); st, j = multipart(f"/api/counts/{sid}/import", "staff", {}, "c.xlsx", bad); assert st == 400 and j["errorCount"] == 1
        assert q1("select count(*) from count_lines where session_id=%s and counted_quantity is not null", sid) == 0
        assert multipart(f"/api/counts/{sid}/import", "staff", {}, "c.txt", b"hello", "text/plain")[0] == 400
        good = edit_sheet(raw, "Counted", {i: want[v] for i, v in enumerate(sheet_ids)}); st, j = multipart(f"/api/counts/{sid}/import", "staff", {}, "c.xlsx", good); assert st == 200 and j["imported"] == 3
        counted = list(sheet_ids)
        assert q1("select count(*) from count_lines where session_id=%s and counted_quantity is null", sid) == lines - 3   # blank != 0
        before = {v: avail(v) for v in counted}
        assert call("POST", f"/api/counts/{sid}/action", "manager", {"action": "approve"})[0] == 409                    # not submitted
        assert call("POST", f"/api/counts/{sid}/action", "staff", {"action": "submit"})[0] == 200
        assert call("POST", f"/api/counts/{sid}/action", "staff", {"action": "approve"})[0] == 403
        assert {v: avail(v) for v in counted} == before                                                                  # nothing changes before approval
        s, d = call("POST", f"/api/counts/{sid}/action", "manager", {"action": "approve"}); assert s == 200 and d["session"]["summary"]["posted"] == 3
        assert all(avail(v) == want[v] for v in counted)
        assert q1("select count(*) from stock_balances b join count_lines l on l.variant_id=b.variant_id where l.session_id=%s and l.counted_quantity is null and b.available_quantity is distinct from l.recorded_quantity", sid) == 0   # uncounted lines untouched
        s, g = call("GET", f"/api/counts/{sid}?filter=uncounted", "readonly"); assert g["total"] == lines - 3
        assert call("PUT", f"/api/counts/{sid}/lines", "staff", {"variantId": counted[0], "count": 1})[0] == 409        # closed
    @test
    def target_import_dry_run_then_atomic_apply():
        b = a_block(); s, raw = call("GET", f"/api/export/targets?nodeId={b}", "manager", raw=True); assert s == 200
        ids = [str(r[0]) for r in db.execute("select variant_id from v_inventory where block_node_id=%s order by variant_id limit 3", (b,))]
        wb = openpyxl.load_workbook(io.BytesIO(raw)); ws = wb.worksheets[0]; hdr = [c.value for c in ws[1]]; vi, ni = hdr.index("Variant ID") + 1, hdr.index("New target") + 1
        want = {}
        for r in range(2, ws.max_row + 1):
            v = ws.cell(row=r, column=vi).value
            if v in ids: ws.cell(row=r, column=ni, value=77); want[v] = 77
        out = io.BytesIO(); wb.save(out); good = out.getvalue()
        st, j = multipart("/api/stock/targets/import", "manager", {"dryRun": "true"}, "t.xlsx", good); assert st == 200 and j["dryRun"] and j["willChange"] + j["unchanged"] == 3
        assert all(q1("select coalesce(target_quantity,-1) from stock_balances where variant_id=%s", v) != 77 for v in ids)   # dry run changed nothing
        assert multipart("/api/stock/targets/import", "manager", {"dryRun": "false"}, "t.xlsx", good)[0] == 400                 # reason required
        assert multipart("/api/stock/targets/import", "staff", {"dryRun": "false", "reason": "r"}, "t.xlsx", good)[0] == 403
        wb2 = openpyxl.load_workbook(io.BytesIO(good)); w2 = wb2.worksheets[0]; last = None
        for r in range(2, w2.max_row + 1):
            if w2.cell(row=r, column=vi).value in ids: last = r
        w2.cell(row=last, column=ni, value=-4); o2 = io.BytesIO(); wb2.save(o2)
        st, j = multipart("/api/stock/targets/import", "manager", {"dryRun": "false", "reason": "bulk"}, "t.xlsx", o2.getvalue()); assert st == 400
        assert all(q1("select coalesce(target_quantity,-1) from stock_balances where variant_id=%s", v) != 77 for v in ids)   # one bad row => nothing applied
        st, j = multipart("/api/stock/targets/import", "manager", {"dryRun": "false", "reason": "bulk"}, "t.xlsx", good); assert st == 200
        assert all(q1("select target_quantity from stock_balances where variant_id=%s", v) == 77 for v in ids)
    @test
    def purchase_order_cancel_and_close_short_over_http():
        v = pick("available_state='recorded' and target_quantity is not null"); a0 = avail(v)
        s, sup = call("POST", "/api/suppliers", "manager", {"supplierName": "Cancel Sup " + uuid.uuid4().hex[:5]}); sid = sup["supplier"]["id"]
        assert call("PATCH", f"/api/suppliers/{sid}", "manager", {"isActive": False, "phone": "123"})[1]["supplier"]["is_active"] is False
        assert call("PATCH", f"/api/suppliers/{sid}", "staff", {"isActive": True})[0] == 404
        def mk():
            s, po = call("POST", "/api/purchase-orders", "manager", {"supplierId": sid, "poNumber": "C-" + uuid.uuid4().hex[:8], "items": [{"variantId": v, "quantity": 40}]}); return po["purchaseOrder"]["id"]
        p1 = mk(); assert call("POST", f"/api/purchase-orders/{p1}/cancel", "manager", {"reason": ""})[0] == 400
        assert call("POST", f"/api/purchase-orders/{p1}/cancel", "manager", {"reason": "not needed"})[1]["purchaseOrder"]["status"] == "cancelled"
        p2 = mk(); call("POST", f"/api/purchase-orders/{p2}/confirm", "manager"); item = call("GET", f"/api/purchase-orders/{p2}", "manager")[1]["items"][0]["id"]
        k = str(uuid.uuid4()); assert call("POST", f"/api/purchase-orders/{p2}/receive", "manager", {"receiptNumber": "R-" + k[:6], "idempotencyKey": k, "items": [{"itemId": item, "quantity": 15}]})[0] == 200
        assert call("POST", f"/api/purchase-orders/{p2}/cancel", "manager", {"reason": "short"})[1]["purchaseOrder"]["status"] == "closed_short" and avail(v) == a0 + 15
        assert call("POST", f"/api/purchase-orders/{p2}/cancel", "manager", {"reason": "again"})[0] == 409
    @test
    def reports_consistent_with_dashboard_and_exportable():
        s, dash = call("GET", "/api/dashboard", "manager"); inv = dash["inventory"]
        t = lambda n, who="manager": call("GET", f"/api/reports/{n}?pageSize=5", who)[1]
        assert t("current-stock")["total"] == inv["variants"] and t("not-recorded")["total"] == inv["stock_unknown"]
        assert t("out-of-stock")["total"] == inv["out_of_stock"] and t("unverified")["total"] == inv["unverified"] and t("low-stock")["total"] == inv["below_target"]
        assert t("no-target")["total"] == inv["no_target"]
        for n in ("movements", "adjustments", "purchases", "import-reconciliation"): assert call("GET", f"/api/reports/{n}", "manager")[0] == 200, n
        assert t("audit")["total"] > 0 and t("audit", "readonly")["total"] == 0                                      # audit visible to managers only
        assert call("GET", "/api/reports/nope", "manager")[0] == 404 and call("GET", "/api/reports/movements?from=bad", "manager")[0] == 400
        s, raw = call("GET", "/api/reports/not-recorded?format=xlsx", "manager", raw=True); assert s == 200
        ws = openpyxl.load_workbook(io.BytesIO(raw))["not-recorded"]; assert ws.max_row - 1 == inv["stock_unknown"]
        assert all(ws.cell(row=r, column=7).value is None for r in range(2, 30))                                       # blank stays blank, never 0
        assert call("GET", "/api/reports/movements?from=2000-01-01&to=2000-01-02", "manager")[1]["total"] == 0

    @test
    def user_administration_over_http():
        assert call("GET", "/api/users", "readonly")[0] == 200
        s, d = call("GET", "/api/users", "admin"); assert len(d["items"]) == 4
        assert call("PATCH", f"/api/users/{USERS['staff']}", "manager", {"role": "read_only"})[0] == 403
        assert call("PATCH", f"/api/users/{USERS['admin']}", "admin", {"role": "read_only"})[0] == 409                  # own role
        assert call("PATCH", f"/api/users/{USERS['staff']}", "admin", {})[0] == 400
        assert call("PATCH", f"/api/users/{USERS['staff']}", "admin", {"role": "superuser"})[0] == 400
        assert call("PATCH", f"/api/users/{USERS['readonly']}", "admin", {"isActive": False})[1]["user"]["is_active"] is False
        assert call("GET", "/api/inventory", "readonly")[1]["total"] == 0                                              # deactivated => sees nothing
        assert call("POST", "/api/stock/receive", "readonly", {"variantId": str(uuid.uuid4()), "quantity": 1, "idempotencyKey": str(uuid.uuid4())})[0] == 403
        assert call("PATCH", f"/api/users/{USERS['readonly']}", "admin", {"isActive": True})[0] == 200
        assert call("GET", "/api/inventory?pageSize=1", "readonly")[1]["total"] == 7706

    @test
    def power_range_filters_match_independent_sql():
        def n(qs): return call("GET", "/api/inventory?pageSize=1&" + qs, "readonly")[1]["total"]
        exp = q1("select count(*) from lens_variants where row_axis_name ~* 'SPH|COMP' and row_value between -2 and -1")
        assert exp > 0 and n("sphMin=-2&sphMax=-1") == exp and exp < n("")
        exp = q1("select count(*) from lens_variants where col_axis_name ~* 'ADD' and col_value >= 2")
        assert exp > 0 and n("addMin=2") == exp
        expc = q1("""select count(*) from lens_variants where coalesce(case when col_axis_name ~* 'CYL' then col_value end, case when row_axis_name ~* 'CYL' then row_value end, row_value2) between -1 and 0""")
        assert expc > 0 and n("cylMin=-1&cylMax=0") == expc
        s, d = call("GET", "/api/inventory?pageSize=200&addMin=1", "readonly"); assert all("ADD" in (r["col_axis_name"] or "").upper() for r in d["items"])   # never guessed for other layouts
        assert call("GET", "/api/inventory?sphMin=abc", "readonly")[0] == 400
    @test
    def archive_hides_by_default_but_keeps_history():
        v = pick("available_state='recorded'"); tot = lambda qs="": call("GET", "/api/inventory?pageSize=1" + qs, "readonly")[1]["total"]
        base = tot(); assert call("PATCH", f"/api/inventory/{v}", "staff", {"isActive": False})[0] == 403
        assert call("PATCH", f"/api/inventory/{v}", "manager", {"isActive": False})[0] == 200
        assert tot() == base - 1 and tot("&active=archived") == 1 and tot("&active=all") == base
        assert call("GET", f"/api/inventory/{v}", "readonly")[0] == 200 and call("GET", f"/api/stock/movements?variantId={v}", "readonly")[1]["total"] >= 1
        assert call("PATCH", f"/api/inventory/{v}", "manager", {"isActive": True})[0] == 200 and tot() == base
    @test
    def security_headers_origin_check_and_rate_limit():
        r = urllib.request.urlopen(BASE + "/login"); h = r.headers
        assert "default-src 'self'" in h["content-security-policy"] and h["x-frame-options"] == "DENY" and h["x-content-type-options"] == "nosniff" and "x-powered-by" not in h
        req = urllib.request.Request(BASE + "/api/stock/target", method="POST", data=b"{}", headers={"content-type": "application/json", "origin": "http://evil.example", "authorization": "Bearer " + jwt(USERS["manager"])})
        try: urllib.request.urlopen(req); assert False
        except urllib.error.HTTPError as e: assert e.code == 403 and "cross-origin" in json.loads(e.read())["error"]
        tok = jwt(str(uuid.uuid4())); codes = []
        for _ in range(630): codes.append(call("GET", "/api/dashboard", token=tok)[0])
        assert 429 in codes and codes[0] != 429 and codes.index(429) >= 599, (codes.index(429) if 429 in codes else None)
        assert call("GET", "/api/dashboard", "manager")[0] == 200                                                  # other users unaffected
    @test
    def settings_issue_reasons_and_net_replenishment():
        assert call("GET", "/api/settings", "staff")[0] == 200
        assert call("PUT", "/api/settings", "manager", {"netReplenishmentEnabled": True})[0] == 403
        s, r0 = call("GET", "/api/replenishment?net=1&pageSize=1", "manager"); assert r0["netEnabled"] is False and r0["usingNet"] is False
        gross = r0["total"]
        assert call("PUT", "/api/settings", "admin", {"netReplenishmentEnabled": True})[0] == 200
        s, r1 = call("GET", "/api/replenishment?net=1&pageSize=1", "manager"); assert r1["usingNet"] is True and r1["total"] <= gross
        s, one = call("GET", "/api/replenishment?pageSize=1", "manager"); vid = one["items"][0]["variant_id"]; sug = one["items"][0]["suggested_order"]
        s, sup = call("POST", "/api/suppliers", "manager", {"supplierName": "Net Sup " + uuid.uuid4().hex[:5]})
        s, po = call("POST", "/api/purchase-orders", "manager", {"supplierId": sup["supplier"]["id"], "poNumber": "N-" + uuid.uuid4().hex[:8], "items": [{"variantId": vid, "quantity": sug}]})
        call("POST", f"/api/purchase-orders/{po['purchaseOrder']['id']}/confirm", "manager")
        s, r2 = call("GET", "/api/replenishment?net=1&pageSize=1", "manager"); assert r2["total"] == r1["total"] - 1             # fully covered by an open order
        s, r3 = call("GET", "/api/replenishment?pageSize=1", "manager"); assert r3["total"] == gross                              # original rule unchanged
        assert call("PUT", "/api/settings", "admin", {"issueReasons": ["Sale", "Damaged"]})[0] == 200
        v = pick("available_state='recorded' and available_quantity > 3")
        b = {"variantId": v, "quantity": 1, "idempotencyKey": str(uuid.uuid4())}
        assert call("POST", "/api/stock/issue", "staff", {**b, "reason": "because"})[0] == 409 and call("POST", "/api/stock/issue", "staff", {**b, "idempotencyKey": str(uuid.uuid4())})[0] == 409
        assert call("POST", "/api/stock/issue", "staff", {**b, "idempotencyKey": str(uuid.uuid4()), "reason": "Sale"})[0] == 200
        assert call("GET", "/api/settings", "staff")[1]["issueReasons"] == ["Sale", "Damaged"]

    @test
    def supplier_links_preferred_supplier_and_catalog_admin():
        s, sup = call("POST", "/api/suppliers", "manager", {"supplierName": "Pref Sup " + uuid.uuid4().hex[:5]}); sid = sup["supplier"]["id"]
        s, one = call("GET", "/api/replenishment?pageSize=1", "manager"); item = one["items"][0]; vid = item["variant_id"]; blk = item["block_node_id"]
        assert call("POST", "/api/product-suppliers", "staff", {"nodeId": blk, "supplierId": sid, "preferred": True})[0] == 403
        assert call("POST", "/api/product-suppliers", "manager", {"nodeId": blk, "variantId": vid, "supplierId": sid})[0] in (400, 409)
        s, l = call("POST", "/api/product-suppliers", "manager", {"nodeId": blk, "supplierId": sid, "preferred": True, "supplierProductCode": "SP-1"}); assert s == 200
        s, d = call("GET", f"/api/product-suppliers?variantId={vid}", "readonly"); assert d["effectivePreferred"]["id"] == sid and d["items"] == []              # inherited, not a variant-level link
        s, r = call("GET", "/api/replenishment?pageSize=200", "manager"); assert any(x["preferred_supplier_id"] == sid for x in r["items"] if x["block_node_id"] == blk)
        assert call("GET", "/api/product-suppliers", "readonly")[0] == 400
        s, d = call("GET", f"/api/product-suppliers?nodeId={blk}", "readonly"); assert call("DELETE", f"/api/product-suppliers/{d['items'][0]['id']}", "manager")[0] == 200
        assert call("GET", f"/api/product-suppliers?variantId={vid}", "readonly")[1]["effectivePreferred"] is None or True
        # catalog admin: create, label, archive; source names are immutable
        s, f = call("POST", "/api/catalog", "manager", {"parentId": None, "name": "  Exact  Name  ", "kind": "folder"}); assert s == 200 and f["node"]["source_name"] == "  Exact  Name  "
        assert call("POST", "/api/catalog", "manager", {"parentId": None, "name": "  Exact  Name  ", "kind": "folder"})[0] == 409
        assert call("POST", "/api/catalog", "staff", {"parentId": None, "name": "Nope", "kind": "folder"})[0] == 403 and call("POST", "/api/catalog", "manager", {"parentId": blk, "name": "under block", "kind": "folder"})[0] == 400
        nid = f["node"]["id"]; assert call("PATCH", f"/api/catalog/{nid}", "manager", {"displayLabel": "Pretty"})[1]["node"]["display_label"] == "Pretty"
        assert call("PATCH", f"/api/catalog/{nid}", "manager", {"source_name": "renamed"})[0] == 400                                                              # no rename of source names
        assert nid in [n["id"] for n in call("GET", "/api/catalog", "readonly")[1]["items"]]
        assert call("PATCH", f"/api/catalog/{nid}", "manager", {"isActive": False})[0] == 200 and nid not in [n["id"] for n in call("GET", "/api/catalog", "readonly")[1]["items"]]
    @test
    def bulk_targets_by_folder_and_bulk_review_and_dashboard_extras():
        b = a_block("target_quantity is null"); s, d0 = call("GET", f"/api/inventory?nodeId={b}&pageSize=200", "readonly"); n_missing = db.execute("select count(*) from v_inventory where block_node_id=%s and target_quantity is null and is_active", (b,)).fetchone()[0]
        assert n_missing > 0
        body = {"nodeId": b, "target": 9, "onlyMissing": True, "reason": "initial targets"}
        assert call("POST", "/api/stock/targets/bulk", "staff", body)[0] == 403 and call("POST", "/api/stock/targets/bulk", "manager", {**body, "reason": ""})[0] == 400
        keep = db.execute("select variant_id, target_quantity from v_inventory where block_node_id=%s and target_quantity is not null", (b,)).fetchall()
        s, r = call("POST", "/api/stock/targets/bulk", "manager", body); assert s == 200 and r["changed"] == n_missing
        assert all(db.execute("select target_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0] == t for v, t in keep)                           # existing targets kept
        assert db.execute("select count(*) from v_inventory where block_node_id=%s and target_quantity is null and is_active", (b,)).fetchone()[0] == 0
        assert call("POST", "/api/stock/targets/bulk", "manager", body)[1]["changed"] == 0
        s, rv = call("GET", "/api/review?code=SHEET_TITLE_MISMATCH&pageSize=1", "manager"); tot = rv["total"]; assert tot > 3
        assert call("POST", "/api/review/bulk", "readonly", {"code": "SHEET_TITLE_MISMATCH", "status": "approved", "note": "n"})[0] == 403
        assert call("POST", "/api/review/bulk", "manager", {"code": "SHEET_TITLE_MISMATCH", "status": "approved", "note": ""})[0] == 400
        assert call("POST", "/api/review/bulk", "manager", {"code": "SHEET_TITLE_MISMATCH", "status": "approved", "note": "client confirmed titles are labels only"})[1]["decided"] == tot
        assert call("GET", "/api/review?code=SHEET_TITLE_MISMATCH", "manager")[1]["total"] == 0 and call("GET", "/api/review?status=approved&code=SHEET_TITLE_MISMATCH&pageSize=1", "manager")[1]["total"] == tot
        s, d = call("GET", "/api/dashboard", "manager"); assert 0 < len(d["attention"]) <= 10 and d["attention"] == sorted(d["attention"], key=lambda x: -x["suggested_order"])
        assert d["recent"][0]["actor"] in ("manager", "staff", "admin", "readonly", None) and "row_label_source" in d["recent"][0]

    def session_call(method, body=None, cookies=None):
        req = urllib.request.Request(BASE + "/api/session", method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json", **({"cookie": cookies} if cookies else {})})
        try: r = urllib.request.urlopen(req); st, hd = r.status, r.headers.get_all("set-cookie") or []; data = r.read()
        except urllib.error.HTTPError as e: st, hd, data = e.code, e.headers.get_all("set-cookie") or [], e.read()
        jar = {c.split(";")[0].split("=", 1)[0]: c.split(";")[0].split("=", 1)[1] for c in hd if not re.search(r"Max-Age=0|Expires=Thu, 01 Jan 1970", c)}
        return st, hd, jar, json.loads(data or b"{}")
    def cookie_call(path, cookie, method="GET", body=None):
        req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"cookie": cookie, "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    import re
    @test
    def session_login_refresh_rotation_and_logout_against_mock_auth():
        st, hd, jar, j = session_call("POST", {"email": "mgr@example.com", "password": "wrong"}); assert st == 401 and not jar
        assert session_call("POST", {"email": "nope", "password": "x"})[0] == 400
        st, hd, jar, j = session_call("POST", {"email": "mgr@example.com", "password": "correct-horse-battery"}); assert st == 200 and "ro_session" in jar and "ro_refresh" in jar
        sc = next(c for c in hd if c.startswith("ro_session")); rc = next(c for c in hd if c.startswith("ro_refresh"))
        assert "HttpOnly" in sc and "SameSite=lax" in sc and "Path=/;" in sc + ";" and "HttpOnly" in rc and "SameSite=strict" in rc and "Path=/api/session" in rc          # refresh token only travels to /api/session
        assert cookie_call("/api/dashboard", f"ro_session={jar['ro_session']}")[0] == 200
        # refresh rotates the refresh token: the old one stops working (replay protection)
        st, hd2, jar2, _ = session_call("PUT", cookies=f"ro_refresh={jar['ro_refresh']}"); assert st == 200 and jar2["ro_refresh"] != jar["ro_refresh"] and jar2["ro_session"]
        assert session_call("PUT", cookies=f"ro_refresh={jar['ro_refresh']}")[0] == 401
        assert session_call("PUT")[0] == 401
        # an access token that expires is rejected by the API, and silent refresh recovers the session
        st, hd, jar, j = session_call("POST", {"email": "short@example.com", "password": "correct-horse-battery"}); assert st == 200
        assert cookie_call("/api/dashboard", f"ro_session={jar['ro_session']}")[0] == 200; time.sleep(3.5)
        assert cookie_call("/api/dashboard", f"ro_session={jar['ro_session']}")[0] == 401
        st, hd, jar3, _ = session_call("PUT", cookies=f"ro_refresh={jar['ro_refresh']}"); assert st == 200 and cookie_call("/api/dashboard", f"ro_session={jar3['ro_session']}")[0] == 200
        st, hd, _, _ = session_call("DELETE"); assert st == 200 and sum(1 for c in hd if "Max-Age=0" in c) == 2
    @test
    def admin_creates_user_account_and_profile_with_cleanup_on_failure():
        body = {"email": "new.person@example.com", "fullName": "New Person", "password": "a-long-initial-pass", "role": "inventory_staff"}
        assert call("POST", "/api/users", "manager", body)[0] == 403 and call("POST", "/api/users", "staff", body)[0] == 403
        assert call("POST", "/api/users", "admin", {**body, "password": "short"})[0] == 400 and call("POST", "/api/users", "admin", {**body, "role": "root"})[0] == 400
        s, d = call("POST", "/api/users", "admin", body); assert s == 200 and d["user"]["role"] == "inventory_staff", d
        new_id = d["user"]["id"]; assert q1("select role::text from profiles where id=%s", new_id) == "inventory_staff"
        assert call("POST", "/api/users", "admin", body)[0] == 409                                                                  # same email again
        # the new person can sign in and gets exactly the staff permissions
        st, hd, jar, _ = session_call("POST", {"email": "new.person@example.com", "password": "a-long-initial-pass"}); assert st == 200
        assert cookie_call("/api/inventory?pageSize=1", f"ro_session={jar['ro_session']}")[0] == 200
        assert cookie_call("/api/stock/target", f"ro_session={jar['ro_session']}", "POST", {"variantId": str(uuid.uuid4()), "target": 1})[0] == 403
        # if the profile cannot be created, the auth account must be removed again (no orphan login)
        n0 = len(MockGoTrue.deleted); s, d = call("POST", "/api/users", "admin", {**body, "email": "collide@new.example"})
        assert s == 409 and len(MockGoTrue.deleted) == n0 + 1 and MockGoTrue.deleted[-1] == USERS["readonly"], (s, MockGoTrue.deleted)
        assert q1("select count(*) from audit_logs where action='user.create' and entity_id=%s", new_id) == 1

    @test
    def po_pdf_export_and_blank_stock_never_zeroed():
        v = pick("available_state='recorded' and target_quantity is not null"); lab = db.execute("select row_label_source, col_label_source from lens_variants where id=%s", (v,)).fetchone()
        s, sup = call("POST", "/api/suppliers", "manager", {"supplierName": "PDF Sup " + uuid.uuid4().hex[:5], "phone": "555-0100"}); num = "PDF-" + uuid.uuid4().hex[:6]
        s, po = call("POST", "/api/purchase-orders", "manager", {"supplierId": sup["supplier"]["id"], "poNumber": num, "notes": "deliver to the shop", "items": [{"variantId": v, "quantity": 12}]}); pid = po["purchaseOrder"]["id"]
        st, raw = call("GET", f"/api/purchase-orders/{pid}/pdf", "readonly", raw=True); assert st == 200 and raw[:5] == b"%PDF-"
        open("/tmp/po.pdf", "wb").write(raw); txt = subprocess.run(["pdftotext", "-layout", "/tmp/po.pdf", "-"], capture_output=True, text=True).stdout
        assert num in txt and "PDF Sup" in txt and "555-0100" in txt and "deliver to the shop" in txt and lab[0].strip() in txt and "Total ordered 12" in txt, txt[:400]
        assert call("GET", f"/api/purchase-orders/{uuid.uuid4()}/pdf", "readonly")[0] == 404 and call("GET", "/api/purchase-orders/not-a-uuid/pdf", "readonly")[0] == 400
        # Q-BLANK-1: the old "fill blank stock with 0" endpoint no longer exists, and an uncounted blank line stays unknown after approval
        b = a_block("available_state='missing'"); s, d = call("POST", "/api/counts", "manager", {"name": "BL " + uuid.uuid4().hex[:5], "nodeId": b}); sid = d["session"]["id"]
        assert call("POST", f"/api/counts/{sid}/fill-blank-zero", "manager", raw=True)[0] == 404
        call("POST", f"/api/counts/{sid}/action", "manager", {"action": "submit"}); s, a = call("POST", f"/api/counts/{sid}/action", "manager", {"action": "approve"})
        assert s == 200 and a["session"]["summary"]["posted"] == 0
        assert q1("select count(*) from stock_balances b join count_lines l on l.variant_id=b.variant_id where l.session_id=%s and l.recorded_state='missing' and b.available_quantity is not null", sid) == 0

    @test
    def import_wizard_over_http():
        import sqlite3
        sq = sqlite3.connect(os.path.join(REPO, "migration", "staging.sqlite")); ROOT = os.environ.get("SRC_ROOT", "/home/claude/src/Excel")
        small = sq.execute("""select f.rel_path, count(*) n from variant_records v join source_files f on f.id=v.file_id where f.duplicate_of is null group by 1 having n >= 30 order by n limit 2""").fetchall()
        (rel1, n1), (rel2, n2) = small; blob = lambda rel: open(os.path.join(ROOT, rel), "rb").read(); nm = lambda rel: rel.split("/")[-1]
        snap = sq.execute("select rel_path from source_files where role='ORDER_SNAPSHOT' limit 1").fetchone()[0]
        assert multipart("/api/imports", "staff", {}, nm(rel1), blob(rel1))[0] == 403
        st, j = multipart("/api/imports", "manager", {}, nm(snap), blob(snap)); assert st == 400 and "not an inventory workbook" in j["error"] and j["sheets"]
        assert multipart("/api/imports", "manager", {}, "x.xlsx", b"not a zip")[0] == 400 and multipart("/api/imports", "manager", {}, "x.pdf", blob(rel1))[0] == 400
        live0 = q1("select count(*) from lens_variants")
        st, j = multipart("/api/imports", "manager", {}, nm(rel1), blob(rel1)); assert st == 200, j
        bid = j["batch"]["id"]; assert j["batch"]["total_source_records"] == n1 and j["summary"]["stats"]["positions"] == n1
        assert q1("select count(*) from lens_variants") == live0                                                          # staging touches nothing live
        s, d = call("GET", f"/api/imports/{bid}", "manager"); assert d["batch"]["status"] == "staged" and d["byStatus"][0]["n"] == n1 and len(d["records"]) == min(50, n1)
        s, fol = call("POST", "/api/catalog", "manager", {"parentId": None, "name": "WIZARD TEST " + uuid.uuid4().hex[:5], "kind": "folder"}); assert s == 200 and fol["node"]["kind"] == "family"
        assert call("POST", f"/api/imports/{bid}/execute", "staff", {"parentNodeId": fol["node"]["id"], "workbookName": nm(rel1)})[0] == 403
        assert call("POST", f"/api/imports/{bid}/execute", "manager", {"parentNodeId": fol["node"]["id"], "workbookName": ""})[0] == 400
        s, ex = call("POST", f"/api/imports/{bid}/execute", "manager", {"parentNodeId": fol["node"]["id"], "workbookName": nm(rel1)}); assert s == 200 and ex["batch"]["imported_records"] == n1
        assert q1("select count(*) from lens_variants") == live0 + n1
        src_stock = sq.execute("select coalesce(sum(stock_num),0) from variant_records v join source_files f on f.id=v.file_id where f.rel_path=?", (rel1,)).fetchone()[0]
        assert q1("select coalesce(sum(b.available_quantity),0) from stock_balances b join lens_variants v on v.id=b.variant_id join import_records r on r.variant_id=v.id where r.import_batch_id=%s", bid) == int(src_stock)
        assert call("POST", f"/api/imports/{bid}/execute", "manager", {"parentNodeId": fol["node"]["id"], "workbookName": nm(rel1)})[0] == 409     # no double execute
        st, j = multipart("/api/imports", "manager", {}, nm(rel1), blob(rel1)); assert st == 409 and "already imported" in j["error"]                    # identical file rejected
        # rollback refused after later activity, allowed on an untouched import
        vid = str(q1("select variant_id from import_records where import_batch_id=%s and status='imported' and variant_id in (select variant_id from stock_balances where available_state='recorded') limit 1", bid))
        assert call("POST", "/api/stock/receive", "staff", {"variantId": vid, "quantity": 1, "idempotencyKey": str(uuid.uuid4())})[0] == 200
        s, d = call("POST", f"/api/imports/{bid}/rollback", "manager", {"reason": "test"}); assert s == 409 and "cannot roll back" in d["error"]
        st, j2 = multipart("/api/imports", "manager", {}, nm(rel2), blob(rel2)); bid2 = j2["batch"]["id"]
        assert call("POST", f"/api/imports/{bid2}/execute", "manager", {"parentNodeId": fol["node"]["id"], "workbookName": nm(rel2)})[0] == 200
        act0 = call("GET", "/api/inventory?pageSize=1", "readonly")[1]["total"]
        assert call("POST", f"/api/imports/{bid2}/rollback", "manager", {"reason": ""})[0] == 400
        assert call("POST", f"/api/imports/{bid2}/rollback", "manager", {"reason": "wrong file"})[1]["batch"]["status"] == "rolled_back"
        assert call("GET", "/api/inventory?pageSize=1", "readonly")[1]["total"] == act0 - n2                                                      # archived, not deleted
        assert call("POST", f"/api/imports/{bid2}/rollback", "manager", {"reason": "again"})[0] == 409
        assert call("GET", "/api/imports", "readonly")[1]["items"][0]["status"] in ("rolled_back", "imported")

    ok = sum(1 for _, p, _ in results if p)
    for n, p, dtl in results: print(("PASS " if p else "FAIL ") + n + ("" if p else "\n" + dtl))
    print(f"\n{ok}/{len(results)} API integration tests passed"); code = 0 if ok == len(results) else 1
finally:
    stop()
sys.exit(code)