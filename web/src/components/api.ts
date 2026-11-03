'use client';
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> { return (refreshing ??= fetch('/api/session', { method: 'PUT' }).then(r => r.ok).catch(() => false).finally(() => { refreshing = null; })); }
export async function api<T = any>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  if (r.status === 401 && !retried && typeof window !== 'undefined' && await refreshSession()) return api<T>(path, init, true);   // expired access token: refresh once and retry
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && typeof window !== 'undefined') window.location.href = '/login?e=1&next=' + encodeURIComponent(window.location.pathname);   // e=1: the server rejected the session — login must NOT auto-redirect back (prevents a redirect loop)
  if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
  return j as T;
}
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
// One status language for the whole app: label + badge tone. "Not recorded" and "Unverified" are deliberately NOT amber
// (amber means "below target"), so unknown data is never confused with a real shortage.
export const STATUS: Record<string, [string, string]> = {
  stock_unknown: ['Stock not recorded', 'b-mute'], unverified: ['Unverified stock', 'b-info'], out_of_stock: ['Out of stock', 'b-bad'], below_target: ['Below target', 'b-warn'], ok: ['OK', 'b-ok'] };
export const STATUS_ORDER = ['out_of_stock', 'below_target', 'stock_unknown', 'unverified', 'ok'] as const;
export const signed = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? (n > 0 ? '+' : '') + n : String(x ?? '—'); };
export const fmtDate = (v: string | Date | null | undefined) => v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDateTime = (v: string | Date | null | undefined) => v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
// "2 hours ago" style, falling back to the date after a week
export function ago(v: string | Date | null | undefined) {
  if (!v) return ''; const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`; return fmtDate(v);
}
