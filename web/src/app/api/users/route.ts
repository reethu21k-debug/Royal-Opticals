import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { ApiError } from '@/lib/http';
export const dynamic = 'force-dynamic';
// Lists users of the caller's organisation. Creating Supabase Auth accounts requires the service-role key and is done in the Supabase dashboard;
// this app manages roles/activation of existing profiles only (the service-role key is never used in the web app).
export const GET = route(async (_r, actor) => withActor(actor, async c => ({ items: (await c.query('select id, full_name, role, is_active, created_at from profiles order by full_name')).rows })));

const Create = z.object({ email: z.string().email().max(254), fullName: z.string().trim().min(1).max(120), password: z.string().min(12).max(200),
  role: z.enum(['administrator', 'inventory_manager', 'inventory_staff', 'read_only']) });
// Administrator-only. Creates the Supabase Auth account with the SERVICE-ROLE key (server-side env only, never sent to the browser), then the profile
// row with the chosen role. If the profile cannot be created the auth account is removed again, so no orphan login is left behind.
export const POST = route(async (req, actor) => {
  const b = Create.parse(await req.json());
  const isAdmin = await withActor(actor, async c => (await c.query("select app_role_of() = 'administrator' as a")).rows[0].a);
  if (!isAdmin) throw new ApiError(403, 'only an administrator can create users');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new ApiError(503, 'account creation is not configured');
  const r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: b.email, password: b.password, email_confirm: true }) });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 422 || r.status === 409) throw new ApiError(409, 'an account with this email already exists');
  if (!r.ok || !j.id) throw new ApiError(502, 'could not create the account');
  try { return await withActor(actor, async c => ({ user: (await c.query('select id, full_name, role, is_active from create_profile($1,$2,$3::app_role)', [j.id, b.fullName, b.role])).rows[0] })); }
  catch (e) { await fetch(`${url}/auth/v1/admin/users/${j.id}`, { method: 'DELETE', headers: { apikey: key, authorization: `Bearer ${key}` } }).catch(() => undefined); throw e; }
});
