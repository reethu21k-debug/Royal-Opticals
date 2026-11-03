'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useList, Pager } from '@/components/useInventory';
import { PageHeader, Ico, Loading, EmptyState } from '@/components/ui';

export default function Report() {
  const { name } = useParams<{ name: string }>(); const [page, setPage] = useState(1); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const { data, err } = useList(`/api/reports/${name}`, { from, to, page, pageSize: 100 });
  const dl = `/api/reports/${name}?format=xlsx` + (from ? `&from=${from}` : '') + (to ? `&to=${to}` : '');
  return (<>
    <PageHeader crumbs={[{ label: 'Reports', href: '/reports' }, { label: data?.title ?? 'Report' }]} title={data?.title ?? 'Report'} sub={data?.note}
      actions={<a className="btn" href={dl}><Ico n="download" />Export to Excel</a>} />
    <div className="toolbar">
      <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 8 }}><span>From</span><input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 8 }}><span>To</span><input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      {(from || to) && <button className="link" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>Clear dates</button>}
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    {!data && !err && <Loading rows={8} />}
    {data && (data.rows.length === 0
      ? <EmptyState icon="file" title="No records">{from || to ? 'Nothing in this date range.' : 'This report has nothing to show right now.'}</EmptyState>
      : <><div className="wrap" tabIndex={0} role="region" aria-label="Report results"><table><thead><tr>{data.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>
        {data.rows.map((r: any, i: number) => <tr key={i}>{data.columns.map((c: string) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}</tr>)}</tbody></table></div>
        <Pager d={data} page={page} setPage={setPage} /></>)}
  </>);
}
