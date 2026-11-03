import crypto from 'node:crypto';
import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { extractWorkbook } from '@/lib/xlsx-extract';
export const dynamic = 'force-dynamic';
export const GET = route(async (_r, actor) => withActor(actor, async c => ({ items: (await c.query(
  `select id, filename, status, total_source_records, imported_records, held_records, created_at, approved_at, rolled_back_at, destination_node_id, summary->'findings' as findings
   from import_batches where filename is not null order by created_at desc limit 200`)).rows })));
// Upload -> parse (read-only, nothing live is touched) -> stage. The workbook must have the three inventory sheets.
export const POST = route(async (req, actor) => {
  const form = await req.formData(); const f = form.get('file');
  if (!(f instanceof File)) throw new ApiError(400, 'file is required');
  if (f.size === 0 || f.size > 8 * 1024 * 1024) throw new ApiError(400, 'file must be between 1 byte and 8 MB');
  if (!/\.xlsx$/i.test(f.name)) throw new ApiError(400, 'only .xlsx workbooks can be imported');
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ApiError(400, 'not an .xlsx file');
  let ex; try { ex = await extractWorkbook(buf, f.name); } catch { throw new ApiError(400, 'unreadable .xlsx file'); }
  if (!ex.isTriad) return Response.json({ error: "not an inventory workbook: it must contain the sheets 'LENS QUANTITY', 'STOCK LENS' and 'ORDER LENS'", sheets: ex.sheets.map(s => s.name) }, { status: 400 });
  const flagCounts: Record<string, number> = {}; for (const r of ex.records) for (const fl of r.flags) flagCounts[fl] = (flagCounts[fl] ?? 0) + 1;
  const stats = { positions: ex.records.length, withTarget: ex.records.filter(r => r.targetNum !== null).length, withStock: ex.records.filter(r => r.stockNum !== null).length,
    blankStock: ex.records.filter(r => r.stockRaw === null).length, blankTarget: ex.records.filter(r => r.targetRaw === null).length };
  const summary = { sheets: ex.sheets, blocks: ex.blocks, findings: ex.findings, flagCounts, stats };
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  return withActor(actor, async c => {
    const b = (await c.query('select id, filename, status, total_source_records from stage_import_batch($1,$2,$3,$4::jsonb,$5::jsonb)', [f.name.slice(0, 200), sha, buf, JSON.stringify(summary), JSON.stringify(ex.records)])).rows[0];
    return { batch: b, summary };
  });
});
