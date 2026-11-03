-- 0005: matrix ordering, count sessions (approval workflow), PO cancel/close, bulk targets.

-- Source position, so the power matrix renders in the SAME order as the original grid.
alter table lens_variants add column source_row integer, add column source_col integer;
create index lens_variants_order_ix on lens_variants(block_node_id, source_row, row_occurrence, source_col);

alter table purchase_orders add column closed_reason text, add column closed_at timestamptz;

-- ───────── count sessions ─────────
create type count_status as enum ('open','submitted','approved','cancelled');
create table count_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, scope_node_id uuid references catalog_nodes(id),
  status count_status not null default 'open',
  created_by uuid, created_at timestamptz not null default now(),
  submitted_at timestamptz, approved_by uuid, approved_at timestamptz, summary jsonb
);
create table count_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references count_sessions(id) on delete cascade,
  variant_id uuid not null references lens_variants(id),
  recorded_quantity integer,            -- snapshot when the session was created (NULL = unknown)
  recorded_state quantity_state not null,
  counted_quantity integer check (counted_quantity is null or counted_quantity >= 0),  -- NULL = NOT counted (never 0)
  counted_by uuid, counted_at timestamptz, note text,
  result text,                          -- posted | unchanged | stale | not_counted (set at approval)
  unique (session_id, variant_id)
);
create index count_lines_session_ix on count_lines(session_id);
alter table count_sessions enable row level security; alter table count_sessions force row level security;
alter table count_lines enable row level security;   alter table count_lines force row level security;
create policy count_sessions_read on count_sessions for select to authenticated using (organization_id = app_org());
create policy count_lines_read on count_lines for select to authenticated
  using (exists (select 1 from count_sessions s where s.id = session_id and s.organization_id = app_org()));
grant select on count_sessions, count_lines to authenticated;

create trigger count_sessions_no_delete before delete on count_sessions for each row execute function forbid_mutation();

create or replace function create_count_session(p_name text, p_node uuid default null, p_variants uuid[] default null)
returns count_sessions language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions; n integer;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'session name required'; end if;
  insert into count_sessions(organization_id,name,scope_node_id,created_by) values (prof.organization_id,p_name,p_node,prof.id) returning * into s;
  insert into count_lines(session_id,variant_id,recorded_quantity,recorded_state)
  select s.id, v.id, b.available_quantity, b.available_state
  from lens_variants v join stock_balances b on b.variant_id = v.id
  where v.organization_id = prof.organization_id and v.is_active
    and ( (p_variants is not null and v.id = any(p_variants))
       or (p_variants is null and p_node is null)
       or (p_variants is null and p_node is not null and v.block_node_id in (
            with recursive sub as (select id from catalog_nodes where id = p_node union all select c.id from catalog_nodes c join sub on c.parent_id = sub.id) select id from sub)));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'scope contains no variants'; end if;
  perform audit(prof.organization_id,'count.create','count_session',s.id,null,to_jsonb(s)||jsonb_build_object('lines',n));
  return s;
end $$;

-- Enter / clear a counted quantity. p_count NULL = "not counted" (explicitly NOT zero).
create or replace function record_count_line(p_session uuid, p_variant uuid, p_count integer, p_note text default null)
returns count_lines language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions; l count_lines;
begin
  prof := app_require_role('administrator','inventory_manager','inventory_staff');
  select * into s from count_sessions where id = p_session and organization_id = prof.organization_id;
  if not found then raise exception 'unknown count session' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'count session is %, entries are closed', s.status; end if;
  if p_count is not null and p_count < 0 then raise exception 'count must be a non-negative integer'; end if;
  update count_lines set counted_quantity = p_count, counted_by = prof.id, counted_at = case when p_count is null then null else now() end, note = p_note
   where session_id = p_session and variant_id = p_variant returning * into l;
  if not found then raise exception 'variant is not part of this count session' using errcode = 'P0002'; end if;
  return l;
end $$;

create or replace function submit_count_session(p_session uuid) returns count_sessions
language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions;
begin
  prof := app_require_role('administrator','inventory_manager','inventory_staff');
  update count_sessions set status = 'submitted', submitted_at = now() where id = p_session and organization_id = prof.organization_id and status = 'open' returning * into s;
  if not found then raise exception 'session not found or not open'; end if;
  return s;
end $$;

