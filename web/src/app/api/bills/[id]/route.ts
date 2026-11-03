import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillBody, uuid } from '@/lib/validation';
import { headerOf } from '@/lib/billing';
export const dynamic = 'force-dynamic';

// One bill with its lens lines (this is what the bill screen loads).
// Each inventory line also carries its display label and CURRENT stock, so the screen can warn before finalizing.
export const GET = route(async (_req, actor, { params }) => {
  const id = uuid.parse(params.id);
  return withActor(actor, async c => {
    const b = (await c.query('select b.*, b.bill_date::text as bill_date from bills b where b.id = $1', [id])).rows[0];
    if (!b) throw new ApiError(404, 'bill not found');
    const items = (await c.query(`select i.*,
        case when i.source = 'inventory' then coalesce(v.row_label_source, '—') || coalesce(' × ' || v.col_label_source, '') end as inventory_label,
        v.available_quantity as stock_available
      from bill_items i left join v_inventory v on v.variant_id = i.variant_id
      where i.bill_id = $1 order by i.line_no, i.side desc`, [id])).rows;
    return { bill: b, items };
  });
});

// Saves changes to a DRAFT (never changes stock). With finalize:true the bill is saved AND finalized in one transaction.
export const PUT = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = BillBody.parse(await req.json());
  return withActor(actor, async c => {
    const r = await c.query('select * from save_bill($1, $2::jsonb, $3::jsonb, $4, $5)', [id, JSON.stringify(headerOf(b)), JSON.stringify(b.items), !!b.finalize, null]);
    return { bill: r.rows[0] };
  });
});