'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate } from '@/components/api';
import { money, normName, summarizeBills } from '@/lib/billing';
import { PageHeader, Badge, Loading, EmptyState, Ico, type Tone } from '@/components/ui';
import { downloadFile } from '../download';
import s from '../billing.module.css';

const STATUS: Record<string, [string, Tone]> = { draft: ['Draft', 'warn'], finalized: ['Finalized', 'ok'], void: ['Void', 'mute'] };
const LIST_LIMIT = 500;

// Rename every bill of this customer. Re-mounted (key) whenever another customer is chosen.
function RenameBox({ pick, custs, onDone }: { pick: any; custs: any[]; onDone: (to: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [to, setTo] = useState(pick.name); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!open) return <button type="button" onClick={() => { setTo(pick.name); setOpen(true); }}>Rename customer</button>;
  const name = to.trim(); const clash = !!name && custs.some(c => c.name !== pick.name && normName(c.name) === normName(name));
  async function save() {
    if (!name) { setErr('Enter a name.'); return; }
    if (name === pick.name) { setOpen(false); return; }
    if (!confirm(`Rename “${pick.name}” to “${name}” on all ${pick.bill_count} bill${pick.bill_count === 1 ? '' : 's'}?${clash ? '\n\nA customer with this name already exists, so their bills will be merged under one name.' : ''}`)) return;
    setBusy(true); setErr('');
    try { await api('/api/bills/customers/rename', { method: 'POST', body: JSON.stringify({ from: pick.name, to: name }) }); await onDone(name); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <input aria-label="New customer name" value={to} maxLength={200} autoFocus onChange={e => { setTo(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }} />
    <button type="button" className="p" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    {clash && <span className={s.warnTxt}>This name already exists, so these bills will be merged with that customer.</span>}
    {err && <span className={s.warnTxt} role="alert">{err}</span>}
  </span>;
}

// Customer list → one customer's bills is a level of its own: it gets a browser-history entry, so Back returns to the list, and coming back
// from a bill shows the same customer again.
const PK = 'roCustomer';
const pickInHistory = () => { try { return window.history.state?.[PK] ?? null; } catch { return null; } };

export default function CustomerHistory() {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [custs, setCusts] = useState<any[] | null>(null);
  const [pick, setPick] = useState<any>(null);          // the chosen customer row
  function choose(row: any) {   // list → customer = new history entry; customer → another customer = same level, so the entry is replaced
    setPick(row);
    try { const st = { ...(window.history.state ?? {}), [PK]: row }; if (pickInHistory()) window.history.replaceState(st, ''); else window.history.pushState(st, ''); } catch { /* not tracked */ }
  }
  function backToList() { if (pickInHistory()) window.history.back(); else setPick(null); }
  useEffect(() => {
    const saved = pickInHistory(); if (saved) setPick(saved);   // returned from a bill: open the same customer again
    const onPop = (e: PopStateEvent) => { if (e.state) setPick(e.state[PK] ?? null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
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
    <PageHeader back="/billing" title="Customer bill history" sub="Search a customer by name to see every bill made for them, then download the history."
      crumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Customer history' }]} />
    <div className="row" style={{ marginBottom: 10 }}>
      <input type="search" aria-label="Search customers" placeholder="Customer name…" value={q} onChange={e => setQ(e.target.value)} />
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    {!custs && !err && <Loading rows={4} />}
    {custs && custs.length === 0 && <EmptyState icon="search" title="No customers found">{dq ? 'No bill has a customer name matching this search.' : 'Customers appear here once a bill has a customer name.'}</EmptyState>}
    {custs && custs.length > 0 && <div className="wrap" tabIndex={0} role="region" aria-label="Customers"><table>
      <thead><tr><th>Customer</th><th className="n">Bills</th><th>Last bill</th><th className="n">Billed (excl. void)</th></tr></thead>
      <tbody>{custs.map(c => <tr key={c.name} className={s.clickRow} aria-selected={pick?.name === c.name} style={pick?.name === c.name ? { background: 'var(--acc-soft)' } : undefined} onClick={() => choose(c)}>
        <td><button type="button" className={s.linkBtn} onClick={e => { e.stopPropagation(); choose(c); }}>{c.name}</button></td>
        <td className="n"><b>{c.bill_count}</b></td><td className="mut">{fmtDate(c.last_bill_date)}</td><td className="n">{money(c.total_billed)}</td></tr>)}</tbody></table></div>}

    {pick && <section aria-label={`Bills for ${pick.name}`} style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 8px' }}>
        <button type="button" className="sm" onClick={backToList}>← Back</button>
        <h2 style={{ margin: 0 }}>{pick.name}</h2>
        <RenameBox key={pick.name} pick={pick} custs={custs ?? []} onDone={async to => {
          const r = await api(`/api/bills/customers?${new URLSearchParams({ q: to })}`);
          const row = r.items.find((c: any) => normName(c.name) === normName(to)); if (row) choose(row); else setPick(null); setQ(to); setDq(to);
        }} />
      </div>
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