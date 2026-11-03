-- 0013: helper for the likely client decision "a blank stock cell means zero". It does NOT change stock: it only fills the counted
-- quantity with 0 for lines whose recorded stock is MISSING and that are still uncounted, inside an OPEN count session. A manager must still
-- submit/approve the session (full audit trail). Lines with a recorded or unverified quantity are never touched.
create or replace function fill_blank_stock_with_zero(p_session uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare prof profiles; s count_sessions; n integer;
begin
  prof := app_require_role('administrator','inventory_manager');
  select * into s from count_sessions where id = p_session and organization_id = prof.organization_id;
  if not found then raise exception 'unknown count session' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'count session is %, entries are closed', s.status; end if;
  update count_lines set counted_quantity = 0, counted_by = prof.id, counted_at = now(), note = 'blank stock treated as zero (client decision)'
   where session_id = p_session and counted_quantity is null and recorded_quantity is null and recorded_state = 'missing';
  get diagnostics n = row_count;
  perform audit(prof.organization_id,'count.fill_blank_zero','count_session',p_session,null,jsonb_build_object('lines',n));
  return n;
end $$;
grant execute on function fill_blank_stock_with_zero to authenticated;
