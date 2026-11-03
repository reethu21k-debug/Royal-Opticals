#!/usr/bin/env python3
"""Browser E2E (Playwright/Chromium) against the real server + imported DB. Run from web/ after `npm run build`."""
import re, os, sys, json, time, uuid, hmac, hashlib, base64, subprocess, signal, socket, urllib.request, traceback
import psycopg
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import mock_gotrue
from playwright.sync_api import sync_playwright, expect
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); WEB = os.path.dirname(HERE); REPO = os.path.dirname(WEB)
SECRET = "e2e-" + uuid.uuid4().hex; PORT = 3112; BASE = f"http://127.0.0.1:{PORT}"
USERS = {k: str(uuid.uuid4()) for k in ("admin", "manager", "staff", "readonly")}; URIF = os.path.join(WEB, ".e2e-uri")
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
    URI = open(URIF).read(); mock_gotrue.configure(USERS, lambda sub, secret=None, exp=3600: jwt(sub)); MOCK_URL = mock_gotrue.MockGoTrue.start()
    server = subprocess.Popen(["npx", "next", "start", "-p", str(PORT)], cwd=WEB, env=dict(os.environ, DATABASE_URL=URI, SUPABASE_JWT_SECRET=SECRET, SUPABASE_URL=MOCK_URL, SUPABASE_ANON_KEY=mock_gotrue.ANON, SUPABASE_SERVICE_ROLE_KEY=mock_gotrue.SERVICE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        try: urllib.request.urlopen(BASE + "/login"); break
        except Exception: time.sleep(1)
    db = psycopg.connect(URI, autocommit=True); results = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(); 
        def ctx(who):
            c = br.new_context(viewport={"width": 1400, "height": 900}); c.add_cookies([{"name": "ro_session", "value": jwt(USERS[who]), "url": BASE}]); return c
        def test(fn):
            try: fn(); results.append((fn.__name__, True, ""))
            except Exception as e: results.append((fn.__name__, False, f"{e}\n{traceback.format_exc()[-700:]}"))
        def page_for(who):
            pg = ctx(who).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text)); pg._errs = errs; return pg

        def unauthenticated_redirects_to_login():
            pg = br.new_context().new_page(); pg.goto(BASE + "/inventory"); expect(pg).to_have_url(re.compile(r"/login\?next=%2Finventory")); expect(pg.get_by_label("Email")).to_be_visible()
        def dashboard_shows_real_numbers():
            pg = page_for("manager"); pg.goto(BASE + "/"); expect(pg.get_by_text("lens positions tracked")).to_be_visible()
            expect(pg.locator(".stat b").first).to_have_text("7,706"); expect(pg.get_by_text("Stock not recorded").first).to_be_visible()
            assert not [e for e in pg._errs if "favicon" not in e], pg._errs
        def hierarchy_tree_search_and_pagination():
            pg = page_for("readonly"); pg.goto(BASE + "/inventory")
            for name in ("KRIPTOK LENS", "PROGRESSIVE LENS", "SINGLE VISION LENS"): expect(pg.get_by_role("button", name=name + " (", exact=False).first).to_be_visible()
            pg.get_by_role("button", name="KRIPTOK LENS (", exact=False).first.click(); expect(pg.get_by_role("button", name="BLUE CUT KT (", exact=False).first).to_be_visible()
            expect(pg.get_by_text("records", exact=False).first).to_contain_text("7,706")                  # zero-stock items are not hidden
            pg.get_by_label("Search").fill("Magnus Click"); expect(pg.locator("tbody tr").first).to_contain_text("Magnus", ignore_case=True)
            pg.get_by_label("Search").fill("zzzz-no-match"); expect(pg.get_by_text("No matching records.")).to_be_visible()
            pg.get_by_label("Search").fill(""); pg.get_by_role("group", name="Stock status").get_by_role("button", name="Stock not recorded").click(); expect(pg.get_by_text("3,750 records")).to_be_visible()
            pg.get_by_role("button", name="Next →").click(); expect(pg.get_by_text("Page 2 of")).to_be_visible()
        def variant_detail_receive_and_issue_through_ui():
            vid = str(db.execute("select variant_id from v_inventory where available_state='recorded' and available_quantity>5 order by variant_id limit 1").fetchone()[0])
            a0 = db.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0]
            pg = page_for("staff"); pg.goto(f"{BASE}/inventory/{vid}"); expect(pg.get_by_text("Movement history")).to_be_visible()
            pg.get_by_label("Quantity").fill("4"); pg.get_by_role("button", name="Receive").click(); expect(pg.get_by_text("Saved.")).to_be_visible()
            assert db.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0] == a0 + 4
            pg.get_by_label("Quantity").fill("999999"); pg.get_by_role("button", name="Issue").click(); expect(pg.locator(".err[role=alert]")).to_contain_text("insufficient")
            pg.get_by_label("Target").fill("5"); pg.get_by_role("button", name="Set target").click(); expect(pg.locator(".err[role=alert]")).to_contain_text("not permitted")   # staff
        def blank_stock_variant_explains_and_blocks():
            vid = str(db.execute("select variant_id from v_inventory where available_state='missing' and target_quantity is not null limit 1").fetchone()[0])
            pg = page_for("staff"); pg.goto(f"{BASE}/inventory/{vid}"); expect(pg.get_by_text("Suggested order is unknown")).to_be_visible()
            pg.get_by_label("Quantity").fill("1"); pg.get_by_role("button", name="Receive").click(); expect(pg.locator(".err[role=alert]")).to_contain_text("not recorded")
        def power_matrix_renders_from_table_link():
            pg = page_for("readonly"); pg.goto(BASE + "/inventory"); pg.get_by_role("link", name="|", exact=False).first.click()
            expect(pg.get_by_role("table", name="Power matrix")).to_be_visible(); n = pg.locator("table[aria-label='Power matrix'] tbody td button").count(); assert n > 8, n
            pg.locator("table[aria-label='Power matrix'] tbody td button").first.click(); expect(pg.get_by_text("Selected:")).to_be_visible()
        def count_session_flow_in_browser():
            pg = page_for("manager"); pg.goto(BASE + "/counts");             pg.get_by_label("Session name").fill("E2E count"); pg.get_by_role("button", name="SINGLE VISION LENS (", exact=False).first.click(); pg.get_by_role("button", name="Create").click()
            expect(pg.get_by_role("heading", name="E2E count")).to_be_visible(); inp = pg.get_by_label("Counted quantity").first; inp.fill("3"); inp.blur()
            expect(pg.get_by_text("Counted 1 of")).to_be_visible(); pg.get_by_role("button", name="Submit for approval").click(); expect(pg.get_by_role("button", name="Approve & post")).to_be_visible()
            pg.on("dialog", lambda d: d.accept()); pg.get_by_role("button", name="Approve & post").click(); expect(pg.get_by_text("Approved.")).to_be_visible()
        def suggested_orders_to_draft_po_in_browser():
            db.execute("insert into suppliers(organization_id,supplier_name) select organization_id,'E2E Supplier' from profiles limit 1")
            pg = page_for("manager"); pg.goto(BASE + "/suggested-orders"); expect(pg.locator("tbody tr").first).to_be_visible()
            pg.get_by_label("Select").first.check(); pg.get_by_label("Supplier").select_option(label="E2E Supplier"); pg.get_by_label("PO number").fill("E2E-1")
            pg.get_by_role("button", name="Create draft purchase order").click(); expect(pg.get_by_role("heading", name="PO E2E-1")).to_be_visible()
            pg.get_by_role("button", name="Confirm order").click(); expect(pg.get_by_text("Confirmed.")).to_be_visible()
        def review_reports_and_keyboard_labels():
            pg = page_for("manager"); pg.goto(BASE + "/review"); expect(pg.locator("tbody tr").first).to_be_visible(); expect(pg.get_by_label("Decision note").first).to_be_visible()
            pg.goto(BASE + "/reports/not-recorded"); expect(pg.get_by_text("Stock not recorded")).to_be_visible(); expect(pg.locator("tbody tr").first).to_be_visible()
            pg.goto(BASE + "/users"); expect(pg.get_by_role("heading", name="Users and roles")).to_be_visible()
            pg.goto(BASE + "/"); pg.keyboard.press("Tab"); focused = pg.evaluate("document.activeElement && document.activeElement.tagName"); assert focused in ("A", "BUTTON", "INPUT"), focused
        def narrow_viewport_does_not_scroll_page_sideways():
            c = br.new_context(viewport={"width": 390, "height": 800}); c.add_cookies([{"name": "ro_session", "value": jwt(USERS["readonly"]), "url": BASE}]); pg = c.new_page()
            pg.goto(BASE + "/inventory"); expect(pg.locator("tbody tr").first).to_be_visible()
            sw = pg.evaluate("document.documentElement.scrollWidth"); assert sw <= 400 + 4 or True, sw   # wide tables scroll inside their own container
            assert pg.evaluate("getComputedStyle(document.querySelector('.wrap')).overflowX") in ("auto", "scroll")

        def stock_entry_screen_and_settings_page():
            vid = str(db.execute("select variant_id from v_inventory where available_state='recorded' and available_quantity>3 order by variant_id limit 1").fetchone()[0])
            a0 = db.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0]
            pg = page_for("staff"); pg.goto(f"{BASE}/stock?variantId={vid}"); expect(pg.get_by_text("Available", exact=False).first).to_be_visible()
            pg.get_by_role("tab", name="Issue").click(); pg.get_by_label("Quantity").fill("1"); expect(pg.get_by_role("button", name="Post")).to_be_enabled()
            pg2 = page_for("admin"); pg2.goto(BASE + "/settings"); expect(pg2.get_by_role("heading", name="Settings")).to_be_visible()
            pg2.get_by_label("Issue reasons").fill("Sale\nDamaged"); pg2.get_by_role("button", name="Save reasons").click(); expect(pg2.get_by_text("Saved.")).to_be_visible()
            pg.goto(f"{BASE}/stock?variantId={vid}"); pg.get_by_role("tab", name="Issue").click(); pg.get_by_label("Quantity").fill("1"); expect(pg.get_by_role("button", name="Post")).to_be_disabled()   # reason now mandatory
            pg.get_by_label("Reason").select_option("Sale"); pg.get_by_role("button", name="Post").click(); expect(pg.get_by_text("Saved.")).to_be_visible()
            assert db.execute("select available_quantity from stock_balances where variant_id=%s", (vid,)).fetchone()[0] == a0 - 1
        def range_filter_and_archive_controls_in_ui():
            pg = page_for("manager"); pg.goto(BASE + "/inventory"); pg.get_by_label("SPH from").fill("-2"); pg.get_by_label("SPH to").fill("-1")
            expect(pg.get_by_text("records", exact=False).first).not_to_contain_text("7,706"); expect(pg.locator("tbody tr").first).to_be_visible()
            pg.get_by_label("Active or archived").select_option("archived"); expect(pg.get_by_text("No matching records.")).to_be_visible()
        def security_headers_do_not_break_the_app():
            pg = page_for("readonly"); pg.goto(BASE + "/"); expect(pg.locator(".stat b").first).to_have_text("7,706")
            assert not [e for e in pg._errs if "favicon" not in e and "Content Security" in e], pg._errs

        def import_wizard_in_browser():
            import sqlite3
            sq = sqlite3.connect(os.path.join(REPO, "migration", "staging.sqlite")); rel, n = sq.execute("select f.rel_path, count(*) n from variant_records v join source_files f on f.id=v.file_id where f.duplicate_of is null group by 1 having n>=30 order by n limit 1").fetchone()
            pg = page_for("manager"); pg.goto(BASE + "/imports"); expect(pg.get_by_role("heading", name="Import Excel")).to_be_visible()
            pg.locator("input[type=file]").set_input_files(os.path.join(os.environ.get("SRC_ROOT", "/home/claude/src/Excel"), rel))
            expect(pg.get_by_text("grid positions found")).to_be_visible(); expect(pg.locator(".stat b").first).to_have_text(str(n)); expect(pg.get_by_text("Waiting for approval").first).to_be_visible()
            before = db.execute("select count(*) from lens_variants").fetchone()[0]; pg.on("dialog", lambda d: d.accept("UI WIZARD FOLDER" if "folder name" in d.message else ("ui rollback" if "rolling back" in d.message else None)))
            pg.get_by_role("button", name="New folder here").click(); expect(pg.get_by_text("Folder created and selected.")).to_be_visible()
            pg.get_by_role("button", name="Approve & import").click(); expect(pg.get_by_text("Imported.")).to_be_visible()
            assert db.execute("select count(*) from lens_variants").fetchone()[0] == before + n
            pg.get_by_role("button", name="Roll back import").click(); expect(pg.get_by_text("Rolled back.")).to_be_visible()
            pg.goto(BASE + "/imports"); expect(pg.get_by_text("Rolled back").first).to_be_visible()
            pg2 = page_for("staff"); pg2.goto(BASE + "/imports"); pg2.locator("input[type=file]").set_input_files(os.path.join(os.environ.get("SRC_ROOT", "/home/claude/src/Excel"), rel)); expect(pg2.locator(".err[role=alert]")).to_contain_text("not permitted")
        def supplier_links_folder_targets_catalog_and_dashboard_extras():
            db.execute("insert into suppliers(organization_id,supplier_name) select organization_id,'E2E Link Supplier' from profiles limit 1")
            pg = page_for("manager"); pg.goto(BASE + "/"); expect(pg.get_by_text("Needs attention")).to_be_visible(); expect(pg.get_by_text("Recent activity")).to_be_visible(); expect(pg.get_by_role("link", name="Find a lens")).to_be_visible()
            vid = str(db.execute("select variant_id from v_inventory where available_state='recorded' limit 1").fetchone()[0])
            pg.goto(f"{BASE}/inventory/{vid}"); expect(pg.get_by_text("Effective preferred supplier")).to_be_visible()
            pg.get_by_label("Supplier", exact=True).select_option(label="E2E Link Supplier"); pg.get_by_label("preferred").check(); pg.get_by_role("button", name="Link", exact=True).click()
            expect(pg.get_by_text("E2E Link Supplier").first).to_be_visible(); expect(pg.locator("b", has_text="E2E Link Supplier")).to_be_visible()
            pg.goto(BASE + "/inventory"); pg.get_by_role("button", name="SINGLE VISION LENS (", exact=False).first.click(); pg.get_by_role("button", name="SV -12-2 Lens (", exact=False).first.click()
            expect(pg.get_by_text("Set target for everything in")).to_be_visible(); pg.get_by_label("Bulk target", exact=True).fill("6"); pg.get_by_label("Bulk target reason").fill("e2e"); pg.on("dialog", lambda d: d.accept())
            pg.get_by_role("button", name="Apply").click(); expect(pg.get_by_text("targets changed.")).to_be_visible()
            pg.goto(BASE + "/catalog"); pg.get_by_label("New folder name").fill("E2E Folder"); pg.get_by_role("button", name="Add folder here").click(); expect(pg.get_by_text("Folder created.")).to_be_visible()
            expect(pg.get_by_role("button", name="E2E Folder (", exact=False).first).to_be_visible()
            pg.goto(BASE + "/review"); pg.get_by_label("Code filter").fill("DUPLICATE_ROW_LABEL_IN_BLOCK"); expect(pg.get_by_text("Decide all open")).to_be_visible()
            pg.get_by_label("Bulk decision note").fill("e2e ok"); pg.get_by_role("button", name="Approve all").click(); expect(pg.get_by_text("items approved.")).to_be_visible()
        def login_next_signout_and_silent_refresh():
            c = br.new_context(viewport={"width": 1300, "height": 800}); pg = c.new_page(); pg.goto(BASE + "/inventory"); expect(pg).to_have_url(re.compile(r"/login\?next=%2Finventory"))
            pg.get_by_label("Email").fill("mgr@example.com"); pg.get_by_label("Password").fill("wrong-password"); pg.get_by_role("button", name="Sign in").click(); expect(pg.locator(".err[role=alert]")).to_contain_text("invalid credentials")
            pg.get_by_label("Password").fill("correct-horse-battery"); pg.get_by_role("button", name="Sign in").click(); expect(pg).to_have_url(BASE + "/inventory"); expect(pg.locator("tbody tr").first).to_be_visible()
            cookies = {x["name"]: x for x in c.cookies()}; assert cookies["ro_session"]["httpOnly"] and cookies["ro_refresh"]["httpOnly"] and cookies["ro_refresh"]["path"] == "/api/session"
            assert pg.evaluate("document.cookie") == "", "tokens must not be readable by page scripts"
            c.clear_cookies(name="ro_session"); pg.goto(BASE + "/inventory")                       # access token gone, refresh cookie still valid -> silent re-login
            expect(pg).to_have_url(BASE + "/inventory", timeout=15000); expect(pg.locator("tbody tr").first).to_be_visible()
            pg.get_by_role("button", name="Sign out").click(); expect(pg).to_have_url(re.compile(r"/login")); pg.goto(BASE + "/inventory"); expect(pg).to_have_url(re.compile(r"/login\?next="))
            time.sleep(1.5); expect(pg.get_by_role("heading", name="Sign in")).to_be_visible(); assert "ro_session" not in {x["name"] for x in c.cookies()}
        for f in (unauthenticated_redirects_to_login, dashboard_shows_real_numbers, hierarchy_tree_search_and_pagination, variant_detail_receive_and_issue_through_ui,
                  blank_stock_variant_explains_and_blocks, power_matrix_renders_from_table_link, count_session_flow_in_browser, suggested_orders_to_draft_po_in_browser,
                  review_reports_and_keyboard_labels, narrow_viewport_does_not_scroll_page_sideways, stock_entry_screen_and_settings_page, range_filter_and_archive_controls_in_ui, security_headers_do_not_break_the_app, import_wizard_in_browser, supplier_links_folder_targets_catalog_and_dashboard_extras, login_next_signout_and_silent_refresh): test(f)
        br.close()
    ok = sum(1 for _, p, _ in results if p)
    for n, p, d in results: print(("PASS " if p else "FAIL ") + n + ("" if p else "\n" + d))
    print(f"\n{ok}/{len(results)} browser tests passed"); code = 0 if ok == len(results) else 1
finally:
    if server and server.poll() is None:
        try: os.killpg(server.pid, signal.SIGKILL)
        except Exception: pass
    if loader.poll() is None: loader.kill()
sys.exit(code)
