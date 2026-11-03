import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
// Session lifecycle against Supabase Auth (GoTrue REST): password login, refresh-token rotation, logout.
// Tested against a protocol-level MOCK of GoTrue (web/tests/api_integration.py); NOT yet run against a live Supabase project.
const Body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
const secure = () => process.env.NODE_ENV === 'production';
const authCfg = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY });
function setSession(res: NextResponse, j: any) {
  res.cookies.set('ro_session', j.access_token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: Math.min(Number(j.expires_in) || 3600, 3600) });
  // the refresh token is only ever sent to /api/session (never to pages or other APIs)
  if (j.refresh_token) res.cookies.set('ro_refresh', j.refresh_token, { httpOnly: true, secure: secure(), sameSite: 'strict', path: '/api/session', maxAge: 60 * 60 * 24 * 7 });
}
async function gotrue(grant: 'password' | 'refresh_token', payload: object) {
  const { url, key } = authCfg(); if (!url || !key) return { status: 503 as const, j: { error: 'authentication is not configured' } };
  const r = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: r.status, j: await r.json().catch(() => ({})) as any, ok: r.ok };
}
export async function POST(req: NextRequest) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  const g = await gotrue('password', b.data);
  if (g.status === 503) return NextResponse.json(g.j, { status: 503 });
  if (!('ok' in g) || !g.ok || !g.j.access_token) return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  const res = NextResponse.json({ ok: true }); setSession(res, g.j); return res;
}
// Silent refresh: exchange the refresh cookie for a new access token (GoTrue rotates the refresh token).
export async function PUT(req: NextRequest) {
  const rt = req.cookies.get('ro_refresh')?.value; if (!rt) return NextResponse.json({ error: 'no session' }, { status: 401 });
  const g = await gotrue('refresh_token', { refresh_token: rt });
  if (g.status === 503) return NextResponse.json(g.j, { status: 503 });
  if (!('ok' in g) || !g.ok || !g.j.access_token) { const res = NextResponse.json({ error: 'session expired' }, { status: 401 }); res.cookies.set('ro_refresh', '', { path: '/api/session', maxAge: 0 }); return res; }
  const res = NextResponse.json({ ok: true }); setSession(res, g.j); return res;
}
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('ro_session', '', { path: '/', maxAge: 0 }); res.cookies.set('ro_refresh', '', { path: '/api/session', maxAge: 0 }); return res;
}
