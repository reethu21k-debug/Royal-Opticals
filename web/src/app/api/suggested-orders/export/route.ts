import ExcelJS from 'exceljs';
import { z } from 'zod';
import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { InventoryQuery } from '@/lib/validation';
import { buildInventoryQuery } from '@/lib/inventory-query';
import { XLSX_MIME } from '@/lib/xlsx';
import { renderOrderGridPdf, cellKey, type GridBlock } from '@/lib/order-report-pdf';
import { fmtPower } from '@/lib/power-format';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Suggested-orders report (PDF or Excel). The PDF is laid out like the client's printed ORDER LENS sheets: one SPH x CYL (or ADD) grid per block,
// for every block under the chosen level of the hierarchy (family, folder, workbook or a single block; none chosen = everything). Same rules as /api/replenishment: ONLY positions where both target and available are known and
// available < target. Unlike the on-screen list this is NOT paged: every lens matching the current filters is included, so the totals at the
// end are for the whole result, not just one page. Labels are printed exactly as stored. Strings are plain cells (never formulas).
const REPORT_TZ = 'Asia/Kolkata';
const Format = z.enum(['pdf', 'xlsx']).default('pdf');
const ROOT_SEP = ' / ';

type Line = { variantId: string; blockId: string; lensType: string; workbook: string; block: string; row: string; col: string; stock: number | null; target: number | null; qty: number; supplier: string };
type Group = { lensType: string; lines: Line[]; units: number; blocks: { key: string; workbook: string; block: string; lines: Line[]; units: number }[] };

const lensLabel = (l: Line) => `${l.row}${l.col ? '  x  ' + l.col : ''}`;
const n0 = (v: number | null) => (v === null || v === undefined ? '—' : String(v));

function groupLines(lines: Line[]): Group[] {
  const m = new Map<string, Group>();
  for (const l of lines) {
    let g = m.get(l.lensType); if (!g) { g = { lensType: l.lensType, lines: [], units: 0, blocks: [] }; m.set(l.lensType, g); }
    g.lines.push(l); g.units += l.qty;
    const key = `${l.workbook}\u0001${l.block}`;
    let b = g.blocks.find(x => x.key === key); if (!b) { b = { key, workbook: l.workbook, block: l.block, lines: [], units: 0 }; g.blocks.push(b); }
    b.lines.push(l); b.units += l.qty;
  }
  return Array.from(m.values());
}

