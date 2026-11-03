import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
export const POST = route(async (_r, actor, { params }) => withActor(actor, async c => ({ purchaseOrder: (await c.query('select * from confirm_purchase_order($1)', [uuid.parse(params.id)])).rows[0] })));
