'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/components/api';
import { money, summarizeBills } from '@/lib/billing';
import { PageHeader, Badge, Loading, EmptyState, Ico, type Tone } from '@/components/ui';
import { downloadFile } from '../download';
import s from '../billing.module.css';

const STATUS: Record<string, [string, Tone]> = { draft: ['Draft', 'warn'], finalized: ['Finalized', 'ok'], void: ['Void', 'mute'] };
const LIST_LIMIT = 500;

export default function CustomerHistory() {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [custs, setCusts] = useState<any[] | null>(null);
  const [pick, setPick] = useState<any>(null);          // the chosen customer row
  const [bills, setBills] = useState<any[] | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let alive = true;
    api(`/api/bills/customers?${new URLSearchParams(dq ? { q: dq } : {})}`).then(r => alive && (setCusts(r.items), setErr(''))).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, [dq]);
  useEffect(() => {
    if (!pick) { setBills(null); return; }
    let alive = true; setBills(null);
    api(`/api/bills?${new URLSearchParams({ customer: pick.name })}`).then(r => alive && setBills(r.items)).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, [pick]);

  async function get(fmt: 'pdf' | 'xlsx') {
    setBusy(fmt); setErr('');
    try { await downloadFile(`/api/bills/customers/export?${new URLSearchParams({ name: pick.name, format: fmt })}`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  const sm = bills ? summarizeBills(bills) : null;

  return (<>
    <PageHeader title="Customer bill history" sub="Search a customer by name to see every bill made for them, then download the history."
      crumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Customer history' }]} />
    <div className="row" style={{ marginBottom: 10 }}>
      <input type="search" aria-label="Search customers" placeholder="Customer name…" value={q} onChange={e => setQ(e.target.value)} />
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    {!custs && !err && <Loading rows={4} />}
    {custs && custs.length === 0 && <EmptyState icon="search" title="No customers found">{dq ? 'No bill has a customer name matching this search.' : 'Customers appear here once a bill has a customer name.'}</EmptyState>}
    {custs && custs.length > 0 && <div className="wrap" tabIndex={0} role="region" aria-label="Customers"><table>
      <thead><tr><th>Customer</th><th className="n">Bills</th><th>Last bill</th><th className="n">Billed (excl. void)</th></tr></thead>
      <tbody>{custs.map(c => <tr key={c.name} className={s.clickRow} aria-selected={pick?.name === c.name} style={pick?.name === c.name ? { background: 'var(--acc-soft)' } : undefined} onClick={() => setPick(c)}>
        <td><button type="button" className={s.linkBtn} onClick={e => { e.stopPropagation(); setPick(c); }}>{c.name}</button></td>
        <td className="n"><b>{c.bill_count}</b></td><td className="mut">{fmtDate(c.last_bill_date)}</td><td className="n">{money(c.total_billed)}</td></tr>)}</tbody></table></div>}

    {pick && <section aria-label={`Bills for ${pick.name}`} style={{ marginTop: 22 }}>
      <h2 style={{ margin: '0 0 8px' }}>{pick.name}</h2>
      <div className={s.sumStrip} aria-live="polite">
        <span>Total bills<b>{pick.bill_count}</b></span><span>Finalized<b>{pick.finalized}</b></span><span>Drafts<b>{pick.draft}</b></span><span>Void<b>{pick.void}</b></span>
        <span>Billed (excl. void)<b>{money(pick.total_billed)}</b></span>{sm && <span title="Taken from the latest non-void bill; it already includes the old balance">Balance on latest bill<b>{money(sm.latestBalance)}</b></span>}
      </div>
      <div className={s.dlBar}>
        <span className={s.dlScope}>{bills && pick.bill_count > LIST_LIMIT ? `Showing the latest ${LIST_LIMIT} of ${pick.bill_count} bills (downloads include all)` : `${pick.bill_count} bill${pick.bill_count === 1 ? '' : 's'}`}</span>
        <div className={s.dlBtns}>
          <button type="button" disabled={!!busy} onClick={() => get('pdf')}><Ico n="download" />{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
          <button type="button" disabled={!!busy} onClick={() => get('xlsx')}><Ico n="download" />{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
        </div>
      </div>
      {!bills ? <Loading rows={3} /> : <div className="wrap" tabIndex={0} role="region" aria-label="Customer bills"><table>
        <thead><tr><th>Bill</th><th>Date</th><th>Status</th><th className="n">Total</th><th className="n">Balance</th></tr></thead>
        <tbody>{bills.map(b => { const [l, t] = STATUS[b.status] ?? [b.status, '' as Tone]; return <tr key={b.id}>
          <td><Link className="rowlink" href={`/billing/${b.id}`}>{b.bill_number}</Link></td><td className="mut">{fmtDate(b.bill_date)}</td><td><Badge tone={t}>{l}</Badge></td>
          <td className="n">{money(b.total_amount)}</td><td className="n">{money(b.balance_amount)}</td></tr>; })}</tbody></table></div>}
    </section>}
  </>);
}