import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { loadBills, statementPdf, statementXlsx, statementName } from '@/lib/bill-export';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One customer's complete billing history as PDF or Excel.   /api/bills/customers/export?name=Ravi&format=pdf
export const GET = route(async (req, actor) => {
  const sp = req.nextUrl.searchParams; const format = sp.get('format'); const name = sp.get('name')?.trim().slice(0, 200) ?? '';
  if (format !== 'pdf' && format !== 'xlsx') throw new ApiError(400, 'format must be pdf or xlsx');
  if (!name) throw new ApiError(400, 'customer name is required');
  const loaded = await withActor(actor, c => loadBills(c as any, { sp: new URLSearchParams({ customer: name }) }));
  if (!loaded.bills.length) throw new ApiError(404, 'no bills found for this customer');
  const shown = loaded.bills[0].customer_name?.trim() || name;
  const body = format === 'pdf' ? await statementPdf(shown, loaded) : await statementXlsx(shown, loaded);
  const type = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${statementName(shown)}.${format}"`, 'cache-control': 'no-store' } });
});