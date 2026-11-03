import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
export const DELETE = route(async (_r, actor, { params }) => withActor(actor, async c => { await c.query('select remove_product_supplier($1)', [uuid.parse(params.id)]); return { ok: true }; }));
