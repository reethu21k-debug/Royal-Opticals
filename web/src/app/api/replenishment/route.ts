import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { InventoryQuery } from '@/lib/validation';
import { buildInventoryQuery } from '@/lib/inventory-query';
export const dynamic = 'force-dynamic';
// Suggested orders: ONLY positions where both target and available are known and available < target.
// Positions with unknown stock are reported separately (needs a count) — never assumed 0.
export const GET = route(async (req, actor) => {
  const q = InventoryQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return withActor(actor, async c => {
    const netOn = (await c.query("select app_setting('net_replenishment_enabled') as v")).rows[0].v === true;
    const useNet = netOn && q.net === '1';
    const b = buildInventoryQuery(q, { paged: true, extraWhere: useNet ? 'i.net_suggested_order > 0' : 'i.suggested_order > 0' });
    const [rows, cnt, unk] = await Promise.all([c.query(b.listSql, b.params), c.query(b.countSql, b.params),
      c.query("select count(*)::int n from v_inventory where stock_status = 'stock_unknown' and target_quantity is not null")]);
    const ids = rows.rows.map((r: any) => r.variant_id);
    const sup = ids.length ? (await c.query('select v.id as variant_id, s.id as supplier_id, s.supplier_name from unnest($1::uuid[]) v(id) join suppliers s on s.id = preferred_supplier_id(v.id)', [ids])).rows : [];
    const sm = new Map(sup.map((x: any) => [x.variant_id, x])); for (const r of rows.rows as any[]) { const x: any = sm.get(r.variant_id); r.preferred_supplier_id = x?.supplier_id ?? null; r.preferred_supplier = x?.supplier_name ?? null; }
    return { netEnabled: netOn, usingNet: useNet, page: b.page, pageSize: b.size, total: cnt.rows[0].n, needsCountWithTarget: unk.rows[0].n, items: rows.rows };
  });
});
