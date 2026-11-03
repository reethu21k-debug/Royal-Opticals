import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';
// The matrix is generated from the SAME variant rows as the table; it holds no quantities of its own.
export const GET = route(async (_req, actor, { params }) => {
  const id = uuid.parse(params.id);
  return withActor(actor, async c => {
    const node = (await c.query('select id, kind, source_name, node_path(id) as path from catalog_nodes where id = $1', [id])).rows[0];
    if (!node) throw new ApiError(404, 'not found');
    const v = (await c.query(`select i.variant_id, i.row_axis_name, i.col_axis_name, i.row_label_source, i.col_label_source, lv.row_key, lv.col_key, i.row_occurrence,
        lv.source_row, lv.source_col, i.target_quantity, i.target_state, i.available_quantity, i.available_state, i.suggested_order, i.stock_status
      from v_inventory i join lens_variants lv on lv.id = i.variant_id where i.block_node_id = $1`, [id])).rows;
    const rowMap = new Map<string, { key: string; label: string | null; occurrence: number; order: number }>();
    const colMap = new Map<string, { key: string; label: string | null; order: number }>();
    for (const r of v) {
      const rk = `${r.row_key}#${r.row_occurrence}`; const ro = r.source_row ?? 1e9, co = r.source_col ?? 1e9;
      const a = rowMap.get(rk); if (!a || ro < a.order) rowMap.set(rk, { key: rk, label: r.row_label_source, occurrence: r.row_occurrence, order: ro });
      const b = colMap.get(r.col_key); if (!b || co < b.order) colMap.set(r.col_key, { key: r.col_key, label: r.col_label_source, order: co });
    }
    const rows = [...rowMap.values()].sort((x, y) => x.order - y.order || x.occurrence - y.occurrence);
    const cols = [...colMap.values()].sort((x, y) => x.order - y.order);
    const ri = new Map(rows.map((r, i) => [r.key, i])), ci = new Map(cols.map((c, i) => [c.key, i]));
    const cells = v.map(r => ({ ri: ri.get(`${r.row_key}#${r.row_occurrence}`)!, ci: ci.get(r.col_key)!, variantId: r.variant_id, target: r.target_quantity, targetState: r.target_state,
      available: r.available_quantity, availableState: r.available_state, suggestedOrder: r.suggested_order, status: r.stock_status }));
    return { node, rowAxis: v[0]?.row_axis_name ?? null, colAxis: v[0]?.col_axis_name ?? null, rows, cols, cells };
  });
});
