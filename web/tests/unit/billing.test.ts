import test from 'node:test';
import assert from 'node:assert/strict';
import { deductions, balanceOf, lineAmount, fmtPower } from '../../src/lib/billing.ts';

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