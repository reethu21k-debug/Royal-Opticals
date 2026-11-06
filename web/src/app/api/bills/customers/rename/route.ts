import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { CustomerRename } from '@/lib/validation';
export const dynamic = 'force-dynamic';

// Renames a customer on all of their bills (names matched ignoring case and extra spaces). If the new name already exists, the two customers become one.
export const POST = route(async (req, actor) => {
  const b = CustomerRename.parse(await req.json());
  return withActor(actor, async c => ({ updated: (await c.query('select rename_customer($1, $2) as n', [b.from, b.to])).rows[0].n }));
});