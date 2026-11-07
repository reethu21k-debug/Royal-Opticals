import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';

// Save targets from the "Targets" grid on the stock-count screen. One request = one transaction (all or nothing).
// Each change goes through set_targets_bulk() -> set_target_quantity(): administrators / inventory managers only, target history + audit entry,
// and available stock is never touched.
const Body = z.object({
  items: z.array(z.object({ variantId: uuid, target: z.number().int().min(0).max(1_000_000) })).min(1).max(500),
  reason: z.string().trim().min(1).max(300).optional(),
});
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    const s = (await c.query('select name from count_sessions where id = $1', [id])).rows[0];
    if (!s) throw new ApiError(404, 'not found');
    const items = b.items.map(i => ({ variant_id: i.variantId, target: i.target }));
    const n = (await c.query('select set_targets_bulk($1::jsonb, $2) as n', [JSON.stringify(items), b.reason ?? `Set during stock count: ${s.name}`.slice(0, 300)])).rows[0].n;
    return { saved: n };
  });
});