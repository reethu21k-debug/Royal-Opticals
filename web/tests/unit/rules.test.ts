import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedOrder, suggestedOrderForStates, stockStatus, clampPage } from '../../src/lib/rules.ts';
test('suggested order examples', () => {
  assert.equal(suggestedOrder(20, 12), 8); assert.equal(suggestedOrder(20, 20), 0);
  assert.equal(suggestedOrder(20, 25), 0); assert.equal(suggestedOrder(50, 0), 50);
});
test('unknown is never silently zero', () => { assert.equal(suggestedOrder(null, 5), null); assert.equal(suggestedOrder(20, null), null); });
test('status classification', () => {
  assert.equal(stockStatus(10, null), 'stock_unknown'); assert.equal(stockStatus(10, 0), 'out_of_stock');
  assert.equal(stockStatus(10, 4), 'below_target'); assert.equal(stockStatus(10, 12), 'ok'); assert.equal(stockStatus(null, 3), 'ok');
});
test('pagination is bounded', () => { assert.deepEqual(clampPage(0, 9999), { page: 1, size: 200, offset: 0 }); assert.equal(clampPage(3, 25).offset, 50); });
test('unverified or invalid quantities never produce a suggestion or a below-target status', () => {
  assert.equal(suggestedOrderForStates(20, 'recorded', 12, 'recorded'), 8);
  assert.equal(suggestedOrderForStates(20, 'recorded', 12, 'unverified'), null);
  assert.equal(suggestedOrderForStates(null, 'missing', 12, 'recorded'), null);
  assert.equal(suggestedOrderForStates(null, 'invalid', 12, 'recorded'), null);
  assert.equal(stockStatus(20, 12, 'unverified'), 'unverified');
  assert.equal(stockStatus(null, null, 'invalid'), 'stock_unknown');
});