#!/usr/bin/env python3
"""
Production-path bulk import: recreate the ORIGINAL folder tree and import every inventory workbook through the app's own wizard API
(upload -> stage -> execute). Same code path as a user clicking through the wizard; nothing is written by SQL scripts.

  python3 bulk_import_via_api.py <base-url> <bearer-token> <Excel-root>

Rules: folder / file names are created verbatim; non-inventory files (PDFs, order/stock sheet workbooks) become workbook nodes without stock;
byte-identical duplicate inventory workbooks are rejected by the wizard (checksum) and only the node is created; the explicit HOLD list names
the copy that must NOT carry stock when two copies are identical (decision Q-DUP-1, pending client confirmation).
"""
import os, sys, json, uuid, urllib.request, urllib.error
HOLD = {"SINGLE VISION LENS/SV +6+2 Lens/INVENTORY SV +POWER/CR HMC +POWER.xlsx"}   # content is the -6-2 grid; name says +POWER (Q-DUP-1)

def call(base, token, method, path, body=None, files=None):
    hdr = {"authorization": "Bearer " + token}
    if files:
        bd = "----bulk" + uuid.uuid4().hex; data = b""
        for name, (fn, content) in files.items():
            data += f'--{bd}\r\nContent-Disposition: form-data; name="{name}"; filename="{fn}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n"
        data += f"--{bd}--\r\n".encode(); hdr["content-type"] = f"multipart/form-data; boundary={bd}"
    else:
        data = None if body is None else json.dumps(body).encode(); hdr["content-type"] = "application/json"
    req = urllib.request.Request(base + path, method=method, data=data, headers=hdr)
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

def run(base, token, root, hold=HOLD, log=print):
    node = {}; res = {"folders": 0, "workbook_nodes": 0, "imported_files": 0, "imported_positions": 0, "held_positions": 0, "rejected_duplicates": [], "held_by_decision": [], "non_inventory": 0, "errors": []}
    def folder(parts):
        key = tuple(parts)
        if key in node: return node[key]
        parent = folder(parts[:-1]) if len(parts) > 1 else None
        s, j = call(base, token, "POST", "/api/catalog", {"parentId": parent, "name": parts[-1], "kind": "folder"})
        if s == 409:    # already exists (re-run): reuse the existing node, never create a second one
            s2, j2 = call(base, token, "GET", "/api/catalog" + (f"?parentId={parent}" if parent else ""))
            hit = [n for n in j2.get("items", []) if n["source_name"] == parts[-1] and n["kind"] in ("family", "folder")]
            if not hit: raise SystemExit(f"folder {parts} conflicts but cannot be found")
            node[key] = hit[0]["id"]; return node[key]
        if s != 200: raise SystemExit(f"cannot create folder {parts}: {s} {j}")
        node[key] = j["node"]["id"]; res["folders"] += 1; return node[key]
    dirs, files = [], []
    for dp, dn, fn in os.walk(root):
        dn.sort(); rel = os.path.relpath(dp, root)
        if rel != ".": dirs.append(rel)
        for f in sorted(fn): files.append(os.path.relpath(os.path.join(dp, f), root))
    for d in sorted(dirs): folder(d.split("/"))
    def wb_node(rel):
        parts = rel.split("/"); s, j = call(base, token, "POST", "/api/catalog", {"parentId": folder(parts[:-1]), "name": parts[-1], "kind": "workbook"})
        if s == 409: res.setdefault("existing_nodes", 0); res["existing_nodes"] += 1       # re-run: node already there
        elif s != 200: res["errors"].append((rel, s, j))
        else: res["workbook_nodes"] += 1
    for rel in sorted(files):
        parts = rel.split("/"); name = parts[-1]
        if not rel.lower().endswith(".xlsx"): wb_node(rel); res["non_inventory"] += 1; continue
        content = open(os.path.join(root, rel), "rb").read()
        if rel in hold: res["held_by_decision"].append(rel); wb_node(rel); continue
        s, j = call(base, token, "POST", "/api/imports", files={"file": (name, content)})
        if s == 400 and "not an inventory workbook" in j.get("error", ""): wb_node(rel); res["non_inventory"] += 1; continue
        if s == 409 and "already imported" in j.get("error", ""): res["rejected_duplicates"].append(rel); wb_node(rel); continue
        if s != 200: res["errors"].append((rel, s, j)); continue
        bid = j["batch"]["id"]; s2, j2 = call(base, token, "POST", f"/api/imports/{bid}/execute", {"parentNodeId": folder(parts[:-1]), "workbookName": name})
        if s2 != 200: res["errors"].append((rel, s2, j2)); continue
        res["imported_files"] += 1; res["imported_positions"] += j2["batch"]["imported_records"]; res["held_positions"] += j2["batch"]["held_records"]
        log(f"imported {rel}: {j2['batch']['imported_records']} positions")
    return res

if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2], sys.argv[3]), indent=1))
