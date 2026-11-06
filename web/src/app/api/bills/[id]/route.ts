import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillBody, BillRename, uuid } from '@/lib/validation';
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

// Saves changes to a bill.
//   draft     -> save_bill (never changes stock; with finalize:true it is saved AND finalized in one transaction)
//   finalized -> update_finalized_bill (stock moves by the difference, all or nothing; managers / administrators)
export const PUT = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = BillBody.parse(await req.json());
  return withActor(actor, async c => {
    const status = (await c.query('select status from bills where id = $1', [id])).rows[0]?.status;
    if (!status) throw new ApiError(404, 'bill not found');
    const r = status === 'finalized'
      ? await c.query('select * from update_finalized_bill($1, $2::jsonb, $3::jsonb)', [id, JSON.stringify(headerOf(b)), JSON.stringify(b.items)])
      : await c.query('select * from save_bill($1, $2::jsonb, $3::jsonb, $4, $5)', [id, JSON.stringify(headerOf(b)), JSON.stringify(b.items), !!b.finalize, null]);
    return { bill: r.rows[0] };
  });
});

// Corrects only the customer name. Allowed on any bill (draft, finalized or void) because it never touches lines, totals or stock.
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = BillRename.parse(await req.json());
  return withActor(actor, async c => ({ customerName: (await c.query('select rename_bill_customer($1, $2) as name', [id, b.customerName])).rows[0].name }));
});