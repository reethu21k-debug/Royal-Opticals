-- 0008: performance. Wrap the per-user helper calls in RLS policies in a scalar sub-select so PostgreSQL evaluates them ONCE per query
-- (InitPlan) instead of once per row. Semantics are unchanged; every existing policy is rewritten mechanically.
do $$
declare p record; q text; w text; ddl text;
begin
  for p in select pol.polname, c.relname, pg_get_expr(pol.polqual, pol.polrelid) as qual, pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
           from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  loop
    q := p.qual; w := p.chk;
    if q is not null then q := replace(replace(q, 'app_org()', '(SELECT app_org())'), 'app_can_manage()', '(SELECT app_can_manage())'); end if;
    if w is not null then w := replace(replace(w, 'app_org()', '(SELECT app_org())'), 'app_can_manage()', '(SELECT app_can_manage())'); end if;
    if (p.qual is not null and q <> p.qual) or (p.chk is not null and w <> p.chk) then
      ddl := format('alter policy %I on %I', p.polname, p.relname);
      if q is not null then ddl := ddl || format(' using (%s)', q); end if;
      if w is not null then ddl := ddl || format(' with check (%s)', w); end if;
      execute ddl;
    end if;
  end loop;
end $$;
create index if not exists stock_movements_org_time_ix on stock_movements (organization_id, created_at desc, id);