export const GET = route(async (req, actor) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const format = Format.parse(sp.format);
  const q = InventoryQuery.parse(sp);

  const { lines, usingNet, filterText, blocks, nodeName } = await withActor(actor, async c => {
    const netOn = (await c.query("select app_setting('net_replenishment_enabled') as v")).rows[0].v === true;
    const useNet = netOn && q.net === '1';
    const b = buildInventoryQuery(q, { paged: false, extraWhere: useNet ? 'i.net_suggested_order > 0' : 'i.suggested_order > 0' });
    const rows = (await c.query(b.listSql, b.params)).rows as any[];
    const ids = rows.map(r => r.variant_id);
    const sup = ids.length ? (await c.query('select v.id as variant_id, s.supplier_name from unnest($1::uuid[]) v(id) join suppliers s on s.id = preferred_supplier_id(v.id)', [ids])).rows : [];
    const sm = new Map<string, string>(sup.map((x: any) => [x.variant_id, x.supplier_name]));
    const lines: Line[] = rows.map(r => ({
      variantId: r.variant_id, blockId: r.block_node_id,
      lensType: String(r.path ?? '').split(ROOT_SEP)[0] || 'Other', workbook: r.workbook ?? '', block: r.block ?? '',
      row: fmtPower(r.row_label_source), col: fmtPower(r.col_label_source), stock: r.available_quantity, target: r.target_quantity,
      qty: Number(useNet ? r.net_suggested_order : r.suggested_order) || 0, supplier: sm.get(r.variant_id) ?? 'None set',
    }));
    const f: string[] = [];
    if (q.nodeId) f.push(`Group: ${(await c.query('select node_path($1) as p', [q.nodeId])).rows[0]?.p ?? q.nodeId}`);
    if (q.q) f.push(`Search: "${q.q}"`);
    if (q.status) f.push(`Urgency: ${q.status === 'out_of_stock' ? 'Out of stock' : q.status === 'below_target' ? 'Below target' : q.status}`);
    for (const [label, lo, hi] of [['SPH', q.sphMin, q.sphMax], ['CYL', q.cylMin, q.cylMax], ['ADD', q.addMin, q.addMax]] as const)
      if (lo !== undefined || hi !== undefined) f.push(`${label}: ${lo ?? '…'} to ${hi ?? '…'}`);
    if (useNet) f.push('Net of open purchase orders (differs from the original Excel rule)');
    // PDF only: the full grid shape of every block that has something to order (so empty positions stay blank, as on the printed sheet).
    const blocks: GridBlock[] = [];
    if (format === 'pdf' && lines.length) {
      const qtyByVariant = new Map(lines.map(l => [l.variantId, l.qty]));
      const blockIds = [...new Set(lines.map(l => l.blockId))];
      const nodes = (await c.query(`select bn.id, bn.source_name as title, node_path(bn.id) as path, coalesce(wn.source_path, wn.source_name) as wpath, bn.sort_order
        from catalog_nodes bn left join catalog_nodes wn on wn.id = bn.parent_id where bn.id = any($1::uuid[]) order by wpath, bn.sort_order, bn.id`, [blockIds])).rows as any[];
      const cells = (await c.query(`select lv.id as variant_id, lv.block_node_id, lv.row_axis_name, lv.col_axis_name, lv.row_label_source, lv.col_label_source,
          lv.row_key, lv.col_key, lv.row_occurrence, lv.source_row, lv.source_col, lv.ord
        from lens_variants lv where lv.block_node_id = any($1::uuid[])`, [blockIds])).rows as any[];
      const byBlock = new Map<string, any[]>();
      for (const v of cells) { const a = byBlock.get(v.block_node_id); if (a) a.push(v); else byBlock.set(v.block_node_id, [v]); }
      for (const n of nodes) {
        const vs = byBlock.get(n.id) ?? [];
        const rowMap = new Map<string, { key: string; label: string; o: number; occ: number }>();
        const colMap = new Map<string, { key: string; label: string; o: number }>();
        const qty = new Map<string, number>();
        for (const v of vs) {
          const rk = `${v.row_key}#${v.row_occurrence}`; const ro = v.source_row ?? 1e9, co = v.source_col ?? 1e9;
          const a = rowMap.get(rk); if (!a || ro < a.o) rowMap.set(rk, { key: rk, label: fmtPower(v.row_label_source), o: ro, occ: v.row_occurrence });
          const b = colMap.get(v.col_key); if (!b || co < b.o) colMap.set(v.col_key, { key: v.col_key, label: fmtPower(v.col_label_source), o: co });
          const q = qtyByVariant.get(v.variant_id); if (q !== undefined && q > 0) qty.set(cellKey(rk, v.col_key), q);
        }
        if (qty.size === 0) continue;
        blocks.push({
          title: n.title, rowAxis: vs[0]?.row_axis_name ?? '', colAxis: vs[0]?.col_axis_name ?? '',
          rows: [...rowMap.values()].sort((x, y) => x.o - y.o || x.occ - y.occ), cols: [...colMap.values()].sort((x, y) => x.o - y.o), qty,
        });
      }
    }
    const nodeName: string | null = q.nodeId ? ((await c.query('select source_name from catalog_nodes where id = $1', [q.nodeId])).rows[0]?.source_name ?? null) : null;
    return { lines, usingNet: useNet, filterText: f, blocks, nodeName };
  });

  const groups = groupLines(lines);
  const totalLenses = lines.length; const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  const now = new Date();
  const stamp = now.toLocaleString('en-IN', { timeZone: REPORT_TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const slug = nodeName ? '-' + nodeName.replace(/[^A-Za-z0-9+.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) : '';
  const fileBase = `order-report${slug}-${now.toISOString().slice(0, 10)}`;
  const qtyHeader = usingNet ? 'Net order qty' : 'Order qty';

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const bold = { bold: true };
    const ws = wb.addWorksheet('Order list');
    ws.columns = [['Lens type', 28], ['Workbook', 26], ['Block', 28], ['Lens (row)', 14], ['Column', 14], ['Stock', 10], ['Target', 10], [qtyHeader, 12], ['Preferred supplier', 26]]
      .map(([header, width]) => ({ header: header as string, width: width as number }));
    ws.getRow(1).font = bold; ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const g of groups) for (const l of g.lines) ws.addRow([g.lensType, l.workbook, l.block, l.row, l.col, l.stock, l.target, l.qty, l.supplier]);
    ws.autoFilter = { from: 'A1', to: { row: 1, column: 9 } };
    ws.addRow([]);
    const t1 = ws.addRow(['TOTAL LENSES TO ORDER', '', '', '', '', '', '', totalLenses]); const t2 = ws.addRow(['TOTAL UNITS TO ORDER', '', '', '', '', '', '', totalUnits]);
    t1.font = bold; t2.font = bold;
    const ws2 = wb.addWorksheet('By lens type');
    ws2.columns = [{ header: 'Lens type', width: 34 }, { header: 'Lenses to order', width: 18 }, { header: 'Units to order', width: 18 }];
    ws2.getRow(1).font = bold; ws2.views = [{ state: 'frozen', ySplit: 1 }];
    for (const g of groups) ws2.addRow([g.lensType, g.lines.length, g.units]);
    ws2.addRow([]); ws2.addRow(['TOTAL', totalLenses, totalUnits]).font = bold;
    const info = wb.addWorksheet('Report info'); info.getColumn(1).width = 22; info.getColumn(2).width = 90;
    info.addRows([['Report', 'Suggested orders'], ['Generated', stamp], ['Filters', filterText.length ? filterText.join('; ') : 'None (all suggested orders)'], ['Lenses to order', totalLenses], ['Units to order', totalUnits],
      ['Note', 'Order qty = MAX(0, target − available). Lenses with no recorded stock or no target are left out. This is a suggestion, not a purchase order.']]);
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, { headers: { 'content-type': XLSX_MIME, 'content-disposition': `attachment; filename="${fileBase}.xlsx"` } });
  }

  // ───── PDF ─────
  const pdf = await renderOrderGridPdf(blocks, { stamp, filters: filterText, netNote: usingNet });
  return new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fileBase}.pdf"` } });
});