import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(await req.json());
  return withActor(actor, async c => ({ purchaseOrder: (await c.query('select * from cancel_purchase_order($1,$2)', [id, reason])).rows[0] }));
});
