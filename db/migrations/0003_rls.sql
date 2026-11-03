-- Row Level Security.
-- Principle: reads are scoped to the caller's organization; stock tables are NEVER written directly by clients
-- (no INSERT/UPDATE/DELETE policy => denied). Stock changes happen only through SECURITY DEFINER functions in 0002.
-- Roles come from the `profiles` table (server-managed), never from a user-editable claim.

create or replace function app_org() returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = app_actor() and is_active
$$;
create or replace function app_role_of() returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = app_actor() and is_active
$$;
create or replace function app_can_manage() returns boolean language sql stable as $$
  select app_role_of() in ('administrator','inventory_manager')
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','system_settings','catalog_nodes','search_aliases','lens_variants',
    'variant_source_values','stock_balances','stock_movements','target_changes','suppliers','product_suppliers','purchase_orders',
    'purchase_order_items','stock_receipts','stock_receipt_items','import_batches','import_records','review_items','audit_logs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- read policies (organization scoped)
create policy org_read on organizations for select to authenticated using (id = app_org());
create policy prof_read on profiles for select to authenticated using (organization_id = app_org());

do $$
declare t text;
begin
  foreach t in array array['system_settings','catalog_nodes','search_aliases','lens_variants','stock_balances','stock_movements',
    'target_changes','suppliers','product_suppliers','purchase_orders','stock_receipts','import_batches','review_items']
  loop
    execute format('create policy %I on %I for select to authenticated using (organization_id = app_org())', t||'_read', t);
  end loop;
end $$;

create policy vsv_read on variant_source_values for select to authenticated
  using (exists (select 1 from lens_variants v where v.id = variant_id and v.organization_id = app_org()));
create policy poi_read on purchase_order_items for select to authenticated
  using (exists (select 1 from purchase_orders p where p.id = purchase_order_id and p.organization_id = app_org()));
create policy sri_read on stock_receipt_items for select to authenticated
  using (exists (select 1 from stock_receipts r where r.id = receipt_id and r.organization_id = app_org()));
create policy ir_read on import_records for select to authenticated
  using (exists (select 1 from import_batches b where b.id = import_batch_id and b.organization_id = app_org()));
-- audit log readable by managers only
create policy audit_read on audit_logs for select to authenticated using (organization_id = app_org() and app_can_manage());

-- write policies: catalog/suppliers/draft POs by managers (stock tables intentionally have none)
create policy catalog_write on catalog_nodes for all to authenticated
  using (organization_id = app_org() and app_can_manage()) with check (organization_id = app_org() and app_can_manage());
create policy suppliers_write on suppliers for all to authenticated
  using (organization_id = app_org() and app_can_manage()) with check (organization_id = app_org() and app_can_manage());
create policy po_insert on purchase_orders for insert to authenticated
  with check (organization_id = app_org() and app_can_manage() and status = 'draft');
create policy po_update_draft on purchase_orders for update to authenticated
  using (organization_id = app_org() and app_can_manage() and status = 'draft')
  with check (organization_id = app_org() and app_can_manage() and status = 'draft');
create policy poi_draft_write on purchase_order_items for all to authenticated
  using (app_can_manage() and exists (select 1 from purchase_orders p where p.id = purchase_order_id and p.organization_id = app_org() and p.status = 'draft'))
  with check (app_can_manage() and quantity_received = 0 and exists (select 1 from purchase_orders p where p.id = purchase_order_id and p.organization_id = app_org() and p.status = 'draft'));
create policy review_decide on review_items for update to authenticated
  using (organization_id = app_org() and app_can_manage()) with check (organization_id = app_org() and app_can_manage());

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on catalog_nodes, suppliers, purchase_orders, purchase_order_items to authenticated;
grant update on review_items to authenticated;
grant execute on function post_stock_movement, post_physical_count, set_target_quantity, confirm_purchase_order, receive_purchase_order to authenticated;
