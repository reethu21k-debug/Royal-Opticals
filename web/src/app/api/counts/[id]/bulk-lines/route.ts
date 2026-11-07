import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';

// Save many count entries in ONE request / ONE transaction (grid paste, "match system stock", "set blanks to 0", "clear block").
// Each entry goes through the same record_count_line() as a single entry: role check, open-session check, NULL = not counted (never 0).
const Body = z.object({
  items: z.array(z.object({ variantId: uuid, count: z.number().int().min(0).max(1_000_000).nullable() })).min(1).max(500),
});
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    for (const it of b.items) await c.query('select record_count_line($1::uuid, $2::uuid, $3::integer, null::text)', [id, it.variantId, it.count]);
    return { saved: b.items.length };
  });
});