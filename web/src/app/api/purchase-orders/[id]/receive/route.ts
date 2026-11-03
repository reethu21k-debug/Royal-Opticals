import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid, PoReceiveBody } from '@/lib/validation';
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = PoReceiveBody.parse(await req.json());
  return withActor(actor, async c => ({ receipt: (await c.query('select * from receive_purchase_order($1,$2::jsonb,$3,$4)',
    [id, JSON.stringify(b.items.map(i => ({ item_id: i.itemId, quantity: i.quantity }))), b.receiptNumber, b.idempotencyKey])).rows[0] }));
});
