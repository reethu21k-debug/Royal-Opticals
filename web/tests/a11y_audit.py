#!/usr/bin/env python3
"""Browser E2E (Playwright/Chromium) against the real server + imported DB. Run from web/ after `npm run build`."""
import os, sys, json, time, uuid, hmac, hashlib, base64, subprocess, signal, socket, urllib.request, traceback
import psycopg
from playwright.sync_api import sync_playwright, expect
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.dirname(HERE); REPO = os.path.dirname(WEB)
SECRET = "e2e-" + uuid.uuid4().hex; PORT = 3114; BASE = f"http://127.0.0.1:{PORT}"
USERS = {k: str(uuid.uuid4()) for k in ("admin", "manager", "staff", "readonly")}; URIF = os.path.join(WEB, ".a11y-uri")
if os.path.exists(URIF): os.remove(URIF)
if socket.socket().connect_ex(("127.0.0.1", PORT)) == 0: raise SystemExit("port in use")
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub):
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b64(json.dumps({"sub": sub, "exp": int(time.time()) + 3600}).encode())
    return f"{h}.{p}.{b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())}"
loader = subprocess.Popen([sys.executable, os.path.join(REPO, "migration", "load_rehearsal.py"), os.path.join(REPO, "migration", "staging.sqlite"), "/tmp/recon-e2e.md"],
    env=dict(os.environ, KEEP_URI_FILE=URIF, TEST_USERS=json.dumps(USERS)), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
server = None; code = 1
try:
    for _ in range(300):
        if os.path.exists(URIF) and open(URIF).read(): break
        if loader.poll() is not None: raise SystemExit("loader died")
        time.sleep(1)
    URI = open(URIF).read()
    server = subprocess.Popen(["npx", "next", "start", "-p", str(PORT)], cwd=WEB, env=dict(os.environ, DATABASE_URL=URI, SUPABASE_JWT_SECRET=SECRET), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/login"); break
        except Exception: time.sleep(1)
    db = psycopg.connect(URI, autocommit=True); results = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(); 
        def ctx(who):
            c = br.new_context(viewport={"width": 1400, "height": 900}); c.add_cookies([{"name": "ro_session", "value": jwt(USERS[who]), "url": BASE}]); return c
        def audit_pages():
            pages = ["/", "/inventory", "/stock", "/counts", "/suppliers", "/purchase-orders", "/suggested-orders", "/reports", "/reports/not-recorded", "/review", "/users", "/settings", "/imports", "/catalog", "/movements", "/login"]
            vid = str(db.execute("select variant_id from v_inventory where available_state='recorded' limit 1").fetchone()[0]); blk = str(db.execute("select block_node_id from v_inventory limit 1").fetchone()[0])
            pages += [f"/inventory/{vid}", f"/blocks/{blk}"]
            axe = open(os.path.join(WEB, "node_modules/axe-core/axe.min.js")).read(); out = {}
            for who in ("admin",):
                for path in pages:
                    pg = ctx(who).new_page() if path != "/login" else br.new_context().new_page(); pg.goto(BASE + path); pg.wait_for_timeout(1200)
                    if path in ("/inventory", "/suggested-orders", "/reports/not-recorded", "/review"): pg.wait_for_selector("tbody tr", timeout=8000)
                    pg.evaluate(axe); r = pg.evaluate("axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa']}}).then(r => r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].html.slice(0,140)})))")
                    out[path] = r
            return out
        res = audit_pages(); br.close()
    import collections; agg = collections.defaultdict(lambda: {"pages": [], "n": 0, "impact": "", "help": "", "sample": ""})
    for path, vs in res.items():
        for v in vs: a = agg[v["id"]]; a["pages"].append(path); a["n"] += v["n"]; a["impact"] = v["impact"]; a["help"] = v["help"]; a["sample"] = v["sample"]
    print(f"AUDITED {len(res)} pages; distinct violation types: {len(agg)}")
    for k, a in sorted(agg.items(), key=lambda kv: kv[1]["impact"] or ""): print(f"- {k} [{a['impact']}] x{a['n']} on {len(a['pages'])} page(s): {a['help']}\n    e.g. {a['sample']}")
    code = 1 if agg else 0
    print('RESULT: ' + ('FAIL — accessibility violations found' if agg else 'PASS — 0 axe violations (WCAG 2.0/2.1 A+AA rules) on all audited pages'))
finally:
    if server and server.poll() is None:
        try: os.killpg(server.pid, signal.SIGKILL)
        except Exception: pass
    if loader.poll() is None: loader.kill()
sys.exit(code)
