-- 0012: administrators attach a profile (role) to an auth account created through the Supabase admin API.
create or replace function create_profile(p_user uuid, p_name text, p_role app_role) returns profiles
language plpgsql security definer set search_path = public as $$
declare prof profiles; r profiles;
begin
  prof := app_require_role('administrator');
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'full name required'; end if;
  if exists (select 1 from profiles where id = p_user) then raise exception 'this account already has a profile' using errcode = 'P0001'; end if;
  insert into profiles(id,organization_id,full_name,role) values (p_user, prof.organization_id, trim(p_name), p_role) returning * into r;
  perform audit(prof.organization_id,'user.create','profile',r.id,null,jsonb_build_object('role',r.role,'full_name',r.full_name));
  return r;
end $$;
grant execute on function create_profile to authenticated;
