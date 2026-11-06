import test from 'node:test';
import assert from 'node:assert/strict';
import { deductions, balanceOf, lineAmount, fmtPower, normName, summarizeBills, stockDelta } from '../../src/lib/billing.ts';

test('only inventory lines are deducted; external never', () => {
  const m = deductions([
    { source: 'inventory', variantId: 'a', quantity: 2 }, { source: 'external', variantId: 'a', quantity: 5 }, { source: 'external', quantity: 1 },
    { source: 'inventory', variantId: 'a', quantity: 1 }, { source: 'inventory', variantId: 'b', quantity: 1 },
  ]);
  assert.deepEqual(Array.from(m), [['a', 3], ['b', 1]]);
});
test('amounts and balance follow the sheet', () => {
  assert.equal(lineAmount(2, 99.99), 199.98);
  assert.equal(balanceOf(500, 50, 20, 100), 430);
});
test('power formatting: always two decimals, no added sign', () => {
  const cases: [number | string | null | undefined, string][] = [[1, '1.00'], [0.5, '0.50'], [-1, '-1.00'], [-0.5, '-0.50'], [0, '0.00'], [-2.25, '-2.25'], ['-2.5', '-2.50'], ['1', '1.00'], [null, ''], [undefined, ''], ['', '']];
  for (const [i, o] of cases) assert.equal(fmtPower(i), o, String(i));
});
test('customer names match ignoring case and extra spaces', () => {
  assert.equal(normName('  Ravi   Kumar '), 'ravi kumar'); assert.equal(normName('RAVI KUMAR'), normName('ravi kumar')); assert.equal(normName(null), '');
});
test('customer summary: void bills counted but not billed; balance from latest non-void bill', () => {
  const r = summarizeBills([
    { status: 'finalized', bill_date: '2026-10-01', bill_number: 'B1', total_amount: '500', balance_amount: '430' },
    { status: 'void', bill_date: '2026-10-20', bill_number: 'B3', total_amount: '900', balance_amount: '900' },
    { status: 'draft', bill_date: '2026-10-10', bill_number: 'B2', total_amount: '100.5', balance_amount: '530.5' },
  ]);
  assert.deepEqual(r, { total: 3, finalized: 1, draft: 1, void: 1, billed: 600.5, latestBalance: 530.5 });
  assert.deepEqual(summarizeBills([]), { total: 0, finalized: 0, draft: 0, void: 0, billed: 0, latestBalance: 0 });
});
test('editing a finalized bill: stock moves only by the difference', () => {
  const before = new Map([['a', 2], ['b', 1], ['c', 3]]); const after = new Map([['a', 3], ['c', 3], ['d', 1]]);
  assert.deepEqual(Array.from(stockDelta(before, after)).sort(), [['a', 1], ['b', -1], ['d', 1]]);
  assert.equal(stockDelta(new Map(), new Map([['x', 2]])).get('x'), 2);   // a draft: everything is "new"
});