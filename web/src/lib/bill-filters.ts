import { ApiError } from './http';
import { normName } from './billing';

// Shared by the bills list and the bills download: search text, status and bill-date range.
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

export function billWhere(sp: URLSearchParams, p: unknown[] = []) {
  const w: string[] = [];
  const q = sp.get('q')?.trim().slice(0, 100) ?? ''; const status = sp.get('status') ?? '';
  const from = sp.get('from') ?? ''; const to = sp.get('to') ?? '';
  if (q) { p.push('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'); w.push(`(b.bill_number ilike $${p.length} or b.customer_name ilike $${p.length})`); }
  const customer = normName(sp.get('customer')?.slice(0, 200));
  if (customer) { p.push(customer); w.push(`lower(regexp_replace(btrim(b.customer_name), '\\s+', ' ', 'g')) = $${p.length}`); }   // exact customer (same normalisation as normName)
  if (['draft', 'finalized', 'void'].includes(status)) { p.push(status); w.push(`b.status = $${p.length}::bill_status`); }
  if (from) { if (!isDate(from)) throw new ApiError(400, 'invalid "from" date'); p.push(from); w.push(`b.bill_date >= $${p.length}::date`); }
  if (to) { if (!isDate(to)) throw new ApiError(400, 'invalid "to" date'); p.push(to); w.push(`b.bill_date <= $${p.length}::date`); }
  return { where: w.length ? 'where ' + w.join(' and ') : '', params: p };
}