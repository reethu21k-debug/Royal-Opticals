import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { REPORTS } from '@/lib/reports';
import { clampPage } from '@/lib/rules';
import { sheetResponse } from '@/lib/xlsx';
import { fmtPower } from '@/lib/power-format';
export const dynamic = 'force-dynamic';
const D = /^\d{4}-\d{2}-\d{2}$/;
// Report columns that hold lens powers are shown with two decimals (display only; the query and its numbers are untouched).
const LABEL_COLS = ['Row label', 'Column label'];
const cell = (name: string, v: unknown) => (LABEL_COLS.includes(name) ? fmtPower(v as string | null) : v);
export const GET = route(async (req, actor, { params }) => {
  const def = REPORTS[params.name]; if (!def) throw new ApiError(404, 'unknown report');
  const sp = req.nextUrl.searchParams; const from = sp.get('from') || null; const to = sp.get('to') || null;
  if ((from && !D.test(from)) || (to && !D.test(to))) throw new ApiError(400, 'dates must be YYYY-MM-DD');
  const { page, size, offset } = clampPage(sp.get('page'), sp.get('pageSize'));
  if (sp.get('format') === 'xlsx') {
    const r = await withActor(actor, c => c.query(`select * from (${def.sql}) t limit 50000`, [from, to]));
    return sheetResponse(params.name, r.fields.map(f => f.name), r.rows.map(row => r.fields.map(f => row[f.name] instanceof Date ? (row[f.name] as Date).toISOString() : cell(f.name, row[f.name]))),
      [['Report', def.title], ['Generated (UTC)', new Date().toISOString()], ['From', from ?? ''], ['To', to ?? ''], ['Note', def.note ?? ''], ['Rows', String(r.rowCount)]]);
  }
  return withActor(actor, async c => {
    const rows = await c.query(`select * from (${def.sql}) t limit $3 offset $4`, [from, to, size, offset]);
    const n = await c.query(`select count(*)::int n from (${def.sql}) t`, [from, to]);
    return { title: def.title, note: def.note ?? null, columns: rows.fields.map(f => f.name), page, pageSize: size, total: n.rows[0].n, rows: rows.rows.map((row: any) => ({ ...row, ...Object.fromEntries(LABEL_COLS.filter(k => k in row).map(k => [k, fmtPower(row[k])])) })) };
  });
});