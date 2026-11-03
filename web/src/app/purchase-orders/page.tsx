'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/components/api';
import { PageHeader, StatusPill, Loading, EmptyState, Ico } from '@/components/ui';

export default function POs() {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/api/purchase-orders').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);
  return (<>
    <PageHeader title="Purchase orders" sub="A draft or confirmed order never changes stock. Only a posted receipt does."
      actions={<Link className="btn p" href="/suggested-orders"><Ico n="plus" />New order from suggestions</Link>} />
    {err && <div className="err" role="alert">{err}</div>}
    {!items && !err && <Loading rows={5} />}
    {items && (items.length === 0
      ? <EmptyState icon="file" title="No purchase orders yet" action={<Link className="btn p" href="/suggested-orders">See suggested orders</Link>}>Orders are created from the lenses that have fallen below target.</EmptyState>
      : <div className="wrap" tabIndex={0} role="region" aria-label="Purchase orders"><table>
        <thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th>Date</th><th className="n">Ordered</th><th className="n">Received</th></tr></thead>
        <tbody>{items.map(p => {
          const pct = p.ordered > 0 ? Math.min(100, Math.round((p.received / p.ordered) * 100)) : 0;
          return (<tr key={p.id}>
            <td><Link className="rowlink" href={`/purchase-orders/${p.id}`}>{p.po_number}</Link></td><td>{p.supplier_name}</td>
            <td><StatusPill kind="po" value={p.status} /></td><td className="mut">{fmtDate(p.order_date)}</td>
            <td className="n">{p.ordered}</td>
            <td className="n"><span className="stockcell"><span className="nums"><b>{p.received}</b><span className="of"> / {p.ordered}</span></span><span className={'meter' + (pct < 100 ? ' info' : '')} role="img" aria-label={`${pct}% received`}><i style={{ width: pct + '%' }} /></span></span></td>
          </tr>); })}</tbody></table></div>)}
  </>);
}
