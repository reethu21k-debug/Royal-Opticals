'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useList, Pager } from '@/components/useInventory';
import { num, signed, fmtDateTime } from '@/components/api';
import { PageHeader, Lens, StatusPill, Loading, EmptyState, MOVEMENT_TYPES } from '@/components/ui';

export default function Movements() {
  const [page, setPage] = useState(1); const [type, setType] = useState('');
  const { data, err } = useList('/api/stock/movements', { type, page, pageSize: 50 });
  return (<>
    <PageHeader title="Stock movements" sub="Every receipt, issue and adjustment, newest first. Entries are never edited, only reversed." />
    <div className="pills" role="group" aria-label="Movement type" style={{ marginBottom: 14 }}>
      <button type="button" aria-pressed={type === ''} onClick={() => { setType(''); setPage(1); }}>All</button>
      {MOVEMENT_TYPES.map(([k, l]) => <button type="button" key={k} aria-pressed={type === k} onClick={() => { setType(type === k ? '' : k); setPage(1); }}>{l}</button>)}
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    {!data && !err && <Loading rows={8} />}
    {data && (data.items.length === 0
      ? <EmptyState icon="box" title="No movements to show">{type ? 'Try a different type.' : 'Movements appear here as soon as stock is received, issued or adjusted.'}</EmptyState>
      : <><div className="wrap" tabIndex={0} role="region" aria-label="Stock movements"><table>
        <thead><tr><th>When</th><th>Lens</th><th>What happened</th><th className="n">Change</th><th className="n">Before → after</th><th>Reason</th></tr></thead>
        <tbody>{data.items.map((m: any) => { const dl = Number(m.quantity_delta); return (
          <tr key={m.id}>
            <td className="mut" title={fmtDateTime(m.created_at)}>{fmtDateTime(m.created_at)}</td>
            <td>{m.variant_id ? <Link className="lens-link" href={`/inventory/${m.variant_id}`}><Lens row={m.row_label_source} col={m.col_label_source} /></Link> : <Lens row={m.row_label_source} col={m.col_label_source} />}</td>
            <td><StatusPill kind="movement" value={m.movement_type} /></td>
            <td className={'n ' + (dl > 0 ? 'pos' : dl < 0 ? 'neg' : '')}>{signed(m.quantity_delta)}</td>
            <td className="n mut">{num(m.quantity_before)} → <b style={{ color: 'var(--fg)' }}>{num(m.quantity_after)}</b></td>
            <td className="wrapcell">{m.reason}{m.actor && <span className="sub">by {m.actor}</span>}</td>
          </tr>); })}</tbody></table></div>
        <Pager d={data} page={page} setPage={setPage} /></>)}
  </>);
}
