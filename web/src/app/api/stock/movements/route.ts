import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { clampPage } from '@/lib/rules';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor) => {
  const sp = req.nextUrl.searchParams; const { page, size, offset } = clampPage(sp.get('page'), sp.get('pageSize'));
  const vid = sp.get('variantId') ? uuid.parse(sp.get('variantId')) : null;
  const type = sp.get('type');
  if (type && !['opening_count', 'receipt', 'issue', 'adjustment', 'reversal'].includes(type)) throw new ApiError(400, 'bad type');
  return withActor(actor, async c => {
    const rows = await c.query(`select m.id, m.variant_id, lv.row_label_source, lv.col_label_source, m.movement_type, m.quantity_delta, m.quantity_before, m.quantity_after, m.reason, m.created_by, m.created_at
      from stock_movements m join lens_variants lv on lv.id = m.variant_id
      where ($1::uuid is null or m.variant_id = $1) and ($2::text is null or m.movement_type::text = $2)
      order by m.created_at desc, m.id limit $3 offset $4`, [vid, type, size, offset]);
    const n = await c.query(`select count(*)::int n from stock_movements m where ($1::uuid is null or m.variant_id = $1) and ($2::text is null or m.movement_type::text = $2)`, [vid, type]);
    return { page, pageSize: size, total: n.rows[0].n, items: rows.rows };
  });
});
