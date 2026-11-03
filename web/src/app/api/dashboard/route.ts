import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
export const dynamic = 'force-dynamic';
export const GET = route(async (_req, actor) => withActor(actor, async c => {
  const i = await c.query(`select count(*)::int variants, coalesce(sum(available_quantity),0)::int units_available,
      count(*) filter (where stock_status='below_target')::int below_target, count(*) filter (where stock_status='out_of_stock')::int out_of_stock,
      count(*) filter (where stock_status='stock_unknown')::int stock_unknown, count(*) filter (where available_state='unverified')::int unverified,
      count(*) filter (where suggested_order > 0)::int suggested_lines, coalesce(sum(suggested_order),0)::int suggested_units,
      count(*) filter (where target_quantity is null)::int no_target from v_inventory where is_active`);
  const p = await c.query(`select count(*) filter (where status='confirmed')::int open_pos, count(*) filter (where status='partially_received')::int partial_pos from purchase_orders`);
  const r = await c.query(`select count(*) filter (where status='open')::int open_reviews, count(*) filter (where status='open' and severity='HIGH')::int open_high from review_items`);
  const a = await c.query(`select m.movement_type, m.quantity_delta, m.created_at, m.variant_id, lv.row_label_source, lv.col_label_source, pr.full_name as actor, m.reason
      from stock_movements m join lens_variants lv on lv.id = m.variant_id left join profiles pr on pr.id = m.created_by order by m.created_at desc, m.id limit 10`);
  const att = await c.query(`select i.variant_id, i.row_label_source, i.col_label_source, i.target_quantity, i.available_quantity, i.suggested_order, i.stock_status, wn.source_name as workbook
      from v_inventory i join catalog_nodes bn on bn.id = i.block_node_id join catalog_nodes wn on wn.id = bn.parent_id
      where i.is_active and i.suggested_order > 0 order by i.suggested_order desc, i.variant_id limit 10`);
  const imp = await c.query(`select id, filename, status, created_at from import_batches where filename is not null and status = 'staged' order by created_at desc limit 5`);
  return { inventory: i.rows[0], purchasing: p.rows[0], review: r.rows[0], recent: a.rows, attention: att.rows, pendingImports: imp.rows };
}));
