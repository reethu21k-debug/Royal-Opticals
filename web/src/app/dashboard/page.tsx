'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, num, STATUS, signed, ago, fmtDateTime } from '@/components/api';
import { PageHeader, Ico, Lens, Loading, Note, StatusPill } from '@/components/ui';

const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: unknown) => n(v).toLocaleString();

export default function Dashboard() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [at, setAt] = useState<Date | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setBusy(true); api('/api/dashboard').then(x => { setD(x); setErr(''); setAt(new Date()); }).catch(e => setErr(e.message)).finally(() => setBusy(false)); }, []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <div className="err" role="alert">{err}</div>;
  if (!d) return <><PageHeader title="Dashboard" sub="Where stock stands right now." /><Loading rows={6} label="Loading dashboard" /></>;

  const i = d.inventory, p = d.purchasing, rv = d.review;
  const total = n(i.variants);
  const pct = (v: number) => { if (!total || !v) return '0%'; const x = (v / total) * 100; return x < 1 ? '<1%' : Math.round(x) + '%'; };
  // Stock-health bar: each flagged group is a link into the inventory list, pre-filtered.
  const flagged = [
    { key: 'out_of_stock', v: n(i.out_of_stock), tone: 'bad', hint: 'Recorded stock is 0' },
    { key: 'below_target', v: n(i.below_target), tone: 'warn', hint: 'Recorded stock is under the target' },
    { key: 'stock_unknown', v: n(i.stock_unknown), tone: 'mute', hint: 'Blank in the source files. Never treated as zero' },
    { key: 'unverified', v: n(i.unverified), tone: 'info', hint: 'Needs a physical count before it can be trusted' },
  ];
  const rest = Math.max(0, total - flagged.reduce((s, f) => s + f.v, 0));
  const bar = [...flagged.filter(f => f.v > 0).map(f => ({ ...f, flex: f.v })), ...(rest > 0 ? [{ key: 'ok', v: rest, tone: 'ok', hint: 'Not flagged', flex: rest }] : [])];
  const recorded = total ? Math.round(((total - n(i.stock_unknown)) / total) * 100) : 0;
  const imports: any[] = d.pendingImports ?? [];

  // What to do next, most urgent first. Only things that actually need doing are shown.
  const todo = [
    { k: 'high', v: n(rv.open_high), tone: 'bad', label: 'High-priority data reviews', sub: 'Open these first', href: '/review' },
    { k: 'oos', v: n(i.out_of_stock), tone: 'bad', label: 'Lenses out of stock', sub: 'Recorded stock is 0', href: '/inventory?status=out_of_stock' },
    { k: 'reorder', v: n(i.suggested_lines), tone: 'warn', label: 'Lenses to reorder', sub: `${fmt(i.suggested_units)} units suggested`, href: '/suggested-orders' },
    { k: 'partial', v: n(p.partial_pos), tone: 'info', label: 'Orders partly received', sub: 'Waiting for the rest', href: '/purchase-orders' },
    { k: 'open', v: n(p.open_pos), tone: 'info', label: 'Orders awaiting delivery', sub: 'Confirmed with a supplier', href: '/purchase-orders' },
    { k: 'count', v: n(i.stock_unknown), tone: 'mute', label: 'Lenses with no recorded stock', sub: 'A count will fix this', href: '/counts' },
  ].filter(t => t.v > 0);

  return (<>
    <PageHeader title="Dashboard" sub="Where stock stands right now, and what needs doing next."
      actions={<>
        <button type="button" className="btn-refresh" onClick={load} disabled={busy} title={at ? `Updated ${at.toLocaleTimeString()}` : ''}>{busy ? 'Refreshing…' : at ? `Updated ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}</button>
        <Link className="btn" href="/inventory"><Ico n="search" />Find a lens</Link><Link className="btn" href="/counts"><Ico n="clipboard" />Start a count</Link><Link className="btn p" href="/stock"><Ico n="plus" />Receive stock</Link></>} />

    {err && <div className="err" role="alert">Could not refresh: {err}</div>}

    {imports.length > 0 && (
      <Note tone="warn" icon="info">
        <b>Imports waiting for approval:</b>{' '}
        {imports.map((b: any) => <Link key={b.id} href={`/imports/${b.id}`} style={{ marginRight: 12 }}>{b.filename}</Link>)}
      </Note>
    )}

    {/* ───── do next: prioritised, only what needs attention ───── */}
    <section aria-label="What to do next" className="todo-wrap">
      {todo.length === 0
        ? <Note tone="ok" icon="check">Nothing needs doing right now. Stock is at or above target everywhere it is recorded.</Note>
        : <ul className="todo">
          {todo.map(t => (
            <li key={t.k}>
              <Link href={t.href} className={'todo-tile t-' + t.tone}>
                <b>{fmt(t.v)}</b>
                <span className="todo-text"><span className="todo-l">{t.label}</span><small>{t.sub}</small></span>
                <Ico n="chevron" className="go" />
              </Link>
            </li>
          ))}
        </ul>}
    </section>

    {/* ───── hero: the whole catalogue at a glance ───── */}
    <section className="card hero" aria-label="Stock health">
      <div className="hero-top">
        <div className="stat"><b>{fmt(i.variants)}</b><span>lens positions tracked</span></div>
        <div className="stat" style={{ textAlign: 'right' }}><b style={{ fontSize: 26 }}>{fmt(i.units_available)}</b><span>units recorded as available</span></div>
      </div>
      <div className="dist" role="group" aria-label={'Stock health: ' + bar.map(b => `${b.v.toLocaleString()} ${b.key === 'ok' ? 'not flagged' : STATUS[b.key][0].toLowerCase()}`).join(', ')}>
        {bar.map(b => <Link key={b.key} href={`/inventory?status=${b.key}`} className={'s-' + b.tone} style={{ flex: `${b.flex} 1 0` }} title={`${b.v.toLocaleString()} · ${STATUS[b.key]?.[0] ?? 'Not flagged'}`} aria-label={`${STATUS[b.key]?.[0] ?? 'Not flagged'}: ${b.v.toLocaleString()}`} />)}
      </div>
      <div className="legend">
        {flagged.map(f => (
          <Link key={f.key} href={`/inventory?status=${f.key}`} className="leg" title={f.hint}>
            <span className={'dot b-' + f.tone} aria-hidden="true" />
            <span><b>{fmt(f.v)}</b><span className="l">{STATUS[f.key][0]} · {pct(f.v)}</span></span>
          </Link>
        ))}
        {rest > 0 && <Link href="/inventory?status=ok" className="leg" title="Positions that are not in any of the groups on the left"><span className="dot b-ok" aria-hidden="true" /><span><b>{fmt(rest)}</b><span className="l">Not flagged · {pct(rest)}</span></span></Link>}
      </div>
    </section>

    {/* ───── ordering + data quality ───── */}
    <div className="dash-cols">
      <section className="card" aria-label="Ordering">
        <h2 className="card-title">Ordering</h2>
        <p className="card-sub">What to buy, and what is already on its way.</p>
        <div className="mini">
          <Link href="/suggested-orders"><span className="l">Lenses to reorder</span><span className="v">{fmt(i.suggested_lines)}</span></Link>
          <Link href="/suggested-orders"><span className="l">Units suggested</span><span className="v">{fmt(i.suggested_units)}</span></Link>
          <Link href="/purchase-orders"><span className="l">Open purchase orders</span><span className="v">{fmt(p.open_pos)}</span></Link>
          <Link href="/purchase-orders"><span className="l">Partly received</span><span className="v">{fmt(p.partial_pos)}</span></Link>
        </div>
        <Link className="btn p" href="/suggested-orders" style={{ marginTop: 12 }}>Review suggested orders</Link>
      </section>
      <section className="card" aria-label="Data quality">
        <h2 className="card-title">Data quality</h2>
        <p className="card-sub">Gaps that make stock numbers harder to trust.</p>
        <div className="cover" role="group" aria-label={`${recorded}% of lens positions have recorded stock`}>
          <div className="cover-top"><span>Positions with recorded stock</span><b>{recorded}%</b></div>
          <div className={'bar' + (recorded >= 95 ? ' done' : '')}><i style={{ width: recorded + '%' }} /></div>
        </div>
        <div className="mini">
          <Link href="/counts"><span className="l">Lenses with no recorded stock</span><span className="v">{fmt(i.stock_unknown)}</span></Link>
          <Link href="/inventory"><span className="l">Lenses with no target</span><span className="v">{fmt(i.no_target)}</span></Link>
          <Link href="/review"><span className="l">Data-review items open</span><span className="v">{fmt(rv.open_reviews)}</span></Link>
          <Link href="/review"><span className="l">…of which high priority</span><span className="v" style={{ color: n(rv.open_high) > 0 ? 'var(--bad)' : undefined }}>{fmt(rv.open_high)}</span></Link>
        </div>
        <Link className="btn" href="/review" style={{ marginTop: 12 }}>Open data review</Link>
      </section>
    </div>

    {/* ───── needs attention ───── */}
    <div className="section-title"><h2>Needs attention</h2><span className="mut small">Largest suggested orders first</span></div>
    <div className="wrap" tabIndex={0} role="region" aria-label="Largest suggested orders" style={{ maxHeight: 420 }}>
      <table><thead><tr><th>Lens</th><th className="n">Stock vs target</th><th className="n">Order</th><th className="hide-sm" style={{ width: 90 }}><span className="sr">Action</span></th></tr></thead><tbody>
        {d.attention.map((r: any) => {
          const [stText, stCls] = STATUS[r.stock_status] ?? ['', ''];
          const pctFill = r.target_quantity > 0 ? Math.max(0, Math.min(100, Math.round((n(r.available_quantity) / n(r.target_quantity)) * 100))) : 0;
          const tone = r.stock_status === 'out_of_stock' ? 'bad' : r.stock_status === 'below_target' ? 'warn' : '';
          return (
            <tr key={r.variant_id}>
              <td><Link className="lens-link" href={`/inventory/${r.variant_id}`}><Lens row={r.row_label_source} col={r.col_label_source} /></Link><span className="sub where" title={r.workbook}>{r.workbook}</span></td>
              <td className="n">
                <span className="stockcell">
                  <span className="nums"><b>{num(r.available_quantity)}</b><span className="of"> / {num(r.target_quantity)}</span></span>
                  <span className={'meter ' + tone} aria-hidden="true"><i style={{ width: pctFill + '%' }} /></span>
                </span>
                {stText && <span className={'sub ' + stCls} style={{ textAlign: 'right' }}>{stText}</span>}
              </td>
              <td className="n"><b className="sug-n">{r.suggested_order}</b></td>
              <td className="n hide-sm"><Link className="btn sm" href={`/stock?variantId=${r.variant_id}`}>Receive</Link></td>
            </tr>);
        })}
        {d.attention.length === 0 && <tr><td colSpan={4} className="mut">Nothing below target with recorded stock and target.</td></tr>}
      </tbody></table>
    </div>
    {n(i.suggested_lines) > d.attention.length && <p className="tbl-foot" style={{ margin: '10px 2px 0' }}><span>Showing the top {d.attention.length} of {fmt(i.suggested_lines)} lenses to reorder.</span><Link href="/suggested-orders">See all suggested orders</Link></p>}

    {/* ───── recent activity ───── */}
    <div className="section-title"><h2>Recent activity</h2><Link href="/movements" className="small">All stock movements</Link></div>
    <div className="wrap" tabIndex={0} role="region" aria-label="Recent activity" style={{ maxHeight: 420 }}>
      <table><thead><tr><th>Lens</th><th>What happened</th><th className="n">Change</th><th className="hide-sm">By</th><th>When</th></tr></thead><tbody>
        {d.recent.map((m: any, k: number) => {
          const dl = n(m.quantity_delta);
          return (<tr key={k}>
            <td><Link className="lens-link" href={`/inventory/${m.variant_id}`}><Lens row={m.row_label_source} col={m.col_label_source} /></Link></td>
            <td><StatusPill kind="movement" value={m.movement_type} />{m.reason && <span className="sub">{m.reason}</span>}</td>
            <td className={'n ' + (dl > 0 ? 'pos' : dl < 0 ? 'neg' : '')}>{signed(m.quantity_delta)}</td>
            <td className="hide-sm">{m.actor ?? <span className="mut">Import / system</span>}</td>
            <td className="mut" title={fmtDateTime(m.created_at)}>{ago(m.created_at)}</td>
          </tr>);
        })}
        {d.recent.length === 0 && <tr><td colSpan={5} className="mut">No stock movements yet.</td></tr>}
      </tbody></table>
    </div>
    <p className="mut small" style={{ marginTop: 14 }}>“Out of stock” counts only positions with a recorded stock of 0. Positions whose stock is blank in the source files are shown as “Stock not recorded” and are never treated as zero.</p>
  </>);
}