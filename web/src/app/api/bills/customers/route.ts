import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
export const dynamic = 'force-dynamic';

// Customer finder: customers grouped by name (case and extra spaces ignored), with how many bills each has.
// ?q=ravi searches by name; with no q it returns the most recently billed customers.
export const GET = route(async (req, actor) => {
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const p: unknown[] = []; let w = `where b.customer_name is not null and btrim(b.customer_name) <> ''`;
  if (q) { p.push('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'); w += ` and b.customer_name ilike $1`; }
  return withActor(actor, async c => ({ items: (await c.query(`select min(btrim(b.customer_name)) as name, count(*)::int as bill_count,
      count(*) filter (where b.status = 'finalized')::int as finalized, count(*) filter (where b.status = 'draft')::int as draft, count(*) filter (where b.status = 'void')::int as void,
      coalesce(sum(b.total_amount) filter (where b.status <> 'void'), 0) as total_billed, max(b.bill_date)::text as last_bill_date
    from bills b ${w} group by lower(regexp_replace(btrim(b.customer_name), '\\s+', ' ', 'g')) order by max(b.bill_date) desc, 1 limit 25`, p)).rows }));
});