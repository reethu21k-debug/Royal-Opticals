import { Pool, PoolClient } from 'pg';
const g = globalThis as unknown as { __pool?: Pool };
function pool(): Pool {
  if (!g.__pool) g.__pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 3 });
  return g.__pool;
}
/** Runs fn in ONE transaction as the authenticated end user: RLS + role checks in SQL apply to every statement. */
export async function withActor<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    // One round trip instead of three. userId is a verified JWT subject, and is re-validated here so it can never carry SQL.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error('invalid actor');
    await c.query(`begin; select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated`);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally { c.release(); }
}