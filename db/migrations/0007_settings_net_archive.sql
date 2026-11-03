-- 0007: settings, configurable issue reasons, net replenishment columns, archive.
create or replace function app_setting(p_key text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from system_settings where organization_id = app_org() and key = p_key
$$;

create or replace function set_setting(p_key text, p_value jsonb) returns system_settings
language plpgsql security definer set search_path = public as $$
declare prof profiles; r system_settings; e jsonb;
begin
  prof := app_require_role('administrator');
  if p_key = 'issue_reasons' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 30 then raise exception 'issue_reasons must be an array of at most 30 texts'; end if;
    for e in select * from jsonb_array_elements(p_value) loop
      if jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) = 0 or length(e #>> '{}') > 80 then raise exception 'each issue reason must be a non-empty text of at most 80 characters'; end if;
    end loop;
  elsif p_key = 'net_replenishment_enabled' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'net_replenishment_enabled must be true or false'; end if;
  else raise exception 'unknown setting %', p_key;
  end if;
  insert into system_settings(organization_id,key,value,updated_by,updated_at) values (prof.organization_id,p_key,p_value,prof.id,now())
  on conflict (organization_id,key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now() returning * into r;
  perform audit(prof.organization_id,'setting.set','system_setting',null,null,jsonb_build_object('key',p_key,'value',p_value));
  return r;
end $$;

create or replace function post_stock_movement(
  p_variant uuid, p_kind movement_type, p_qty integer, p_reason text default null,
  p_ref_type text default null, p_ref_id uuid default null, p_key uuid default null
) returns stock_movements
language plpgsql security definer set search_path = public as $$
declare
  prof profiles; bal stock_balances; mv stock_movements; delta integer;
begin
  prof := app_require_role('administrator','inventory_manager','inventory_staff');
  if p_kind not in ('receipt','issue') then raise exception 'post_stock_movement handles receipt/issue only'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be a positive integer'; end if;
  if p_kind = 'issue' and exists (select 1 from system_settings where organization_id = prof.organization_id and key = 'issue_reasons') then
    if p_reason is null or not (select value from system_settings where organization_id = prof.organization_id and key = 'issue_reasons') ? p_reason then
      raise exception 'issue reason must be one of the configured reasons' using errcode = 'P0001';
    end if;
  end if;

  if p_key is not null then
    select * into mv from stock_movements where organization_id = prof.organization_id and idempotency_key = p_key;
    if found then return mv; end if;                      -- retry of an already-posted request
  end if;

  select * into bal from stock_balances where variant_id = p_variant and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown variant' using errcode = 'P0002'; end if;
  if bal.available_quantity is null then
    raise exception 'available stock is not recorded for this variant (state=%); record a physical/opening count first', bal.available_state
      using errcode = 'P0001';
  end if;

  if bal.available_state = 'unverified' then
    raise exception 'available stock is UNVERIFIED for this variant (suspect source data); record a physical count first'
      using errcode = 'P0001';
  end if;

  delta := case p_kind when 'receipt' then p_qty else -p_qty end;
  if bal.available_quantity + delta < 0 then
    raise exception 'insufficient stock: available %, requested issue %', bal.available_quantity, p_qty using errcode = 'P0001';
  end if;

  update stock_balances set available_quantity = available_quantity + delta, available_state = 'recorded',
         version = version + 1, updated_at = now() where id = bal.id;
  insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,reference_type,reference_id,created_by,idempotency_key)
  values (prof.organization_id, p_variant, p_kind, delta, bal.available_quantity, bal.available_quantity + delta, p_reason, p_ref_type, p_ref_id, prof.id, p_key)
  returning * into mv;
  perform audit(prof.organization_id, 'stock.'||p_kind, 'stock_movement', mv.id, null, to_jsonb(mv));
  return mv;
end $$;


-- v_inventory gains open-order quantity and a clearly separate NET suggestion (never replaces suggested_order).
create or replace view v_inventory with (security_invoker = true) as
select
  v.id as variant_id, v.organization_id, v.block_node_id, v.row_axis_name, v.col_axis_name,
  v.row_label_source, v.col_label_source, v.row_occurrence,
  b.target_quantity, b.target_state, b.available_quantity, b.available_state,
  suggested_order(b.target_quantity, b.available_quantity) as suggested_order,
  suggested_order_legacy_blank_as_zero(b.target_quantity, b.available_quantity) as legacy_suggested_order_blank_as_zero,
  case
    when b.available_quantity is null then 'stock_unknown'
    when b.available_quantity = 0 then 'out_of_stock'
    when b.target_quantity is not null and b.available_quantity < b.target_quantity then 'below_target'
    else 'ok' end as stock_status,
  v.is_active,
  coalesce(o.outstanding, 0)::integer as on_order_quantity,
  case when b.target_quantity is null or b.available_quantity is null then null
       else greatest(0, b.target_quantity - b.available_quantity - coalesce(o.outstanding, 0)) end as net_suggested_order
from lens_variants v join stock_balances b on b.variant_id = v.id
left join (select poi.variant_id, sum(poi.quantity_ordered - poi.quantity_received) as outstanding
           from purchase_order_items poi join purchase_orders po on po.id = poi.purchase_order_id
           where po.status in ('confirmed','partially_received') group by poi.variant_id) o on o.variant_id = v.id;

-- archive / unarchive (never deletes; archived variants stay visible when filtered, stock history is kept)
create or replace function set_variant_active(p_variant uuid, p_active boolean) returns lens_variants
language plpgsql security definer set search_path = public as $$
declare prof profiles; v lens_variants;
begin
  prof := app_require_role('administrator','inventory_manager');
  update lens_variants set is_active = p_active where id = p_variant and organization_id = prof.organization_id returning * into v;
  if not found then raise exception 'unknown variant' using errcode = 'P0002'; end if;
  perform audit(prof.organization_id,'variant.active','lens_variant',v.id,null,jsonb_build_object('is_active',p_active));
  return v;
end $$;
grant execute on function app_setting, set_setting, set_variant_active to authenticated;
