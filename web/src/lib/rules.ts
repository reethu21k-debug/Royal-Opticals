// Pure business rules (no DB, no framework). Unit-tested in tests/unit/rules.test.ts.
// "Unknown is never silently zero": a missing quantity or target never produces a suggestion or a below-target status.

/** MAX(0, target - available). NULL when either side is unknown. */
export function suggestedOrder(target: number | null | undefined, available: number | null | undefined): number | null {
  if (target === null || target === undefined || available === null || available === undefined) return null;
  return Math.max(0, target - available);
}

/** Same, but both quantities must be VERIFIED (state = 'recorded'); missing / invalid / unverified never produce a suggestion. */
export function suggestedOrderForStates(
  target: number | null | undefined, targetState: string | null | undefined,
  available: number | null | undefined, availableState: string | null | undefined,
): number | null {
  if (targetState !== 'recorded' || availableState !== 'recorded') return null;
  return suggestedOrder(target, available);
}

export type StockStatus = 'stock_unknown' | 'unverified' | 'out_of_stock' | 'below_target' | 'ok';

/** Mirrors the SQL view v_inventory.stock_status. */
export function stockStatus(
  target: number | null | undefined, available: number | null | undefined, availableState?: string | null,
): StockStatus {
  if (availableState === 'unverified') return 'unverified';
  if (available === null || available === undefined) return 'stock_unknown';
  if (available === 0) return 'out_of_stock';
  if (target !== null && target !== undefined && available < target) return 'below_target';
  return 'ok';
}

/** Bounded pagination: page >= 1, 1 <= size <= 200 (default 50). */
export function clampPage(page: unknown, pageSize: unknown): { page: number; size: number; offset: number } {
  const p = Math.floor(Number(page));
  const s = Math.floor(Number(pageSize));
  const pg = Number.isFinite(p) && p >= 1 ? p : 1;
  const size = Number.isFinite(s) && s >= 1 ? Math.min(200, s) : 50;
  return { page: pg, size, offset: (pg - 1) * size };
}