import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { InventoryQuery } from '@/lib/validation';
import { buildInventoryQuery } from '@/lib/inventory-query';
import { fmtPower } from '@/lib/power-format';
import { sheetResponse } from '@/lib/xlsx';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor) => {
  const q = InventoryQuery.parse(Object.fromEntries(req.nextUrl.searchParams)); const b = buildInventoryQuery(q, { paged: false });
  const rows = await withActor(actor, async c => (await c.query(b.listSql, b.params)).rows);
  return sheetResponse('targets', ['Variant ID', 'Workbook', 'Block', 'Row label', 'Column label', 'Current target', 'Available', 'New target'],
    rows.map(r => [r.variant_id, r.workbook, r.block, fmtPower(r.row_label_source), fmtPower(r.col_label_source), r.target_quantity, r.available_quantity, null]),
    [['Instructions', "Fill 'New target' with whole numbers; leave empty to keep the current target. Do not change Variant ID."]]);
});