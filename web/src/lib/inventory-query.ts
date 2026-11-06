import { InventoryQuery } from './validation';
import { clampPage } from './rules';
import { z } from 'zod';

export function buildInventoryQuery(raw: z.infer<typeof InventoryQuery>, opts: { paged: boolean; extraWhere?: string }) {
  const params: unknown[] = []; const where: string[] = []; let cte = '';
  if (raw.nodeId) {
    params.push(raw.nodeId);
    cte = `with recursive sub as (select id from catalog_nodes where id = $${params.length} union all select c.id from catalog_nodes c join sub on c.parent_id = sub.id) `;
    where.push('i.block_node_id in (select id from sub)');
  }
  if (raw.status) { params.push(raw.status); where.push(`i.stock_status = $${params.length}`); }
  if (raw.q) {
    params.push('%' + raw.q.replace(/[\\%_]/g, m => '\\' + m) + '%');
    const p = `$${params.length}`;
    where.push(`(i.row_label_source ilike ${p} or i.col_label_source ilike ${p} or wn.source_name ilike ${p} or bn.source_name ilike ${p})`);
  }
  // Power filters: SPH = row value of SPH/COMP rows; CYL = CYL column/row value or the 2nd part of a COMP label; ADD = ADD column value.
  // A position that does not have the attribute is excluded when that filter is used (nothing is guessed).
  const SPH = "(case when i.row_axis_name ~* 'SPH|COMP' then lv.row_value end)";
  const CYL = "coalesce(case when i.col_axis_name ~* 'CYL' then lv.col_value end, case when i.row_axis_name ~* 'CYL' then lv.row_value end, lv.row_value2)";
  const ADD = "(case when i.col_axis_name ~* 'ADD' then lv.col_value end)";
  const rng = (expr: string, lo?: number, hi?: number) => {
    if (lo !== undefined) { params.push(lo); where.push(`${expr} >= $${params.length}`); }
    if (hi !== undefined) { params.push(hi); where.push(`${expr} <= $${params.length}`); }
  };
  rng(SPH, raw.sphMin, raw.sphMax); rng(CYL, raw.cylMin, raw.cylMax); rng(ADD, raw.addMin, raw.addMax);
  const act = raw.active ?? 'active';
  if (act === 'active') where.push('i.is_active'); else if (act === 'archived') where.push('not i.is_active');
  if (opts.extraWhere) where.push(opts.extraWhere);
  const w = where.length ? 'where ' + where.join(' and ') : '';
  const from = `from v_inventory i join lens_variants lv on lv.id = i.variant_id
    join catalog_nodes bn on bn.id = i.block_node_id join catalog_nodes wn on wn.id = bn.parent_id ${w}`;
  const { page, size, offset } = clampPage(raw.page, raw.pageSize);
  // Inner query: cheap columns + sort keys only. node_path() and last_movement are computed in the OUTER query, i.e. only for the returned page
  // (computing them inside made deep pages scan/evaluate the whole table).
  const inner = `select i.variant_id, i.block_node_id, i.row_axis_name, i.col_axis_name, i.row_label_source, i.col_label_source, i.row_occurrence,
      i.target_quantity, i.target_state, i.available_quantity, i.available_state, i.suggested_order, i.legacy_suggested_order_blank_as_zero,
      i.stock_status, i.is_active, i.on_order_quantity, i.net_suggested_order, wn.source_name as workbook, bn.source_name as block,
      lv.ord as s1`;
  const dir = raw.dir === 'desc' ? 'desc' : 'asc';   // only the direction changes; the sort keys (catalogue order, then variant id) stay the same
  const order = `order by s1 ${dir}, variant_id ${dir}`;
  const lim = opts.paged ? ` limit ${size} offset ${offset}` : ' limit 50000';
  const outerCols = `p.variant_id, p.block_node_id, p.row_axis_name, p.col_axis_name, p.row_label_source, p.col_label_source, p.row_occurrence,
      p.target_quantity, p.target_state, p.available_quantity, p.available_state, p.suggested_order, p.legacy_suggested_order_blank_as_zero,
      p.stock_status, p.is_active, p.on_order_quantity, p.net_suggested_order, p.workbook, p.block, node_path(p.block_node_id) as path,
      (select max(m.created_at) from stock_movements m where m.variant_id = p.variant_id) as last_movement`;
  // Planner note: with no/dense filters the page is read straight from the (organization_id, ord) index. Selective filters (text search, folder,
  // power ranges) make the planner walk that index looking for matches, which is slower than filtering first — so those are materialised first.
  const selective = !!(raw.q || raw.nodeId || raw.sphMin !== undefined || raw.sphMax !== undefined || raw.cylMin !== undefined || raw.cylMax !== undefined || raw.addMin !== undefined || raw.addMax !== undefined);
  let listSql: string;
  if (selective) {
    const prefix = cte ? cte.trim() + ', ' : 'with ';
    listSql = `${prefix}m as materialized (${inner} ${from}) select ${outerCols} from (select * from m ${order}${lim}) p order by p.s1 ${dir}, p.variant_id ${dir}`;
  } else {
    listSql = `select ${outerCols} from (${inner} ${from} ${order}${lim}) p order by p.s1 ${dir}, p.variant_id ${dir}`;
  }
  const countSql = `${cte}select count(*)::int as n ${from}`;
  return { listSql, countSql, params, page, size };
}