-- User administration (administrators only). Roles live in `profiles`, never in a client-supplied claim.
create or replace function set_user_role(p_user uuid, p_role app_role) returns profiles
language plpgsql security definer set search_path = public as $$
declare prof profiles; t profiles; admins int;
begin
  prof := app_require_role('administrator');
  select * into t from profiles where id = p_user and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown user' using errcode = 'P0002'; end if;
  if t.id = prof.id then raise exception 'you cannot change your own role'; end if;
  if t.role = 'administrator' and p_role <> 'administrator' then
    select count(*) into admins from profiles where organization_id = prof.organization_id and role = 'administrator' and is_active and id <> t.id;
    if admins = 0 then raise exception 'at least one active administrator must remain'; end if;
  end if;
  update profiles set role = p_role where id = t.id returning * into t;
  perform audit(prof.organization_id,'user.role','profile',t.id,jsonb_build_object('role',prof.role),jsonb_build_object('role',t.role));
  return t;
end $$;

create or replace function set_user_active(p_user uuid, p_active boolean) returns profiles
language plpgsql security definer set search_path = public as $$
declare prof profiles; t profiles; admins int;
begin
  prof := app_require_role('administrator');
  select * into t from profiles where id = p_user and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown user' using errcode = 'P0002'; end if;
  if t.id = prof.id and not p_active then raise exception 'you cannot deactivate yourself'; end if;
  if t.role = 'administrator' and not p_active then
    select count(*) into admins from profiles where organization_id = prof.organization_id and role = 'administrator' and is_active and id <> t.id;
    if admins = 0 then raise exception 'at least one active administrator must remain'; end if;
  end if;
  update profiles set is_active = p_active where id = t.id returning * into t;
  perform audit(prof.organization_id,'user.active','profile',t.id,null,jsonb_build_object('is_active',t.is_active));
  return t;
end $$;
grant execute on function set_user_role, set_user_active to authenticated;
