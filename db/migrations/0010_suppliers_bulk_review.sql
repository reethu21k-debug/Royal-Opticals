-- 0010: supplier links (preferred supplier per folder/block/variant), bulk target by folder, bulk review decisions.
create unique index product_suppliers_pref_node_uq on product_suppliers(node_id) where is_preferred and node_id is not null;
create unique index product_suppliers_pref_var_uq on product_suppliers(variant_id) where is_preferred and variant_id is not null;
create unique index product_suppliers_node_sup_uq on product_suppliers(node_id, supplier_id) where node_id is not null;
create unique index product_suppliers_var_sup_uq on product_suppliers(variant_id, supplier_id) where variant_id is not null;

create or replace function set_product_supplier(p_node uuid, p_variant uuid, p_supplier uuid, p_preferred boolean, p_code text)
returns product_suppliers language plpgsql security definer set search_path = public as $$
declare prof profiles; r product_suppliers;
begin
  prof := app_require_role('administrator','inventory_manager');
  if (p_node is null) = (p_variant is null) then raise exception 'exactly one of node or variant is required'; end if;
  if not exists (select 1 from suppliers where id = p_supplier and organization_id = prof.organization_id) then raise exception 'unknown supplier' using errcode = 'P0002'; end if;
  if p_node is not null and not exists (select 1 from catalog_nodes where id = p_node and organization_id = prof.organization_id) then raise exception 'unknown node' using errcode = 'P0002'; end if;
  if p_variant is not null and not exists (select 1 from lens_variants where id = p_variant and organization_id = prof.organization_id) then raise exception 'unknown variant' using errcode = 'P0002'; end if;
  if p_preferred then
    update product_suppliers set is_preferred = false where organization_id = prof.organization_id and is_preferred
       and ((p_node is not null and node_id = p_node) or (p_variant is not null and variant_id = p_variant));
  end if;
  update product_suppliers set is_preferred = p_preferred, supplier_product_code = p_code
   where organization_id = prof.organization_id and supplier_id = p_supplier and ((p_node is not null and node_id = p_node) or (p_variant is not null and variant_id = p_variant)) returning * into r;
  if not found then
    insert into product_suppliers(organization_id,node_id,variant_id,supplier_id,is_preferred,supplier_product_code) values (prof.organization_id,p_node,p_variant,p_supplier,p_preferred,p_code) returning * into r;
  end if;
  perform audit(prof.organization_id,'supplier.link','product_supplier',r.id,null,to_jsonb(r));
  return r;
end $$;

create or replace function remove_product_supplier(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare prof profiles;
begin
  prof := app_require_role('administrator','inventory_manager');
  delete from product_suppliers where id = p_id and organization_id = prof.organization_id;
  if not found then raise exception 'unknown link' using errcode = 'P0002'; end if;
  perform audit(prof.organization_id,'supplier.unlink','product_supplier',p_id,null,null);
end $$;

-- Nearest preferred supplier: the variant's own link, else the closest ancestor node (block -> workbook -> folder ...) with a preferred link.
create or replace function preferred_supplier_id(p_variant uuid) returns uuid language sql stable as $$
  select supplier_id from (
    select ps.supplier_id, 0 as d from product_suppliers ps where ps.variant_id = p_variant and ps.is_preferred
    union all
    select ps.supplier_id, 1 + u.d from (
      with recursive up as (select n.id, n.parent_id, 0 as d from catalog_nodes n join lens_variants v on v.block_node_id = n.id where v.id = p_variant
                            union all select n.id, n.parent_id, up.d + 1 from catalog_nodes n join up on n.id = up.parent_id) select id, d from up) u
      join product_suppliers ps on ps.node_id = u.id and ps.is_preferred
  ) x order by d limit 1
$$;

create or replace function set_targets_for_node(p_node uuid, p_target integer, p_only_missing boolean, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare prof profiles; v record; n integer := 0;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_target is null or p_target < 0 then raise exception 'target must be a non-negative integer'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required'; end if;
  if not exists (select 1 from catalog_nodes where id = p_node and organization_id = prof.organization_id) then raise exception 'unknown node' using errcode = 'P0002'; end if;
  for v in with recursive sub as (select id from catalog_nodes where id = p_node union all select c.id from catalog_nodes c join sub on c.parent_id = sub.id)
           select lv.id, b.target_quantity from lens_variants lv join stock_balances b on b.variant_id = lv.id
           where lv.block_node_id in (select id from sub) and lv.is_active and (not p_only_missing or b.target_quantity is null) and b.target_quantity is distinct from p_target order by lv.id loop
    perform set_target_quantity(v.id, p_target, p_reason); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function decide_review_by_code(p_code text, p_status review_status, p_note text, p_file text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare prof profiles; r record; n integer := 0;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_status = 'open' then raise exception 'a decision cannot set status back to open'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'a decision note is required'; end if;
  for r in select id from review_items where organization_id = prof.organization_id and status = 'open' and code = p_code and (p_file is null or source_file = p_file) order by id loop
    perform decide_review_item(r.id, p_status, p_note); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function set_product_supplier, remove_product_supplier, preferred_supplier_id, set_targets_for_node, decide_review_by_code to authenticated;
