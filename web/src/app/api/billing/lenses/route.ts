import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillLensQuery } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// Lens finder for the billing screen: searches the existing inventory (name words + optional exact SPH / CYL / ADD) and returns CURRENT stock.
// Power columns use the same derivation as the inventory page filters (SPH = row value of SPH/COMP rows, CYL = CYL column/row or 2nd COMP part, ADD = ADD column).
export const GET = route(async (req, actor) => {
  const f = BillLensQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const p: unknown[] = []; const w: string[] = [];
  for (const word of (f.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    p.push('%' + word.replace(/[\\%_]/g, m => '\\' + m) + '%');
    w.push(`(x.workbook || ' ' || x.block || ' ' || coalesce(x.row_label_source, '') || ' ' || coalesce(x.col_label_source, '')) ilike $${p.length}`);
  }
  for (const [col, v] of [['sph', f.sph], ['cyl', f.cyl], ['add_power', f.add]] as const) if (v !== undefined) { p.push(v); w.push(`x.${col} is not null and abs(x.${col} - $${p.length}) < 0.001`); }
  if (!w.length) return { items: [], needFilter: true };    // never list the whole catalogue
  return withActor(actor, async c => ({ needFilter: false, items: (await c.query(`select * from (
      select i.variant_id, i.row_label_source, i.col_label_source, i.available_quantity, i.available_state, i.stock_status, wn.source_name as workbook, bn.source_name as block, lv.ord,
        (case when i.row_axis_name ~* 'SPH|COMP' then lv.row_value end) as sph,
        coalesce(case when i.col_axis_name ~* 'CYL' then lv.col_value end, case when i.row_axis_name ~* 'CYL' then lv.row_value end, lv.row_value2) as cyl,
        (case when i.col_axis_name ~* 'ADD' then lv.col_value end) as add_power
      from v_inventory i join lens_variants lv on lv.id = i.variant_id join catalog_nodes bn on bn.id = i.block_node_id join catalog_nodes wn on wn.id = bn.parent_id
      where i.is_active) x where ${w.join(' and ')} order by x.ord, x.variant_id limit 40`, p)).rows }));
});