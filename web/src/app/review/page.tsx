'use client';
import { useState } from 'react';
import { useList, Pager } from '@/components/useInventory';
import { api } from '@/components/api';
import { PageHeader, StatusPill, Loading, EmptyState, REVIEW_STATUSES } from '@/components/ui';

export default function Review() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState('open'); const [code, setCode] = useState(''); const [tick, setTick] = useState(0);
  const { data, err } = useList('/api/review', { status, code, page, pageSize: 25, t: tick });
  const [note, setNote] = useState<Record<string, string>>({}); const [e2, setE2] = useState('');
  const [bulkNote, setBulkNote] = useState(''); const [bulkMsg, setBulkMsg] = useState('');
  async function bulk(st: string) { setE2(''); setBulkMsg(''); try { if (!confirm(`Mark ALL open "${code}" items as ${st}?`)) return; const r = await api('/api/review/bulk', { method: 'POST', body: JSON.stringify({ code, status: st, note: bulkNote }) }); setBulkMsg(`${r.decided} items ${st}.`); setTick(tick + 1); } catch (e: any) { setE2(e.message); } }
  async function decide(id: string, s: string) { setE2(''); try { await api(`/api/review/${id}`, { method: 'PATCH', body: JSON.stringify({ status: s, note: note[id] || '' }) }); setTick(tick + 1); } catch (e: any) { setE2(e.message); } }
  return (<>
    <PageHeader title="Data review" sub="Every oddity found in the source files. A decision here changes nothing in stock. It records your explicit approval or rejection." />
    <div className="toolbar">
      <div className="pills" role="group" aria-label="Status">
        {REVIEW_STATUSES.map(([k, l]) => <button type="button" key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>)}
      </div>
      <input aria-label="Code filter" className="grow" placeholder="Filter by code, e.g. STOCK_SHEET_IDENTICAL_TO_TARGET" value={code} onChange={e => { setCode(e.target.value); setPage(1); }} style={{ maxWidth: 460 }} />
    </div>
    {status === 'open' && code && <section className="card bulk" aria-label="Decide all"><div style={{ flex: '1 1 100%' }}><b>Decide every open “{code}” item at once</b><span className="mut small" style={{ display: 'block' }}>Add a note. It is saved with each decision.</span></div>
      <input aria-label="Bulk decision note" className="grow" placeholder="Note (required)" value={bulkNote} onChange={e => setBulkNote(e.target.value)} />
      <button disabled={!bulkNote.trim()} onClick={() => bulk('approved')}>Approve all</button><button className="danger" disabled={!bulkNote.trim()} onClick={() => bulk('rejected')}>Reject all</button><button disabled={!bulkNote.trim()} onClick={() => bulk('needs_info')}>Needs info</button>{bulkMsg && <span className="okmsg">{bulkMsg}</span>}</section>}
    {(err || e2) && <div className="err" role="alert">{err || e2}</div>}
    {!data && !err && <Loading rows={6} />}
    {data && (data.items.length === 0
      ? <EmptyState icon="check" title={status === 'open' ? 'Nothing left to review' : 'No items here'}>{status === 'open' ? 'Every finding has a decision.' : 'Try another status or clear the code filter.'}</EmptyState>
      : <><div className="wrap" tabIndex={0} role="region" aria-label="Review items"><table><thead><tr><th>Priority</th><th>Finding</th><th>{status === 'open' ? 'Your decision' : 'Decision note'}</th></tr></thead><tbody>
        {data.items.map((r: any) => <tr key={r.id} style={{ verticalAlign: 'top' }}>
          <td><StatusPill kind="severity" value={r.severity} /></td>
          <td className="wrapcell" style={{ minWidth: 260, maxWidth: 520 }}><code style={{ fontSize: 12.5 }}>{r.code}</code><span style={{ display: 'block', margin: '2px 0' }}>{r.detail}</span>
            <span className="sub" title={r.source_file}>{(r.source_file || '').split('/').pop()} · {r.source_sheet} {r.source_cell}</span></td>
          <td className="wrapcell">{status === 'open'
            ? <div style={{ display: 'grid', gap: 8, minWidth: 250 }}><input aria-label="Decision note" placeholder="Note (required)" value={note[r.id] || ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} />
              <span className="row" style={{ margin: 0, gap: 6 }}><button className="sm" onClick={() => decide(r.id, 'approved')}>Approve</button><button className="sm danger" onClick={() => decide(r.id, 'rejected')}>Reject</button><button className="sm" onClick={() => decide(r.id, 'needs_info')}>Needs info</button></span></div>
            : r.decision_note}</td></tr>)}</tbody></table></div>
        <Pager d={data} page={page} setPage={setPage} /></>)}
  </>);
}
