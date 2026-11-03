'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
export function useList(base: string, params: Record<string, string | number | null | undefined>) {
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number; [k: string]: any } | null>(null); const [err, setErr] = useState(''); const [loading, setL] = useState(false);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
  useEffect(() => { let alive = true; setL(true); setErr('');
    api(`${base}?${qs}`).then(d => alive && setData(d)).catch(e => alive && setErr(e.message)).finally(() => alive && setL(false));
    return () => { alive = false; }; }, [base, qs]);
  return { data, err, loading, qs };
}
export function Pager({ d, page, setPage }: { d: { total: number; pageSize: number } | null; page: number; setPage: (n: number) => void }) {
  if (!d) return null; const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  if (d.total <= d.pageSize && page === 1) return <div className="pager"><span>{d.total.toLocaleString()} {d.total === 1 ? 'record' : 'records'}</span></div>;
  const from = (page - 1) * d.pageSize + 1, to = Math.min(d.total, page * d.pageSize);
  return (<div className="pager"><span title={`Showing ${from.toLocaleString()}–${to.toLocaleString()}`}>Page {page} of {pages.toLocaleString()} · {d.total.toLocaleString()} records</span>
    <div className="btns"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button></div></div>);
}
