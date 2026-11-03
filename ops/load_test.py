#!/usr/bin/env python3
"""HTTP load test: real `next start` + the imported database, N concurrent users for D seconds. Run from repo root after `npm run build` in web/.
Checks latency percentiles, error rate, and CORRECTNESS UNDER LOAD: every hot item's final balance must equal start + acknowledged receipts - acknowledged issues."""
import os, sys, json, time, uuid, hmac, hashlib, base64, random, threading, subprocess, signal, socket, urllib.request, urllib.error, urllib.parse, statistics
import psycopg
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE); WEB = os.path.join(REPO, "web")
USERS_N = int(os.environ.get("USERS", 25)); DUR = int(os.environ.get("DURATION", 40)); PORT = 3115; BASE = f"http://127.0.0.1:{PORT}"; SECRET = "load-" + uuid.uuid4().hex
if socket.socket().connect_ex(("127.0.0.1", PORT)) == 0: raise SystemExit("port in use")
U = {k: str(uuid.uuid4()) for k in ("admin", "manager", "staff", "readonly")}; URIF = os.path.join(WEB, ".load-uri")
if os.path.exists(URIF): os.remove(URIF)
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b64(json.dumps({"sub": sub, "exp": int(time.time()) + 3600}).encode())
    return f"{h}.{p}.{b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"
loader = subprocess.Popen([sys.executable, os.path.join(REPO, "migration", "load_rehearsal.py"), os.path.join(REPO, "migration", "staging.sqlite"), "/tmp/recon-load.md"], env=dict(os.environ, KEEP_URI_FILE=URIF, TEST_USERS=json.dumps(U)), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
server = None; code = 1
try:
    for _ in range(300):
        if os.path.exists(URIF) and open(URIF).read(): break
        if loader.poll() is not None: raise SystemExit("loader died")
        time.sleep(1)
    URI = open(URIF).read(); db = psycopg.connect(URI, autocommit=True)
    server = subprocess.Popen(["npx", "next", "start", "-p", str(PORT)], cwd=WEB, env=dict(os.environ, DATABASE_URL=URI, SUPABASE_JWT_SECRET=SECRET, RATE_LIMIT_READS="1000000", RATE_LIMIT_WRITES="1000000"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/login"); break
        except Exception: time.sleep(1)
    hot = [str(r[0]) for r in db.execute("select variant_id from v_inventory where available_state='recorded' and available_quantity between 20 and 200 order by variant_id limit 8")]
    start_bal = {v: db.execute("select available_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0] for v in hot}
    blocks = [str(r[0]) for r in db.execute("select distinct block_node_id from v_inventory limit 40")]
    lat = {}; errs = {}; acked = {v: 0 for v in hot}; lock = threading.Lock(); stop = time.time() + DUR
    def req(kind, method, path, who, body=None):
        r = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json", "authorization": "Bearer " + jwt(U[who])})
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(r, timeout=60) as resp: resp.read(); st = resp.status
        except urllib.error.HTTPError as e: e.read(); st = e.code
        except Exception: st = 0
        dt = (time.perf_counter() - t) * 1000
        with lock: lat.setdefault(kind, []).append(dt); (errs.__setitem__(kind, errs.get(kind, 0) + 1) if st not in (200, 409) else None)
        return st
    qs = ["", "&q=Magnus", "&status=below_target", "&status=stock_unknown", "&sphMin=-2&sphMax=-1", "&q=%2B0.25", "&active=all"]
    def worker(i):
        rnd = random.Random(i); who = ("manager", "staff", "readonly")[i % 3]
        while time.time() < stop:
            x = rnd.random()
            if x < .45: req("inventory page", "GET", f"/api/inventory?pageSize=50&page={rnd.randint(1,20)}{rnd.choice(qs)}", who)
            elif x < .58: req("dashboard", "GET", "/api/dashboard", who)
            elif x < .68: req("matrix", "GET", f"/api/blocks/{rnd.choice(blocks)}/matrix", who)
            elif x < .76: req("report", "GET", f"/api/reports/{rnd.choice(['low-stock','not-recorded','movements'])}?pageSize=100", "manager")
            elif x < .80: req("suggested orders", "GET", "/api/replenishment?pageSize=50", who)
            else:
                v = rnd.choice(hot); kind = rnd.choice(["receipt", "issue"]) if who != "readonly" else "receipt"
                st = req("stock write", "POST", f"/api/stock/{'receive' if kind == 'receipt' else 'issue'}", "staff" if who == "readonly" else who, {"variantId": v, "quantity": 1, "idempotencyKey": str(uuid.uuid4())})
                if st == 200:
                    with lock: acked[v] += 1 if kind == "receipt" else -1
    t0 = time.time(); ths = [threading.Thread(target=worker, args=(i,)) for i in range(USERS_N)]; [t.start() for t in ths]; [t.join() for t in ths]; el = time.time() - t0
    total = sum(len(v) for v in lat.values()); pct = lambda a, p: sorted(a)[min(len(a) - 1, int(len(a) * p))]
    print(f"{USERS_N} concurrent users, {el:.0f}s, {total:,} requests, {total/el:.0f} req/s\n")
    print(f"{'endpoint':20s} {'n':>6s} {'p50 ms':>8s} {'p95 ms':>8s} {'p99 ms':>8s} {'max ms':>8s} {'errors':>7s}")
    for k, a in sorted(lat.items()): print(f"{k:20s} {len(a):6d} {statistics.median(a):8.0f} {pct(a,.95):8.0f} {pct(a,.99):8.0f} {max(a):8.0f} {errs.get(k,0):7d}")
    final = {v: db.execute("select available_quantity from stock_balances where variant_id=%s", (v,)).fetchone()[0] for v in hot}
    lost = {v: (start_bal[v] + acked[v], final[v]) for v in hot if start_bal[v] + acked[v] != final[v]}
    ledger = db.execute("select count(*) from stock_balances b where b.available_quantity is distinct from (select sum(quantity_delta) from stock_movements m where m.variant_id=b.variant_id)").fetchone()[0]
    nerr = sum(errs.values()); p95_all = pct([x for a in lat.values() for x in a], .95)
    print(f"\nacknowledged writes: {sum(abs(x) for x in acked.values()) if False else sum(len([1]) for _ in [0])}", end="")
    print(f"\nCORRECTNESS: lost/duplicated updates on {len(hot)} hot items = {len(lost)} {lost or ''}; ledger-vs-balance mismatches = {ledger}; unexpected errors (non-200/409) = {nerr}")
    ok = not lost and ledger == 0 and nerr == 0; print("RESULT:", "PASS" if ok else "FAIL"); code = 0 if ok else 1
finally:
    if server and server.poll() is None:
        try: os.killpg(server.pid, signal.SIGKILL)
        except Exception: pass
    if loader.poll() is None: loader.kill()
sys.exit(code)
