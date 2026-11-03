import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { loadBills, billsPdf, billsXlsx, exportName } from '@/lib/bill-export';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Download bills as PDF or Excel.
//   /api/bills/export?format=pdf&ids=<id>,<id>…          the bills you selected (max 200)
//   /api/bills/export?format=xlsx&from=2026-11-01&to=2026-11-30&status=finalized&q=…     every bill matching the filters (max 2000)
export const GET = route(async (req, actor) => {
  const sp = req.nextUrl.searchParams; const format = sp.get('format');
  if (format !== 'pdf' && format !== 'xlsx') throw new ApiError(400, 'format must be pdf or xlsx');
  const raw = sp.get('ids'); const ids = raw ? raw.split(',').map(x => uuid.parse(x.trim())) : undefined;
  if (ids && ids.length > 200) throw new ApiError(400, 'select at most 200 bills at a time, or download by date filter instead');
  const loaded = await withActor(actor, c => loadBills(c as any, { ids, sp }));
  if (!loaded.bills.length) throw new ApiError(404, 'no bills match');
  const body = format === 'pdf' ? await billsPdf(loaded) : await billsXlsx(loaded);
  const type = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${exportName(loaded.bills, sp)}.${format}"`, 'cache-control': 'no-store' } });
});