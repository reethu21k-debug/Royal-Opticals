import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export const GET = route(async (_r, actor, { params }) => {
  const id = uuid.parse(params.id);
  return withActor(actor, async c => {
    const po = (await c.query('select p.*, s.supplier_name from purchase_orders p join suppliers s on s.id=p.supplier_id where p.id=$1', [id])).rows[0];
    if (!po) throw new ApiError(404, 'not found');
    const items = (await c.query(`select i.*, (i.quantity_ordered - i.quantity_received)::int outstanding, lv.row_label_source, lv.col_label_source from purchase_order_items i join lens_variants lv on lv.id=i.variant_id where i.purchase_order_id=$1`, [id])).rows;
    return { purchaseOrder: po, items };
  });
});
