import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';
const Body = z.object({ name: z.string().trim().min(1).max(120), nodeId: uuid.optional(), variantIds: z.array(uuid).min(1).max(5000).optional() });
export const GET = route(async (_r, actor) => withActor(actor, async c => ({ items: (await c.query(`select s.*, n.source_name as scope_name,
  (select count(*)::int from count_lines l where l.session_id = s.id) as lines,
  (select count(*)::int from count_lines l where l.session_id = s.id and l.counted_quantity is not null) as counted
  from count_sessions s left join catalog_nodes n on n.id = s.scope_node_id order by s.created_at desc limit 200`)).rows })));
export const POST = route(async (req, actor) => {
  const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ session: (await c.query('select * from create_count_session($1,$2,$3::uuid[])', [b.name, b.nodeId ?? null, b.variantIds ?? null])).rows[0] }));
});
