// Display order of the lines of a stock count. DISPLAY ONLY: it never selects, inserts, updates or deletes anything.
//
// "default" is the original order and is what Quick, Grid, the Excel count sheet and every other caller get. It is NOT changed here.
//   workbook path, block, left-hand power (source_row), duplicate occurrence, right-hand power (source_col)
//
// "list" is requested ONLY by the Stock Counts → List view (`?order=list`). Grid view never sends it.
//   KRIPTOK LENS and PROGRESSIVE LENS: SPH-first, second power second — the left-hand power is the OUTER loop and the right-hand power the INNER loop:
//       0.00 × 1.00, 0.00 × 1.25, … 0.00 × 3.00, 0.25 × 1.00, 0.25 × 1.25, …
//     (in these workbooks the right-hand axis is the ADD column, 1.00 → 3.00 in steps of 0.25)
//   every other folder (SINGLE VISION LENS and anything else): exactly the original order — nothing about it changes.
//
// The folder is the first segment of the workbook's source_path (e.g. 'KRIPTOK LENS/BLUE CUT KT/…').

export const SPH_FIRST_FOLDERS = ['KRIPTOK LENS', 'PROGRESSIVE LENS'] as const;

const BASE = 'wn.source_path, bn.sort_order';
const DEFAULT_KEYS = 'lv.source_row nulls last, lv.row_occurrence, lv.source_col nulls last';
const IN_SCOPE = `split_part(wn.source_path, '/', 1) in (${SPH_FIRST_FOLDERS.map(f => `'${f}'`).join(', ')})`;

export function countOrderBy(order: string | null | undefined): string {
  if (order !== 'list') return `${BASE}, ${DEFAULT_KEYS}`;
  // Same keys, in the same order, as the original for every folder. lv.id is added only inside the two in-scope folders (it only breaks exact
  // ties so paging stays stable); for all other folders that key is NULL, so their order is byte-for-byte the original.
  return `${BASE}, ${DEFAULT_KEYS}, (case when ${IN_SCOPE} then lv.id end)`;
}