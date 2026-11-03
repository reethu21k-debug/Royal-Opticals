import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
const Body = z.object({ parentNodeId: uuid.nullable(), workbookName: z.string().trim().min(1).max(200) });
// Approval + execution in one database transaction (manager/administrator only). Nothing partial is ever left behind.
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ batch: (await c.query('select id, status, imported_records, held_records from execute_import_batch($1,$2,$3)', [id, b.parentNodeId, b.workbookName])).rows[0] }));
});
