import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// POST /api/counts/delete { ids: [...] } — deletes the selected counts (max 200), ALL OR NOTHING in one transaction.
// Each one goes through delete_count_session(): approved counts are refused (the whole request is then rolled back), only the count and its lines are
// removed, every deletion is audited. Administrators and inventory managers only. See db/migrations/0015_delete_count_session.sql.
export const POST = route(async (req, actor) => {
  const { ids } = z.object({ ids: z.array(uuid).min(1).max(200) }).parse(await req.json());
  const unique = [...new Set(ids)];
  return withActor(actor, async c => {
    for (const id of unique) await c.query('select delete_count_session($1)', [id]);
    return { deleted: unique.length };
  });
});