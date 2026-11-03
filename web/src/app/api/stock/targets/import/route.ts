import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { readUpload, parseQty } from '@/lib/xlsx';
// POST multipart: file, dryRun=true|false, reason. Applies atomically (all or nothing) via set_targets_bulk (history + audit per change).
export const POST = route(async (req, actor) => {
  const form = await req.formData(); const dry = String(form.get('dryRun') ?? 'true') !== 'false'; const reason = String(form.get('reason') ?? '').slice(0, 300);
  const { header, rows } = await readUpload(form);
  if (!header.includes('Variant ID') || !header.includes('New target')) return Response.json({ error: "columns 'Variant ID' and 'New target' are required" }, { status: 400 });
  const errors: { row: number; error: string }[] = []; const items: { variant_id: string; target: number }[] = []; const seen = new Set<string>();
  for (const r of rows) {
    const vid = String(r.v['Variant ID'] ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(vid)) { errors.push({ row: r.rowNumber, error: 'invalid Variant ID' }); continue; }
    if (seen.has(vid)) { errors.push({ row: r.rowNumber, error: 'duplicate Variant ID in file' }); continue; } seen.add(vid);
    try { const n = parseQty(r.v['New target']); if (n !== null) items.push({ variant_id: vid, target: n }); } catch (e: any) { errors.push({ row: r.rowNumber, error: e.message }); }
  }
  const changed = items.length ? await withActor(actor, async c => (await c.query(`select v.variant_id, v.target_quantity as current from v_inventory v where v.variant_id = any($1::uuid[])`, [items.map(i => i.variant_id)])).rows) : [];
  const known = new Map(changed.map((r: any) => [r.variant_id, r.current]));
  for (const it of items) if (!known.has(it.variant_id)) errors.push({ row: 0, error: `unknown variant ${it.variant_id}` });
  const effective = items.filter(i => known.get(i.variant_id) !== i.target);
  if (errors.length) return Response.json({ error: 'validation failed; nothing was changed', errors: errors.slice(0, 200), errorCount: errors.length }, { status: 400 });
  if (dry) return { dryRun: true, rows: rows.length, willChange: effective.length, unchanged: items.length - effective.length, skippedBlank: rows.length - items.length };
  if (!reason) return Response.json({ error: 'a reason is required to apply target changes' }, { status: 400 });
  const n = effective.length ? await withActor(actor, async c => (await c.query('select set_targets_bulk($1::jsonb,$2) as n', [JSON.stringify(effective), reason])).rows[0].n) : 0;
  return { dryRun: false, applied: n };
});
