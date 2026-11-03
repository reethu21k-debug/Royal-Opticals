import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid, ReviewDecision } from '@/lib/validation';
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = ReviewDecision.parse(await req.json());
  return withActor(actor, async c => ({ item: (await c.query('select id, status, decision_note from decide_review_item($1,$2::review_status,$3)', [id, b.status, b.note])).rows[0] }));
});
