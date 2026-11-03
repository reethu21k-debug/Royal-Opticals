import ExcelJS from 'exceljs';
import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { InventoryQuery } from '@/lib/validation';
import { buildInventoryQuery } from '@/lib/inventory-query';
import { fmtPower } from '@/lib/power-format';
export const dynamic = 'force-dynamic';
// Strings are written as plain string cells (never formulas), so exact source labels such as "+0.25+0.50" are preserved
// and cannot execute. We deliberately do NOT prefix quotes (that would alter the original labels).
export const GET = route(async (req, actor) => {
  const q = InventoryQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const b = buildInventoryQuery(q, { paged: false });
  const rows = await withActor(actor, async c => (await c.query(b.listSql, b.params)).rows);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inventory');
  ws.columns = ['Path', 'Workbook', 'Block', 'Row axis', 'Row label', 'Column axis', 'Column label', 'Row occurrence', 'Target', 'Target state', 'Available', 'Available state', 'Suggested order', 'Legacy order (blank as 0, informational)', 'Status']
    .map(h => ({ header: h, width: h === 'Path' ? 60 : 18 }));
  for (const r of rows) ws.addRow([r.path, r.workbook, r.block, r.row_axis_name, fmtPower(r.row_label_source), r.col_axis_name, fmtPower(r.col_label_source), r.row_occurrence + 1,
    r.target_quantity, r.target_state, r.available_quantity, r.available_state, r.suggested_order, r.legacy_suggested_order_blank_as_zero, r.stock_status]);
  const meta = wb.addWorksheet('Export info');
  meta.addRows([['Exported at (UTC)', new Date().toISOString()], ['Rows', rows.length], ['Filters', JSON.stringify(q)],
    ['Note', 'Blank Target/Available = not recorded in the source (NOT zero). Suggested order = MAX(0, target - available); blank when either is unknown.']]);
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="inventory-export.xlsx"' } });
});