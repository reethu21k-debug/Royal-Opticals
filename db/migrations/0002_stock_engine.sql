-- Stock engine. All stock changes go through these functions (never direct table writes).

-- ── actor helpers (Supabase: auth.uid(); tests provide an auth shim) ──
create or replace function app_actor() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function app_actor_profile() returns profiles language sql stable security definer set search_path = public as $$
  select p.* from profiles p where p.id = app_actor() and p.is_active
$$;

create or replace function app_require_role(variadic roles app_role[]) returns profiles
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = app_actor() and is_active;
  if p.id is null then raise exception 'not authenticated or inactive user' using errcode = '42501'; end if;
  if not (p.role = any(roles)) then
    raise exception 'role % is not permitted to perform this operation', p.role using errcode = '42501';
  end if;
  return p;
end $$;

-- ── CONFIRMED BUSINESS RULE ──
-- Suggested Order = MAX(0, Target − Available).  NULL when either input is unknown (never silently 0).
create or replace function suggested_order(target integer, available integer) returns integer
language sql immutable as $$
  select case when target is null or available is null then null else greatest(0, target - available) end
$$;

-- Legacy-compatible figure (blank stock treated as 0). INFORMATIONAL ONLY, clearly labelled; not used for ordering.
create or replace function suggested_order_legacy_blank_as_zero(target integer, available integer) returns integer
language sql immutable as $$
  select case when target is null then null else greatest(0, target - coalesce(available, 0)) end
$$;

-- ── append-only protection ──
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% not allowed)', tg_table_name, tg_op using errcode = '42501'; end $$;
create trigger stock_movements_immutable before update or delete on stock_movements for each row execute function forbid_mutation();
create trigger audit_logs_immutable before update or delete on audit_logs for each row execute function forbid_mutation();
create trigger target_changes_immutable before update or delete on target_changes for each row execute function forbid_mutation();

create or replace function audit(p_org uuid, p_action text, p_type text, p_id uuid, p_before jsonb, p_after jsonb) returns void
language sql security definer set search_path = public as $$
  insert into audit_logs(organization_id,user_id,action,entity_type,entity_id,before_data,after_data)
  values (p_org, app_actor(), p_action, p_type, p_id, p_before, p_after)
$$;

-- ── core movement poster ──
-- p_kind: receipt | issue.  Quantity must be a positive integer; idempotent via p_key.
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

-- ── physical count: adjustment (balance known) or opening_count (balance was blank/unknown) ──
create or replace function post_physical_count(p_variant uuid, p_count integer, p_reason text, p_key uuid default null)
returns stock_movements language plpgsql security definer set search_path = public as $$
declare prof profiles; bal stock_balances; mv stock_movements; mtype movement_type;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_count is null or p_count < 0 then raise exception 'physical count must be a non-negative integer'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required for a count/adjustment'; end if;
  if p_key is not null then
    select * into mv from stock_movements where organization_id = prof.organization_id and idempotency_key = p_key;
    if found then return mv; end if;
  end if;
  select * into bal from stock_balances where variant_id = p_variant and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown variant' using errcode = 'P0002'; end if;
  mtype := case when bal.available_quantity is null then 'opening_count' else 'adjustment' end;
  update stock_balances set available_quantity = p_count, available_state = 'recorded', version = version + 1, updated_at = now() where id = bal.id;
  insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,created_by,idempotency_key)
  values (prof.organization_id, p_variant, mtype, p_count - coalesce(bal.available_quantity,0), bal.available_quantity, p_count, p_reason, prof.id, p_key)
  returning * into mv;
  perform audit(prof.organization_id, 'stock.'||mtype, 'stock_movement', mv.id, jsonb_build_object('available', bal.available_quantity), to_jsonb(mv));
  return mv;
end $$;

-- ── target changes never touch available stock ──
create or replace function set_target_quantity(p_variant uuid, p_target integer, p_reason text default null)
returns stock_balances language plpgsql security definer set search_path = public as $$
declare prof profiles; bal stock_balances;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_target is null or p_target < 0 then raise exception 'target must be a non-negative integer'; end if;
  select * into bal from stock_balances where variant_id = p_variant and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown variant' using errcode = 'P0002'; end if;
  insert into target_changes(organization_id,variant_id,previous_target,new_target,reason,changed_by)
  values (prof.organization_id, p_variant, bal.target_quantity, p_target, p_reason, prof.id);
  update stock_balances set target_quantity = p_target, target_state = 'recorded', version = version + 1, updated_at = now()
   where id = bal.id returning * into bal;
  perform audit(prof.organization_id,'target.change','stock_balance',bal.id,null,to_jsonb(bal));
  return bal;
