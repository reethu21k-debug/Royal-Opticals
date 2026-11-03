import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
export const GET = route(async (_req, actor, { params }) => {
  const id = uuid.parse(params.id);
  return withActor(actor, async c => {
    const v = await c.query(`select i.*, node_path(i.block_node_id) as path, lv.attributes, lv.row_value, lv.row_value2, lv.col_value
        from v_inventory i join lens_variants lv on lv.id = i.variant_id where i.variant_id = $1`, [id]);
    if (!v.rows[0]) throw new ApiError(404, 'not found');
    const src = await c.query('select target_raw, stock_raw, legacy_order_formula, legacy_order_cached, source_flags from variant_source_values where variant_id = $1', [id]);
    const rec = await c.query("select source_file, source_sheet, source_cell, status, hold_reason from import_records where variant_id = $1", [id]);
    const mv = await c.query(`select id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_by, created_at
        from stock_movements where variant_id = $1 order by created_at desc, id limit 100`, [id]);
    return { variant: v.rows[0], source: src.rows[0] ?? null, importRecords: rec.rows, movements: mv.rows };
  });
});

export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const { isActive } = z.object({ isActive: z.boolean() }).parse(await req.json());
  return withActor(actor, async c => ({ variant: (await c.query('select id, is_active from set_variant_active($1,$2)', [id, isActive])).rows[0] }));
});
