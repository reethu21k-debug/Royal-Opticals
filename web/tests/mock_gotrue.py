"""Protocol-level stand-in for Supabase Auth (GoTrue REST). Call configure() first."""
import json, uuid, urllib.parse
import threading, http.server, socketserver
ANON, SERVICE = "anon-" + uuid.uuid4().hex, "service-" + uuid.uuid4().hex
USERS = {}; jwt = None
def configure(users, jwt_fn):
    global USERS, jwt; USERS = users; jwt = jwt_fn
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

