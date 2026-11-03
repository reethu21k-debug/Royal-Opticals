import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { MovementBody } from '@/lib/validation';
export const POST = route(async (req, actor) => {
  const b = MovementBody.parse(await req.json());
  return withActor(actor, async c => {
    const r = await c.query("select * from post_stock_movement($1, 'issue', $2, $3, null, null, $4)", [b.variantId, b.quantity, b.reason ?? null, b.idempotencyKey]);
    return { movement: r.rows[0] };
  });
});
