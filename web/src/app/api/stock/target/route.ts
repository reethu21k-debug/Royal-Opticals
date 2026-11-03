import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { TargetBody } from '@/lib/validation';
export const POST = route(async (req, actor) => {
  const b = TargetBody.parse(await req.json());
  return withActor(actor, async c => ({ balance: (await c.query('select * from set_target_quantity($1,$2,$3)', [b.variantId, b.target, b.reason ?? null])).rows[0] }));
});