end $$;

-- ── purchase orders ──
create or replace function confirm_purchase_order(p_po uuid) returns purchase_orders
language plpgsql security definer set search_path = public as $$
declare prof profiles; po purchase_orders;
begin
  prof := app_require_role('administrator','inventory_manager');
  select * into po from purchase_orders where id = p_po and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown purchase order'; end if;
  if po.status <> 'draft' then raise exception 'only a draft order can be confirmed (status=%)', po.status; end if;
  if not exists (select 1 from purchase_order_items where purchase_order_id = p_po) then raise exception 'cannot confirm an empty order'; end if;
  update purchase_orders set status = 'confirmed' where id = p_po returning * into po;
  perform audit(prof.organization_id,'po.confirm','purchase_order',po.id,null,to_jsonb(po));
  return po;
end $$;

-- p_items: [{"item_id": "...", "quantity": 30}, ...]   Posts ONE receipt; stock rises only by quantities received.
create or replace function receive_purchase_order(p_po uuid, p_items jsonb, p_receipt_number text, p_key uuid default null)
returns stock_receipts language plpgsql security definer set search_path = public as $$
declare
  prof profiles; po purchase_orders; r stock_receipts; it jsonb; poi purchase_order_items; mv stock_movements; outstanding integer;
begin
  prof := app_require_role('administrator','inventory_manager','inventory_staff');
  if p_key is not null then
    select * into r from stock_receipts where organization_id = prof.organization_id and idempotency_key = p_key;
    if found then return r; end if;
  end if;
  select * into po from purchase_orders where id = p_po and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown purchase order'; end if;
  if po.status not in ('confirmed','partially_received') then
    raise exception 'cannot receive against an order in status %', po.status;
  end if;
  insert into stock_receipts(organization_id,receipt_number,purchase_order_id,supplier_id,received_by,idempotency_key)
  values (prof.organization_id, p_receipt_number, p_po, po.supplier_id, prof.id, p_key) returning * into r;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into poi from purchase_order_items where id = (it->>'item_id')::uuid and purchase_order_id = p_po for update;
    if not found then raise exception 'item % is not on this order', it->>'item_id'; end if;
    if (it->>'quantity')::integer <= 0 then raise exception 'received quantity must be positive'; end if;
    if poi.quantity_received + (it->>'quantity')::integer > poi.quantity_ordered then
      raise exception 'receiving % would exceed ordered quantity % (already received %)', (it->>'quantity')::integer, poi.quantity_ordered, poi.quantity_received;
    end if;
    mv := post_stock_movement(poi.variant_id, 'receipt', (it->>'quantity')::integer, 'PO '||po.po_number, 'stock_receipt', r.id, gen_random_uuid());
    update purchase_order_items set quantity_received = quantity_received + (it->>'quantity')::integer where id = poi.id;
    insert into stock_receipt_items(receipt_id,variant_id,quantity_received,purchase_order_item_id,movement_id)
    values (r.id, poi.variant_id, (it->>'quantity')::integer, poi.id, mv.id);
  end loop;
  select sum(quantity_ordered - quantity_received) into outstanding from purchase_order_items where purchase_order_id = p_po;
  update purchase_orders set status = (case when outstanding = 0 then 'received' else 'partially_received' end)::po_status where id = p_po;
  return r;
end $$;

-- ── inventory view: one definition used by dashboard, reports, exports ──
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
  v.is_active
from lens_variants v join stock_balances b on b.variant_id = v.id;

-- Full path of a catalog node using exact source names.
create or replace function node_path(p_node uuid) returns text language sql stable as $$
  with recursive up as (
    select id, parent_id, source_name, 0 as d from catalog_nodes where id = p_node
    union all select c.id, c.parent_id, c.source_name, up.d + 1 from catalog_nodes c join up on c.id = up.parent_id)
  select string_agg(source_name, ' / ' order by d desc) from up
$$;
