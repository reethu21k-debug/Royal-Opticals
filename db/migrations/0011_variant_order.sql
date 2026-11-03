-- 0011: stored display order. The inventory list used to sort every row per request (CPU-bound under load). `ord` holds the rank of each
-- variant in the canonical display order (workbook path, block, power values, labels, occurrence); an index lets a page be read straight
-- from the index. It is recomputed after every import/rollback (and can be called manually).
alter table lens_variants add column ord bigint;
create index lens_variants_ord_ix on lens_variants (organization_id, ord, id);

create or replace function refresh_variant_order(p_org uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update lens_variants lv set ord = r.rn
  from (select v.id, row_number() over (order by wn.source_path, bn.sort_order, v.row_value nulls last, v.row_value2 nulls last, v.row_label_source, v.row_occurrence, v.col_value nulls last, v.id) as rn
        from lens_variants v join catalog_nodes bn on bn.id = v.block_node_id join catalog_nodes wn on wn.id = bn.parent_id where v.organization_id = p_org) r
  where lv.id = r.id and lv.ord is distinct from r.rn;
  -- keep planner statistics fresh right after a bulk change (otherwise plans can be ~2x slower until autovacuum catches up)
  analyze lens_variants; analyze stock_balances; analyze stock_movements; analyze catalog_nodes;
end $$;
select refresh_variant_order(id) from organizations;
grant execute on function refresh_variant_order to authenticated;

create or replace function execute_import_batch(p_batch uuid, p_parent uuid, p_workbook_name text)
returns import_batches language plpgsql security definer set search_path = public as $$
declare
  prof profiles; b import_batches; parent catalog_nodes; wb uuid; wbpath text; blk jsonb; bnode uuid; bmap jsonb := '{}'::jsonb; created uuid[] := '{}';
  rec record; p jsonb; vid uuid; rowkey text; colkey text; occ int; rk numeric[]; ck numeric[]; unverified boolean;
  tq int; ts quantity_state; aq int; ast quantity_state; n numeric; imp int := 0; held int := 0; f jsonb;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_workbook_name is null or length(trim(p_workbook_name)) = 0 then raise exception 'workbook name required'; end if;
  select * into b from import_batches where id = p_batch and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown import batch' using errcode = 'P0002'; end if;
  if b.status <> 'staged' then raise exception 'batch is %; only a staged batch can be executed', b.status using errcode = 'P0001'; end if;
  if p_parent is not null then
    select * into parent from catalog_nodes where id = p_parent and organization_id = prof.organization_id;
    if not found then raise exception 'unknown destination folder' using errcode = 'P0002'; end if;
    if parent.kind not in ('family','folder') then raise exception 'destination must be a folder'; end if;
  end if;
  select id into wb from catalog_nodes where organization_id = prof.organization_id and parent_id is not distinct from p_parent and kind = 'workbook' and source_name = p_workbook_name;
  wbpath := coalesce(parent.source_path || '/', '') || p_workbook_name;
  if wb is null then
    insert into catalog_nodes(organization_id,parent_id,kind,source_name,source_path) values (prof.organization_id,p_parent,'workbook',p_workbook_name,wbpath) returning id into wb;
    created := created || wb;
  end if;
  for blk in select * from jsonb_array_elements(coalesce(b.summary->'blocks','[]'::jsonb)) loop
    select id into bnode from catalog_nodes where parent_id = wb and kind = 'block' and source_name = blk->>'name';
    if bnode is null then
      insert into catalog_nodes(organization_id,parent_id,kind,source_name,source_path,sort_order) values (prof.organization_id,wb,'block',blk->>'name',wbpath || '#' || (blk->>'headerCell'),(blk->>'index')::int) returning id into bnode;
      created := created || bnode;
    end if;
    bmap := bmap || jsonb_build_object(blk->>'index', bnode);
  end loop;
  unverified := exists (select 1 from jsonb_array_elements(coalesce(b.summary->'findings','[]'::jsonb)) x where x->>'code' = 'STOCK_SHEET_IDENTICAL_TO_TARGET');
  for rec in select id, source_payload from import_records where import_batch_id = p_batch order by id loop
    p := rec.source_payload; rowkey := coalesce(p->>'rowKey',''); colkey := coalesce(p->>'colKey',''); occ := coalesce((p->>'rowOccurrence')::int,0);
    bnode := (bmap->>(p->>'blockIndex'))::uuid;
    if exists (select 1 from lens_variants where block_node_id = bnode and row_key = rowkey and row_occurrence = occ and col_key = colkey) then
      update import_records set status = 'held_existing', hold_reason = 'a variant with this identity already exists; existing stock was not touched' where id = rec.id; held := held + 1; continue;
    end if;
    rk := array(select (m)[1]::numeric from regexp_matches(rowkey, '[+-]?\d+(?:\.\d+)?', 'g') m);
    ck := array(select (m)[1]::numeric from regexp_matches(colkey, '[+-]?\d+(?:\.\d+)?', 'g') m);
    insert into lens_variants(organization_id,block_node_id,row_axis_name,col_axis_name,row_label_source,col_label_source,row_key,col_key,row_occurrence,row_value,row_value2,col_value,source_row,source_col)
    values (prof.organization_id,bnode,p->>'rowAxis',p->>'colAxis',p->>'rowLabelRaw',p->>'colLabelRaw',rowkey,colkey,occ,rk[1],rk[2],ck[1],(p->>'sourceRow')::int,(p->>'sourceCol')::int) returning id into vid;
    -- quantity states: blank -> missing (NOT zero); non-numeric / negative / fractional -> invalid (raw kept in variant_source_values)
    if p->>'targetRaw' is null then tq := null; ts := 'missing';
    elsif p->>'targetNum' is null then tq := null; ts := 'invalid';
    else n := (p->>'targetNum')::numeric; if n < 0 or n <> round(n) then tq := null; ts := 'invalid'; else tq := n::int; ts := 'recorded'; end if; end if;
    if p->>'stockRaw' is null then aq := null; ast := 'missing';
    elsif p->>'stockNum' is null then aq := null; ast := 'invalid';
    else n := (p->>'stockNum')::numeric; if n < 0 or n <> round(n) then aq := null; ast := 'invalid'; else aq := n::int; ast := case when unverified then 'unverified' else 'recorded' end; end if; end if;
    insert into stock_balances(organization_id,variant_id,target_quantity,target_state,available_quantity,available_state) values (prof.organization_id,vid,tq,ts,aq,ast);
    if aq is not null then
      insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,reference_type,import_batch_id,created_by)
      values (prof.organization_id,vid,'opening_count',aq,null,aq,'opening balance from source workbook' || case when unverified then ' (UNVERIFIED: stock grid equals target grid)' else '' end,'import_batch',p_batch,prof.id);
    end if;
    insert into variant_source_values(variant_id,import_record_id,target_raw,stock_raw,legacy_order_formula,legacy_order_cached,source_flags)
    values (vid,rec.id,p->>'targetRaw',p->>'stockRaw',p->>'orderFormula',p->>'orderCached',coalesce(array(select jsonb_array_elements_text(p->'flags')),'{}'));
    update import_records set status = 'imported', variant_id = vid where id = rec.id; imp := imp + 1;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(b.summary->'findings','[]'::jsonb)) loop
    insert into review_items(organization_id,import_batch_id,severity,code,source_file,detail) values (prof.organization_id,p_batch,f->>'severity',f->>'code',b.filename,f->>'detail');
  end loop;
  update import_batches set status = 'imported', imported_records = imp, held_records = held, approved_by = prof.id, approved_at = now(), destination_node_id = wb,
         summary = summary || jsonb_build_object('created_nodes', to_jsonb(created)) where id = p_batch returning * into b;
  perform refresh_variant_order(prof.organization_id);
  perform audit(prof.organization_id,'import.execute','import_batch',b.id,null,jsonb_build_object('imported',imp,'held',held,'workbook',wbpath));
  return b;
