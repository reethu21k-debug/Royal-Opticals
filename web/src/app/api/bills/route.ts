import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillBody } from '@/lib/validation';
import { headerOf } from '@/lib/billing';
import { billWhere } from '@/lib/bill-filters';
export const dynamic = 'force-dynamic';

// Filters: q (bill number / customer), status, from / to (bill date, YYYY-MM-DD, both inclusive).
export const GET = route(async (req, actor) => {
  const f = billWhere(req.nextUrl.searchParams);
  return withActor(actor, async c => ({ items: (await c.query(`select b.id, b.bill_number, b.customer_name, b.bill_date::text as bill_date, b.status, b.total_amount, b.balance_amount, b.created_at,
      (select count(*)::int from bill_items i where i.bill_id = b.id and i.source = 'inventory') as inventory_lines,
      (select count(*)::int from bill_items i where i.bill_id = b.id and i.source = 'external') as external_lines
    from bills b ${f.where} order by b.bill_date desc, b.created_at desc limit 500`, f.params)).rows }));
});

// Saves a draft (never changes stock). With finalize:true the bill is saved AND finalized in one transaction:
// inventory lines are deducted, external lines are not, and any failure (e.g. not enough stock) undoes everything.
export const POST = route(async (req, actor) => {
  const b = BillBody.parse(await req.json());
  return withActor(actor, async c => {
    const r = await c.query('select * from save_bill(null, $1::jsonb, $2::jsonb, $3, $4)', [JSON.stringify(headerOf(b)), JSON.stringify(b.items), !!b.finalize, b.idempotencyKey ?? null]);
    return { bill: r.rows[0] };
  });
});