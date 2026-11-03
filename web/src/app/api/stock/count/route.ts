import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { CountBody } from '@/lib/validation';
export const POST = route(async (req, actor) => {
  const b = CountBody.parse(await req.json());
  return withActor(actor, async c => ({ movement: (await c.query('select * from post_physical_count($1,$2,$3,$4)', [b.variantId, b.count, b.reason, b.idempotencyKey])).rows[0] }));
});