end $$;

create or replace function rollback_import_batch(p_batch uuid, p_reason text) returns import_batches
language plpgsql security definer set search_path = public as $$
declare prof profiles; b import_batches; later int; po int; cnt int; v record; nid text;
begin
  prof := app_require_role('administrator','inventory_manager');
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a reason is required'; end if;
  select * into b from import_batches where id = p_batch and organization_id = prof.organization_id for update;
  if not found then raise exception 'unknown import batch' using errcode = 'P0002'; end if;
  if b.status <> 'imported' then raise exception 'only an imported batch can be rolled back (status=%)', b.status using errcode = 'P0001'; end if;
  select count(*) into later from stock_movements m join import_records r on r.variant_id = m.variant_id and r.import_batch_id = p_batch where m.movement_type <> 'opening_count' or m.import_batch_id is distinct from p_batch;
  select count(*) into po from purchase_order_items i join import_records r on r.variant_id = i.variant_id and r.import_batch_id = p_batch;
  select count(*) into cnt from count_lines l join import_records r on r.variant_id = l.variant_id and r.import_batch_id = p_batch;
  if later + po + cnt > 0 then raise exception 'cannot roll back: % later stock movement(s), % order line(s), % count line(s) refer to imported variants', later, po, cnt using errcode = 'P0001'; end if;
  for v in select s.variant_id, s.available_quantity from stock_balances s join import_records r on r.variant_id = s.variant_id where r.import_batch_id = p_batch and r.status = 'imported' for update of s loop
    if v.available_quantity is not null then
      insert into stock_movements(organization_id,variant_id,movement_type,quantity_delta,quantity_before,quantity_after,reason,reference_type,import_batch_id,created_by)
      values (prof.organization_id,v.variant_id,'reversal',-v.available_quantity,v.available_quantity,0,'import rollback: ' || p_reason,'import_batch',p_batch,prof.id);
      update stock_balances set available_quantity = 0, version = version + 1, updated_at = now() where variant_id = v.variant_id;
    end if;
  end loop;
  update lens_variants set is_active = false where id in (select variant_id from import_records where import_batch_id = p_batch and status = 'imported');
  update import_records set status = 'rolled_back' where import_batch_id = p_batch and status = 'imported';
  for nid in select jsonb_array_elements_text(coalesce(b.summary->'created_nodes','[]'::jsonb)) loop update catalog_nodes set is_active = false where id = nid::uuid; end loop;
  update import_batches set status = 'rolled_back', rolled_back_at = now() where id = p_batch returning * into b;
  perform audit(prof.organization_id,'import.rollback','import_batch',b.id,null,jsonb_build_object('reason',p_reason));
  return b;
end $$;
grant execute on function execute_import_batch, rollback_import_batch to authenticated;
