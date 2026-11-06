import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { BillDelete } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// Deletes the selected bills (all or nothing, max 200). A finalized bill's inventory lenses are put back in stock first; a copy of every deleted bill is kept in the audit log.
export const POST = route(async (req, actor) => {
  const b = BillDelete.parse(await req.json());
  return withActor(actor, async c => ({ deleted: (await c.query('select delete_bills($1::uuid[]) as n', [b.ids])).rows[0].n }));
});