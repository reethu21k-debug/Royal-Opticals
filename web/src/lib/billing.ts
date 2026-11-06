// Pure billing helpers shared by the API routes and the billing screen (no React, no DB).
export const headerOf = (b: { customerName?: string; billDate?: string; oldBalance?: number; returnAmount?: number; advanceAmount?: number; notes?: string }) =>
  ({ customerName: b.customerName, billDate: b.billDate, oldBalance: b.oldBalance, returnAmount: b.returnAmount, advanceAmount: b.advanceAmount, notes: b.notes });

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const lineAmount = (qty: number, rate: number) => round2((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(rate) ? rate : 0));
/** Same formula the database uses: balance = O.B. + total − return − advance. */
export const balanceOf = (total: number, oldBalance: number, ret: number, advance: number) => round2(oldBalance + total - ret - advance);
export const money = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** System-wide power standard: always exactly two decimals, no added sign — 1 → "1.00", -0.5 → "-0.50", 0 → "0.00", -2.25 → "-2.25". Display only. */
export const fmtPower = (v: number | string | null | undefined) => { if (v === null || v === undefined || v === '') return ''; const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : ''; };

/** Pure rule used by the screen for its live "will be deducted" preview. The database enforces the same rule on finalize. */
export type StockLine = { source: 'inventory' | 'external'; variantId?: string | null; quantity: number };
export function deductions(lines: StockLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.source === 'inventory' && l.variantId && l.quantity > 0) m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.quantity);
  return m;
}

/** Customer names are free text, so "Ravi", "ravi " and "RAVI  K" are matched case-insensitively with spaces collapsed. The SQL in bill-filters.ts applies the same rule. */
export const normName = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export type SummaryBill = { status?: string; total_amount?: unknown; balance_amount?: unknown; bill_date?: string; bill_number?: string };
/** Customer statement totals. Void bills are counted but never billed. Balance is taken from the latest non-void bill (each bill's balance already carries the old balance, so adding balances up would count it twice). */
export function summarizeBills(bills: SummaryBill[]) {
  const live = bills.filter(b => b.status !== 'void');
  const latest = live.slice().sort((a, b) => String(a.bill_date ?? '').localeCompare(String(b.bill_date ?? '')) || String(a.bill_number ?? '').localeCompare(String(b.bill_number ?? ''))).pop();
  return {
    total: bills.length, finalized: bills.filter(b => b.status === 'finalized').length, draft: bills.filter(b => b.status === 'draft').length, void: bills.length - live.length,
    billed: round2(live.reduce((t, b) => t + Number(b.total_amount ?? 0), 0)), latestBalance: latest ? round2(Number(latest.balance_amount ?? 0)) : 0,
  };
}

/** Stock change when a bill is edited: new quantity minus old quantity per lens (positive = take more from stock, negative = put back). Zero changes are left out. */
export function stockDelta(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of new Set([...before.keys(), ...after.keys()])) { const d = (after.get(k) ?? 0) - (before.get(k) ?? 0); if (d !== 0) m.set(k, d); }
  return m;
}