create or replace function reopen_count_session(p_session uuid) returns count_sessions
language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions;
begin
  prof := app_require_role('administrator','inventory_manager');
  update count_sessions set status = 'open' where id = p_session and organization_id = prof.organization_id and status = 'submitted' returning * into s;
  if not found then raise exception 'session not found or not submitted'; end if;
  return s;
end $$;

-- Approval posts the counts atomically. Lines whose balance changed since the snapshot are NOT posted (flagged 'stale').
create or replace function approve_count_session(p_session uuid) returns count_sessions
language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions; l count_lines; b stock_balances; posted int := 0; unch int := 0; stale int := 0; skipped int := 0; res text;
begin
  prof := app_require_role('administrator','inventory_manager');
  select * into s from count_sessions where id = p_session and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown count session' using errcode = 'P0002'; end if;
  if s.status <> 'submitted' then raise exception 'only a submitted session can be approved (status=%)', s.status; end if;
  for l in select * from count_lines where session_id = p_session order by variant_id loop
    if l.counted_quantity is null then res := 'not_counted'; skipped := skipped + 1;
    else
      select * into b from stock_balances where variant_id = l.variant_id for update;
      if b.available_quantity is distinct from l.recorded_quantity or b.available_state is distinct from l.recorded_state then
        res := 'stale'; stale := stale + 1;
      elsif b.available_state = 'recorded' and b.available_quantity = l.counted_quantity then
        res := 'unchanged'; unch := unch + 1;
      else
        perform post_physical_count(l.variant_id, l.counted_quantity, 'count session: ' || s.name, md5(p_session::text || l.variant_id::text)::uuid);
        res := 'posted'; posted := posted + 1;
      end if;
    end if;
    update count_lines set result = res where id = l.id;
  end loop;
  update count_sessions set status = 'approved', approved_by = prof.id, approved_at = now(),
     summary = jsonb_build_object('posted',posted,'unchanged',unch,'stale',stale,'not_counted',skipped) where id = p_session returning * into s;
  perform audit(prof.organization_id,'count.approve','count_session',s.id,null,to_jsonb(s));
  return s;
end $$;

create or replace function cancel_count_session(p_session uuid) returns count_sessions
language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions;
begin
  prof := app_require_role('administrator','inventory_manager');
  update count_sessions set status = 'cancelled' where id = p_session and organization_id = prof.organization_id and status in ('open','submitted') returning * into s;
  if not found then raise exception 'session not found or already finalised'; end if;
  perform audit(prof.organization_id,'count.cancel','count_session',s.id,null,to_jsonb(s));
  return s;
end $$;

-- ───────── bulk targets (all-or-nothing; each change goes through set_target_quantity: history + audit) ─────────
create or replace function set_targets_bulk(p_items jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare it jsonb; n integer := 0;
begin
  perform app_require_role('administrator','inventory_manager');
  for it in select * from jsonb_array_elements(p_items) loop
    perform set_target_quantity((it->>'variant_id')::uuid, (it->>'target')::integer, p_reason);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────── purchase order cancel / close-short (never deletes; received quantities are preserved) ─────────
create or replace function cancel_purchase_order(p_po uuid, p_reason text) returns purchase_orders
language plpgsql security definer set search_path = public as $$
declare prof profiles; po purchase_orders; got integer;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required'; end if;
  select * into po from purchase_orders where id = p_po and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown purchase order' using errcode = 'P0002'; end if;
  select coalesce(sum(quantity_received),0) into got from purchase_order_items where purchase_order_id = p_po;
  if po.status in ('draft','confirmed') and got = 0 then
    update purchase_orders set status = 'cancelled', closed_reason = p_reason, closed_at = now() where id = p_po returning * into po;
  elsif po.status in ('confirmed','partially_received') and got > 0 then
    update purchase_orders set status = 'closed_short', closed_reason = p_reason, closed_at = now() where id = p_po returning * into po;
  else raise exception 'order in status % cannot be cancelled/closed', po.status;
  end if;
  perform audit(prof.organization_id,'po.close','purchase_order',po.id,null,to_jsonb(po));
  return po;
end $$;

grant execute on function create_count_session, record_count_line, submit_count_session, reopen_count_session,
  approve_count_session, cancel_count_session, set_targets_bulk, cancel_purchase_order to authenticated;
