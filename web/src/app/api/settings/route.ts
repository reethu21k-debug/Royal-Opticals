import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
const DEFAULT_REASONS = ['Sale / dispatch', 'Transfer', 'Damaged', 'Return to supplier', 'Other'];
export const GET = route(async (_r, actor) => withActor(actor, async c => {
  const rows = (await c.query('select key, value from system_settings')).rows; const m = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  return { issueReasons: m.issue_reasons ?? null, issueReasonsSuggested: DEFAULT_REASONS, netReplenishmentEnabled: m.net_replenishment_enabled === true };
}));
const Body = z.object({ issueReasons: z.array(z.string().trim().min(1).max(80)).max(30).optional(), netReplenishmentEnabled: z.boolean().optional() });
export const PUT = route(async (req, actor) => {
  const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    if (b.issueReasons) await c.query("select set_setting('issue_reasons', $1::jsonb)", [JSON.stringify(b.issueReasons)]);
    if (b.netReplenishmentEnabled !== undefined) await c.query("select set_setting('net_replenishment_enabled', $1::jsonb)", [JSON.stringify(b.netReplenishmentEnabled)]);
    return { ok: true };
  });
});
