'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/components/api';
import { PageHeader, StatusPill, Lens, Loading, Ico } from '@/components/ui';

export default function PO() {
  const { id } = useParams<{ id: string }>(); const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [rq, setRq] = useState<Record<string, string>>({}); const [grn, setGrn] = useState('');
  const load = useCallback(() => api(`/api/purchase-orders/${id}`).then(setD).catch(e => setErr(e.message)), [id]); useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<any>, ok: string) { setErr(''); setMsg(''); try { await fn(); setMsg(ok); setRq({}); await load(); } catch (e: any) { setErr(e.message); } }
  if (!d) return err ? <div className="err" role="alert">{err}</div> : <Loading rows={6} />;
  const po = d.purchaseOrder; const canReceive = ['confirmed', 'partially_received'].includes(po.status);
  const items = Object.entries(rq).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, quantity: Number(v) }));
  const tot = d.items.reduce((a: any, i: any) => ({ o: a.o + Number(i.quantity_ordered), r: a.r + Number(i.quantity_received), x: a.x + Number(i.outstanding) }), { o: 0, r: 0, x: 0 });
  const pct = tot.o ? Math.round((tot.r / tot.o) * 100) : 0;
  return (<>
    <PageHeader crumbs={[{ label: 'Purchase orders', href: '/purchase-orders' }, { label: po.po_number }]} title={`PO ${po.po_number}`} badge={<StatusPill kind="po" value={po.status} />}
      sub={<>Supplier: <b>{po.supplier_name}</b>{po.closed_reason && <> · closed: {po.closed_reason}</>}</>}
      actions={<>
        <button onClick={() => window.print()}><Ico n="print" />Print</button>
        <a className="btn" href={`/api/purchase-orders/${id}/pdf`}><Ico n="download" />Download PDF</a>
        {['draft', 'confirmed', 'partially_received'].includes(po.status) && <button className="danger" onClick={() => { const r = prompt('Reason for cancelling / closing short?'); if (r) run(() => api(`/api/purchase-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: r }) }), 'Order closed.'); }}>{po.status === 'partially_received' ? 'Close short' : 'Cancel order'}</button>}
        {po.status === 'draft' && <button className="p" onClick={() => run(() => api(`/api/purchase-orders/${id}/confirm`, { method: 'POST' }), 'Confirmed.')}>Confirm order</button>}
      </>} />
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="kpis"><div className="kpi"><b>{tot.o.toLocaleString()}</b><span>Ordered</span></div><div className="kpi"><b>{tot.r.toLocaleString()}</b><span>Received</span></div><div className="kpi"><b>{tot.x.toLocaleString()}</b><span>Outstanding</span></div></div>
      <div className={'bar' + (pct === 100 ? ' done' : '')} role="progressbar" aria-label="Received" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
    </div>
    <div className="wrap" tabIndex={0} role="region" aria-label="Order lines"><table><thead><tr><th>Lens</th><th className="n">Suggested</th><th className="n">Ordered</th><th className="n">Received</th><th className="n">Outstanding</th>{canReceive && <th className="n">Receive now</th>}</tr></thead><tbody>
      {d.items.map((i: any) => <tr key={i.id}><td><Lens row={i.row_label_source} col={i.col_label_source} /></td><td className="n mut">{i.suggested_quantity ?? '—'}</td><td className="n">{i.quantity_ordered}</td><td className="n">{i.quantity_received}</td><td className="n"><b>{i.outstanding}</b></td>
        {canReceive && <td className="n"><input aria-label="Receive quantity" inputMode="numeric" style={{ width: 80, textAlign: 'right' }} value={rq[i.id] ?? ''} placeholder="0" onChange={e => setRq({ ...rq, [i.id]: e.target.value.replace(/\D/g, '') })} /></td>}</tr>)}</tbody></table></div>
    {canReceive && <section className="card selbar" aria-label="Post receipt"><b>{items.length} line{items.length === 1 ? '' : 's'} · {items.reduce((s, i) => s + i.quantity, 0)} units</b>
      <input aria-label="Delivery / receipt number" placeholder="Receipt / delivery no. (required)" value={grn} onChange={e => setGrn(e.target.value)} />
      <button className="p" disabled={!items.length || !grn.trim()} onClick={() => run(() => api(`/api/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ receiptNumber: grn, idempotencyKey: crypto.randomUUID(), items }) }), 'Receipt posted; stock increased by the received quantities only.')}>Post receipt</button></section>}
    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
  </>);
}
