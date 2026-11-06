'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, fmtDate } from '@/components/api';
import { money } from '@/lib/billing';
import { PageHeader, Badge, Loading, EmptyState, Ico, type Tone } from '@/components/ui';
import { downloadFile } from './download';
import s from './billing.module.css';

const STATUS: Record<string, [string, Tone]> = { draft: ['Draft', 'warn'], finalized: ['Finalized', 'ok'], void: ['Void', 'mute'] };
const TABS: [string, string][] = [['', 'All'], ['draft', 'Drafts'], ['finalized', 'Finalized'], ['void', 'Void']];
const LIST_LIMIT = 500;

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (m: string): [string, string] => { const [y, mo] = m.split('-').map(Number); return [`${m}-01`, `${m}-${pad(new Date(y, mo, 0).getDate())}`]; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

export default function Bills() {
  const router = useRouter();
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [tab, setTab] = useState('');
  const [month, setMonth] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);

  const filters = { ...(dq ? { q: dq } : {}), ...(tab ? { status: tab } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let alive = true; setErr('');
    api(`/api/bills?${new URLSearchParams(filters)}`).then(r => { if (!alive) return; setItems(r.items); setSel(p => new Set(Array.from(p).filter(id => r.items.some((b: any) => b.id === id)))); }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  function pickMonth(m: string) { setMonth(m); if (m) { const [f, t] = monthBounds(m); setFrom(f); setTo(t); } else { setFrom(''); setTo(''); } }
  const toggle = (id: string) => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const count = items?.length ?? 0; const allSel = count > 0 && sel.size === count;
  const toggleAll = () => setSel(allSel ? new Set() : new Set((items ?? []).map(b => b.id)));

  // Some selected -> only those bills. Nothing (or everything) selected -> every bill matching the current filters.
  async function get(fmt: 'pdf' | 'xlsx', ids?: string[], key: string = fmt) {
    setBusy(key); setErr('');
    try { await downloadFile(`/api/bills/export?${ids ? `ids=${ids.join(',')}` : new URLSearchParams(filters)}&format=${fmt}`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  const bulk = (fmt: 'pdf' | 'xlsx') => get(fmt, sel.size > 0 && !allSel ? Array.from(sel) : undefined);
  const scope = sel.size > 0 && !allSel ? `${sel.size} selected` : `${count}${count >= LIST_LIMIT ? '+' : ''} bill${count === 1 ? '' : 's'} shown`;
  const badRange = !!from && !!to && from > to;

  return (<>
    <PageHeader title="Billing" sub="Customer bills. Finalizing a bill deducts inventory lenses from stock; external orders are billed but never deducted."
      actions={<><Link className="btn" href="/billing/customers">Customer history</Link><Link className="btn p" href="/billing/new"><Ico n="plus" />New bill</Link></>} />
    <div className="row" style={{ marginBottom: 10 }}>
      <input type="search" aria-label="Search bills" placeholder="Bill number or customer…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="pills" role="group" aria-label="Status">{TABS.map(([k, l]) => <button type="button" key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    </div>
    <div className={s.dateBar} role="group" aria-label="Filter by bill date">
      <label className={s.dfld}>Month<input type="month" value={month} onChange={e => pickMonth(e.target.value)} /></label>
      <label className={s.dfld}>From<input type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setMonth(''); }} /></label>
      <label className={s.dfld}>To<input type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setMonth(''); }} /></label>
      <div className={s.quick}>
        <button type="button" onClick={() => pickMonth(thisMonth())}>This month</button>
        <button type="button" onClick={() => pickMonth(lastMonth())}>Last month</button>
        {(from || to) && <button type="button" onClick={() => pickMonth('')}>All dates</button>}
      </div>
      {badRange && <span className={s.warnTxt}>“From” is after “To”, so no bills can match.</span>}
    </div>
    {err && <div className="err" role="alert">{err}</div>}
    {!items && !err && <Loading rows={5} />}
    {items && items.length > 0 && (() => {
      const live = items.filter(b => b.status !== 'void');
      return <div className={s.sumStrip} aria-live="polite">
        <span>Bills shown<b>{items.length}{items.length >= LIST_LIMIT ? '+' : ''}</b></span>
        <span>Drafts<b>{items.filter(b => b.status === 'draft').length}</b></span>
        <span>Billed (excl. void)<b>{money(live.reduce((t, b) => t + Number(b.total_amount || 0), 0))}</b></span>
        <span>Balance due (excl. void)<b>{money(live.reduce((t, b) => t + Number(b.balance_amount || 0), 0))}</b></span>
      </div>;
    })()}
    {items && items.length > 0 && <div className={s.dlBar}>
      <span className={s.dlScope} aria-live="polite">{scope}{sel.size > 0 && !allSel && <button type="button" className={s.linkBtn} onClick={() => setSel(new Set())}>Clear</button>}</span>
      <div className={s.dlBtns}>
        <button type="button" disabled={!!busy} onClick={() => bulk('pdf')}><Ico n="download" />{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
        <button type="button" disabled={!!busy} onClick={() => bulk('xlsx')}><Ico n="download" />{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
      </div>
    </div>}
    {items && (items.length === 0
      ? <EmptyState icon="file" title="No bills found" action={<Link className="btn p" href="/billing/new">Create a bill</Link>}>{from || to || dq || tab ? 'No bills match these filters.' : 'Bills you create will appear here.'}</EmptyState>
      : <div className="wrap" tabIndex={0} role="region" aria-label="Bills"><table>
        <thead><tr>
          <th className={s.chk}><input type="checkbox" aria-label="Select all bills shown" checked={allSel} onChange={toggleAll} /></th>
          <th>Bill</th><th>Customer</th><th>Date</th><th>Status</th><th className="n">Inventory lines</th><th className="n">External lines</th><th className="n">Total</th><th className="n">Balance</th><th>Download</th></tr></thead>
        <tbody>{items.map(b => { const [l, t] = STATUS[b.status] ?? [b.status, '' as Tone]; return (
          <tr key={b.id} className={s.clickRow} onClick={() => router.push(`/billing/${b.id}`)}>
            <td className={s.chk} onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select bill ${b.bill_number}`} checked={sel.has(b.id)} onChange={() => toggle(b.id)} /></td>
            <td><Link className="rowlink" href={`/billing/${b.id}`} onClick={e => e.stopPropagation()}>{b.bill_number}</Link></td><td>{b.customer_name || <span className="mut">—</span>}</td>
            <td className="mut">{fmtDate(b.bill_date)}</td><td><Badge tone={t}>{l}</Badge></td>
            <td className="n">{b.inventory_lines}</td><td className="n">{b.external_lines}</td>
            <td className="n">{money(b.total_amount)}</td><td className={'n' + (b.status !== 'void' && Number(b.balance_amount) > 0 ? ' ' + s.owed : '')}>{money(b.balance_amount)}</td>
            <td onClick={e => e.stopPropagation()}><span className={s.miniBtns}>
              <button type="button" className={s.miniBtn} disabled={!!busy} aria-label={`Download bill ${b.bill_number} as PDF`} onClick={() => get('pdf', [b.id], `${b.id}:pdf`)}>{busy === `${b.id}:pdf` ? '…' : 'PDF'}</button>
              <button type="button" className={s.miniBtn} disabled={!!busy} aria-label={`Download bill ${b.bill_number} as Excel`} onClick={() => get('xlsx', [b.id], `${b.id}:xlsx`)}>{busy === `${b.id}:xlsx` ? '…' : 'Excel'}</button>
            </span></td>
          </tr>); })}</tbody></table></div>)}
  </>);
}