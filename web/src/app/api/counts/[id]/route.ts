import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { clampPage } from '@/lib/rules';
import { countOrderBy } from '@/lib/count-order';
export const dynamic = 'force-dynamic';

// GET /api/counts/:id?filter=all|uncounted|counted|differences&q=text&page=1&pageSize=100
export const GET = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id);
  const sp = req.nextUrl.searchParams;
  const { page, size, offset } = clampPage(sp.get('page'), sp.get('pageSize'));
  const only = sp.get('filter');
  const q = (sp.get('q') ?? '').trim().slice(0, 100);
  const all = sp.get('all') === '1';   // Grid view: return every matching line (no paging) so each block's grid is complete

  const where: string[] = ['l.session_id = $1'];
  const args: unknown[] = [id];
  if (only === 'uncounted') where.push('l.counted_quantity is null');
  else if (only === 'counted') where.push('l.counted_quantity is not null');
  else if (only === 'differences') where.push('l.counted_quantity is not null and l.counted_quantity is distinct from l.recorded_quantity');
  if (q) {
    args.push('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%');
    const p = `$${args.length}`;
    where.push(`(lv.row_label_source ilike ${p} or lv.col_label_source ilike ${p} or wn.source_name ilike ${p} or bn.source_name ilike ${p})`);
  }
  const cond = where.join(' and ');
  // order=list (List view only): inside KRIPTOK LENS / PROGRESSIVE LENS the left-hand power (SPH) is the outer key and the right-hand power the
  // inner key; every other folder and every other view (Grid, Quick, Excel sheet) keeps the original order. See lib/count-order.ts.
  const orderBy = countOrderBy(sp.get('order'));
  const from = `from count_lines l join lens_variants lv on lv.id = l.variant_id
      join catalog_nodes bn on bn.id = lv.block_node_id join catalog_nodes wn on wn.id = bn.parent_id`;

  return withActor(actor, async c => {
    const s = (await c.query('select * from count_sessions where id = $1', [id])).rows[0];
    if (!s) throw new ApiError(404, 'not found');
    const sum = (await c.query(`select count(*)::int lines,
        count(*) filter (where counted_quantity is not null)::int counted,
        count(*) filter (where counted_quantity is not null and counted_quantity is distinct from recorded_quantity)::int differences
      from count_lines where session_id = $1`, [id])).rows[0];
    const lines = (await c.query(`select l.variant_id, l.recorded_quantity, l.recorded_state, l.counted_quantity, l.note, l.result,
        lv.row_label_source, lv.col_label_source, wn.source_name as workbook, bn.source_name as block,
        (l.counted_quantity - l.recorded_quantity) as difference
      ${from} where ${cond}
      order by ${orderBy}
      ${all ? '' : `limit $${args.length + 1} offset $${args.length + 2}`}`, all ? args : [...args, size, offset])).rows;
    const total = (await c.query(`select count(*)::int n ${from} where ${cond}`, args)).rows[0].n;
    return { session: s, summary: sum, page: all ? 1 : page, pageSize: all ? Math.max(total, 1) : size, total, items: lines };
  });
});