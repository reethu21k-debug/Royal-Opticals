import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

// Supabase signs access tokens either with the legacy shared secret (HS256) or, on newer projects, with an asymmetric key (ES256/RS256/EdDSA)
// published at <SUPABASE_URL>/auth/v1/.well-known/jwks.json. Both are supported; the algorithm is taken from the token header but only
// from a fixed allow-list, and an HS256 token is accepted only if it verifies against SUPABASE_JWT_SECRET.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function remoteKeys() {
  const base = process.env.SUPABASE_URL; if (!base) return null;
  return (jwks ??= createRemoteJWKSet(new URL(base.replace(/\/+$/, '') + '/auth/v1/.well-known/jwks.json'), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }));
}
export async function getActor(req: NextRequest): Promise<string> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = bearer || req.cookies.get('ro_session')?.value;
  if (!token) throw new ApiError(401, 'not authenticated');
  try {
    const alg = decodeProtectedHeader(token).alg;
    let payload;
    if (alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET; if (!secret) throw new Error('no secret');
      payload = (await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })).payload;
    } else if (alg === 'ES256' || alg === 'RS256' || alg === 'EdDSA') {
      const keys = remoteKeys(); if (!keys) throw new Error('no SUPABASE_URL');
      payload = (await jwtVerify(token, keys, { algorithms: ['ES256', 'RS256', 'EdDSA'] })).payload;
    } else throw new Error('unsupported alg');
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new Error('bad sub');
    return payload.sub;
  } catch (e: any) { console.error('token rejected:', e?.message); throw new ApiError(401, 'invalid or expired session'); }
}

type Ctx = { params: Record<string, string> };
// Fixed-window rate limiter (per user, per instance). NOTE: in-memory, so on serverless it limits per instance only;
// put a shared limiter (e.g. edge/Redis) in front for strict guarantees.
const WINDOWS = new Map<string, { n: number; t: number }>();
function limited(key: string, max: number, ms = 60_000): boolean {
  const now = Date.now(); const w = WINDOWS.get(key);
  if (!w || now - w.t > ms) { WINDOWS.set(key, { n: 1, t: now }); if (WINDOWS.size > 20000) for (const [k, v] of WINDOWS) if (now - v.t > ms) WINDOWS.delete(k); return false; }
  return ++w.n > max;
}
function sameOrigin(req: NextRequest): boolean {   // CSRF defence in depth (cookie is SameSite=Lax): reject cross-origin state changes
  const o = req.headers.get('origin'); if (!o) return true; try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}
export function route(fn: (req: NextRequest, actor: string, ctx: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && !sameOrigin(req)) throw new ApiError(403, 'cross-origin request rejected');
      const actor = await getActor(req);
      if (limited(`${actor}:${write ? 'w' : 'r'}`, write ? Number(process.env.RATE_LIMIT_WRITES ?? 120) : Number(process.env.RATE_LIMIT_READS ?? 600))) throw new ApiError(429, 'too many requests, slow down');
      const out = await fn(req, actor, ctx);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e: any) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: 'validation failed', issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 });
      const code = e?.code as string | undefined;
      if (code === '42501') return NextResponse.json({ error: e.message?.replace(/^.*?:\s*/, '') || 'forbidden' }, { status: 403 });
      if (code === 'P0002') return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (code === 'P0001') return NextResponse.json({ error: e.message }, { status: 409 });   // business-rule rejection (messages are authored in SQL)
      if (code && /^23/.test(code)) return NextResponse.json({ error: 'conflicts with existing data' }, { status: 409 });
      if (code === '22P02') return NextResponse.json({ error: 'malformed identifier' }, { status: 400 });
      console.error('unhandled', code, e?.message, e?.stack);   // details to logs
      if (process.env.NODE_ENV !== 'production') return NextResponse.json({ error: 'internal error: ' + (e?.message ?? 'unknown') }, { status: 500 });   // dev only: show the real cause
      return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
  };
}