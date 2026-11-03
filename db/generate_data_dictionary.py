#!/usr/bin/env python3
"""Generates docs/data-dictionary.md from the REAL schema (applies all migrations to a throwaway PostgreSQL)."""
import glob, os, tempfile, pgserver, psycopg
H = os.path.dirname(os.path.abspath(__file__))
srv = pgserver.get_server(tempfile.mkdtemp()); c = psycopg.connect(srv.get_uri(), autocommit=True)
c.execute("create role authenticated nologin; create role anon nologin;")
for f in sorted(glob.glob(os.path.join(H, "migrations", "*.sql"))): c.execute(open(f).read())
out = ["# Data dictionary (generated from the applied migrations — do not edit by hand)", "", f"Migrations: {', '.join(os.path.basename(f) for f in sorted(glob.glob(os.path.join(H, 'migrations', '*.sql'))))}", ""]
tables = [r[0] for r in c.execute("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")]
for t in tables:
    out += [f"## `{t}`", "", "| Column | Type | Null | Default |", "|---|---|---|---|"]
    for col, typ, udt, nul, d in c.execute("select column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name=%s order by ordinal_position", (t,)):
        out.append(f"| {col} | {udt if typ == 'USER-DEFINED' else typ} | {nul} | {(d or '')[:50]} |")
    cons = c.execute("select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid=('public.'||%s)::regclass order by contype, conname", (t,)).fetchall()
    if cons: out += ["", "Constraints: " + "; ".join(f"`{n}`: {d}" for n, d in cons)]
    idx = c.execute("select indexname, indexdef from pg_indexes where schemaname='public' and tablename=%s and indexname not like '%%_pkey'", (t,)).fetchall()
    if idx: out += ["", "Indexes: " + "; ".join(f"`{n}`" for n, _ in idx)]
    pol = c.execute("select policyname, cmd from pg_policies where schemaname='public' and tablename=%s", (t,)).fetchall()
    out += ["", "RLS policies: " + (", ".join(f"`{n}` ({cmd})" for n, cmd in pol) if pol else "none (no direct client access beyond SELECT grant)"), ""]
out += ["## Enums", ""] + [f"- `{n}`: {', '.join(v)}" for n, v in c.execute("select t.typname, array_agg(e.enumlabel order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid group by 1 order by 1")]
out += ["", "## Functions (stock engine / workflows)", ""] + [f"- `{n}({a})`" for n, a in c.execute("select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by 1")]
out += ["", "## Views", ""] + [f"- `{r[0]}`" for r in c.execute("select table_name from information_schema.views where table_schema='public'")]
open(os.path.join(H, "..", "docs", "data-dictionary.md"), "w").write("\n".join(out)); print(len(tables), "tables documented")
srv.cleanup()
