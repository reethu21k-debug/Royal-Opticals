import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOrderBy } from '../../src/lib/count-order.ts';

const ORIGINAL = 'wn.source_path, bn.sort_order, lv.source_row nulls last, lv.row_occurrence, lv.source_col nulls last';

test('default order (Grid, Quick, count sheet) is the original and is not affected by the List order', () => {
  assert.equal(countOrderBy(null), ORIGINAL);
  assert.equal(countOrderBy(undefined), ORIGINAL);
  assert.equal(countOrderBy(''), ORIGINAL);
  assert.equal(countOrderBy('grid'), ORIGINAL);
});

test('List order: left-hand power (SPH) is the outer key, right-hand power the inner key', () => {
  const s = countOrderBy('list');
  assert.ok(s.startsWith(ORIGINAL), s);
  assert.ok(s.indexOf('lv.source_row') < s.indexOf('lv.source_col'));
});

test('List order only adds a tie-break inside KRIPTOK LENS / PROGRESSIVE LENS; it is NULL for every other folder', () => {
  const s = countOrderBy('list');
  const tail = s.slice(ORIGINAL.length);
  assert.match(tail, /case when split_part\(wn\.source_path, '\/', 1\) in \('KRIPTOK LENS', 'PROGRESSIVE LENS'\) then lv\.id end/);
  assert.doesNotMatch(s, /SINGLE VISION/);
});