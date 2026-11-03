import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillAction, uuid } from '@/lib/validation';
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = BillAction.parse(await req.json());
  return withActor(actor, async c => ({
    bill: (b.action === 'finalize' ? await c.query('select * from finalize_bill($1)', [id]) : await c.query('select * from void_bill($1, $2)', [id, b.reason])).rows[0],
  }));
});