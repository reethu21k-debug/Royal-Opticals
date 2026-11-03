import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
const Body = z.object({ nodeId: uuid, target: z.number().int().min(0).max(1_000_000), onlyMissing: z.boolean().default(false), reason: z.string().trim().min(1).max(300) });
// Sets the target for every active variant under a folder/workbook/block. All-or-nothing; each change is recorded in target history.
export const POST = route(async (req, actor) => {
  const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ changed: (await c.query('select set_targets_for_node($1,$2,$3,$4) as n', [b.nodeId, b.target, b.onlyMissing, b.reason])).rows[0].n }));
});
