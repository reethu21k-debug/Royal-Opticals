import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
const Body = z.object({ variantId: uuid, count: z.number().int().min(0).max(1_000_000).nullable(), note: z.string().max(300).optional() });
export const PUT = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ line: (await c.query('select * from record_count_line($1,$2,$3,$4)', [id, b.variantId, b.count, b.note ?? null])).rows[0] }));
});
