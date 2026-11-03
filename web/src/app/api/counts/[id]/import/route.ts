import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { readUpload, parseQty } from '@/lib/xlsx';
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const { header, rows } = await readUpload(await req.formData());
  if (!header.includes('Variant ID') || !header.includes('Counted')) return Response.json({ error: "columns 'Variant ID' and 'Counted' are required" }, { status: 400 });
  const errors: { row: number; error: string }[] = []; const items: { id: string; n: number | null; row: number }[] = []; const seen = new Set<string>();
  for (const r of rows) {
    const vid = String(r.v['Variant ID'] ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(vid)) { errors.push({ row: r.rowNumber, error: 'invalid Variant ID' }); continue; }
    if (seen.has(vid)) { errors.push({ row: r.rowNumber, error: 'duplicate Variant ID in file' }); continue; } seen.add(vid);
    try { const n = parseQty(r.v['Counted']); if (n !== null) items.push({ id: vid, n, row: r.rowNumber }); } catch (e: any) { errors.push({ row: r.rowNumber, error: e.message }); }
  }
  if (errors.length) return Response.json({ error: 'validation failed; nothing was imported', errors: errors.slice(0, 200), errorCount: errors.length }, { status: 400 });
  // all-or-nothing: one transaction; the session stays 'open' and nothing touches stock until a manager approves
  await withActor(actor, async c => { for (const it of items) await c.query('select record_count_line($1,$2,$3,$4)', [id, it.id, it.n, 'excel import']); });
  return { imported: items.length, skippedBlank: rows.length - items.length };
});
