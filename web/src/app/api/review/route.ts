import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { clampPage } from '@/lib/rules';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor) => {
  const sp = req.nextUrl.searchParams; const { page, size, offset } = clampPage(sp.get('page'), sp.get('pageSize'));
  const status = sp.get('status') ?? 'open'; const code = sp.get('code');
  return withActor(actor, async c => {
    const rows = await c.query(`select id, severity, code, source_file, source_sheet, source_cell, detail, status, decision_note, decided_at from review_items
      where status::text = $1 and ($2::text is null or code = $2) order by case severity when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, code, source_file limit $3 offset $4`, [status, code, size, offset]);
    const n = await c.query('select count(*)::int n from review_items where status::text = $1 and ($2::text is null or code = $2)', [status, code]);
    return { page, pageSize: size, total: n.rows[0].n, items: rows.rows };
  });
});
