import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { sheetResponse } from '@/lib/xlsx';
import { fmtPower } from '@/lib/power-format';
export const dynamic = 'force-dynamic';
// Count sheet: leave "Counted" EMPTY for items not counted (blank is NOT zero). Do not edit the Variant ID column.
export const GET = route(async (_r, actor, { params }) => {
  const id = uuid.parse(params.id);
  const { s, rows } = await withActor(actor, async c => ({ s: (await c.query('select name from count_sessions where id=$1', [id])).rows[0],
    rows: (await c.query(`select l.variant_id, wn.source_name wb, bn.source_name blk, lv.row_label_source rl, lv.col_label_source cl, l.recorded_quantity, l.recorded_state, l.counted_quantity
      from count_lines l join lens_variants lv on lv.id=l.variant_id join catalog_nodes bn on bn.id=lv.block_node_id join catalog_nodes wn on wn.id=bn.parent_id
      where l.session_id=$1 order by wn.source_path, bn.sort_order, lv.source_row nulls last, lv.row_occurrence, lv.source_col nulls last`, [id])).rows }));
  return sheetResponse('count-sheet', ['Variant ID', 'Workbook', 'Block', 'Row label', 'Column label', 'Recorded', 'Recorded state', 'Counted'],
    rows.map(r => [r.variant_id, r.wb, r.blk, fmtPower(r.rl), fmtPower(r.cl), r.recorded_quantity, r.recorded_state, r.counted_quantity]),
    [['Session', s?.name ?? ''], ['Instructions', 'Fill the Counted column with whole numbers. Leave EMPTY if not counted — empty is never treated as zero. Do not change Variant ID.']]);
});