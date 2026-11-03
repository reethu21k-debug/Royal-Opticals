import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
const Body = z.object({ code: z.string().trim().min(1).max(80), status: z.enum(['approved', 'rejected', 'needs_info']), note: z.string().trim().min(1).max(1000), file: z.string().max(500).optional() });
export const POST = route(async (req, actor) => {
  const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ decided: (await c.query('select decide_review_by_code($1,$2::review_status,$3,$4) as n', [b.code, b.status, b.note, b.file ?? null])).rows[0].n }));
});
