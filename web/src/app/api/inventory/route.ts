import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { InventoryQuery } from '@/lib/validation';
import { buildInventoryQuery } from '@/lib/inventory-query';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor) => {
  const q = InventoryQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const b = buildInventoryQuery(q, { paged: true, sphFirst: q.order === 'sph' });
  return withActor(actor, async c => {
    const [rows, cnt] = await Promise.all([c.query(b.listSql, b.params), c.query(b.countSql, b.params)]);
    return { page: b.page, pageSize: b.size, total: cnt.rows[0].n, items: rows.rows };
  });
});