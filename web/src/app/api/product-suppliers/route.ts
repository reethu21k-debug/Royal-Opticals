import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor) => {
  const sp = req.nextUrl.searchParams; const nodeId = sp.get('nodeId') ? uuid.parse(sp.get('nodeId')) : null; const variantId = sp.get('variantId') ? uuid.parse(sp.get('variantId')) : null;
  if ((nodeId === null) === (variantId === null)) throw new ApiError(400, 'exactly one of nodeId or variantId is required');
  return withActor(actor, async c => {
    const links = (await c.query(`select ps.id, ps.supplier_id, s.supplier_name, ps.is_preferred, ps.supplier_product_code from product_suppliers ps join suppliers s on s.id = ps.supplier_id
      where ($1::uuid is null or ps.node_id = $1) and ($2::uuid is null or ps.variant_id = $2) order by s.supplier_name`, [nodeId, variantId])).rows;
    const eff = variantId ? (await c.query('select s.id, s.supplier_name from suppliers s where s.id = preferred_supplier_id($1)', [variantId])).rows[0] ?? null : null;
    return { items: links, effectivePreferred: eff };
  });
});
const Body = z.object({ nodeId: uuid.optional(), variantId: uuid.optional(), supplierId: uuid, preferred: z.boolean().default(false), supplierProductCode: z.string().trim().max(60).optional() });
export const POST = route(async (req, actor) => {
  const b = Body.parse(await req.json());
  return withActor(actor, async c => ({ link: (await c.query('select * from set_product_supplier($1,$2,$3,$4,$5)', [b.nodeId ?? null, b.variantId ?? null, b.supplierId, b.preferred, b.supplierProductCode ?? null])).rows[0] }));
});
