import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';

// Link one supplier to many groups in a single request (one transaction). Uses the same set_product_supplier() rules as the
// single-link endpoint: role checks, audit trail, and "making a supplier preferred replaces the previous preferred one on that group".
const Link = z.object({
  supplierId: uuid,
  nodeIds: z.array(uuid).min(1).max(500),
  preferred: z.boolean().default(false),
  supplierProductCode: z.string().trim().max(60).optional(),
});
export const POST = route(async (req, actor) => {
  const b = Link.parse(await req.json());
  const ids = [...new Set(b.nodeIds)];
  return withActor(actor, async c => {
    for (const id of ids) await c.query('select set_product_supplier($1::uuid, null::uuid, $2::uuid, $3::boolean, $4::text)', [id, b.supplierId, b.preferred, b.supplierProductCode ?? null]);
    return { linked: ids.length };
  });
});

// Remove several supplier links at once.
const Unlink = z.object({ linkIds: z.array(uuid).min(1).max(500) });
export const DELETE = route(async (req, actor) => {
  const b = Unlink.parse(await req.json());
  const ids = [...new Set(b.linkIds)];
  return withActor(actor, async c => {
    for (const id of ids) await c.query('select remove_product_supplier($1::uuid)', [id]);
    return { removed: ids.length };
  });
});