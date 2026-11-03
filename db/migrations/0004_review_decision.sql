-- Review decisions are recorded together with their audit entry, atomically. Only managers/admins may decide.
create or replace function decide_review_item(p_id uuid, p_status review_status, p_note text)
returns review_items language plpgsql security definer set search_path = public as $$
declare prof profiles; r review_items; before_ review_items;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_status = 'open' then raise exception 'a decision cannot set status back to open'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'a decision note is required'; end if;
  select * into before_ from review_items where id = p_id and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown review item' using errcode = 'P0002'; end if;
  update review_items set status = p_status, decision_note = p_note, decided_by = prof.id, decided_at = now() where id = p_id returning * into r;
  perform audit(prof.organization_id, 'review.decide', 'review_item', r.id, to_jsonb(before_), to_jsonb(r));
  return r;
end $$;
grant execute on function decide_review_item to authenticated;
