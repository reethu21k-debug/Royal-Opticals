'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Tree from '@/components/Tree';
import { useList, Pager } from '@/components/useInventory';
import { api, num, STATUS } from '@/components/api';
import { PageHeader, Lens, Loading, EmptyState, Note, Ico } from '@/components/ui';
import { fmtPower } from '@/lib/power-format';

type Sel = { qty: string; sug: number; sup: string | null };
type GroupBy = 'workbook' | 'supplier';

const POWERS: { label: string; min: string; max: string }[] = [
  { label: 'SPH', min: 'sphMin', max: 'sphMax' },
  { label: 'CYL', min: 'cylMin', max: 'cylMax' },
  { label: 'ADD', min: 'addMin', max: 'addMax' },
];
// Only these two can ever have a suggested order (suggestions need a known stock below a known target).
const URGENCY = ['out_of_stock', 'below_target'] as const;
const PAGE_SIZE = 100;

function fill(r: any): { pct: number; tone: string } | null {
  if (r.available_quantity === null || r.available_quantity === undefined || !(r.target_quantity > 0)) return null;
  const tone = r.stock_status === 'out_of_stock' ? 'bad' : r.stock_status === 'below_target' ? 'warn' : '';
  return { pct: Math.max(0, Math.min(100, Math.round((r.available_quantity / r.target_quantity) * 100))), tone };
}

function GroupCheck({ state, label, onChange }: { state: 'none' | 'some' | 'all'; label: string; onChange: (on: boolean) => void }) {
  return <input type="checkbox" aria-label={label} checked={state === 'all'} ref={el => { if (el) el.indeterminate = state === 'some'; }} onChange={e => onChange(e.target.checked)} />;
}

export default function Suggested() {
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [net, setNet] = useState(false);
  const [status, setStatus] = useState(''); const [node, setNode] = useState<string | null>(null); const [nodeName, setNodeName] = useState('');
  const [r, setR] = useState<Record<string, string>>({}); const [groupBy, setGroupBy] = useState<GroupBy>('workbook');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const { data, err, loading } = useList('/api/replenishment', { q: dq, page, pageSize: PAGE_SIZE, net: net ? 1 : 0, status, nodeId: node, ...r });
  const [sel, setSel] = useState<Record<string, Sel>>({}); const [sup, setSup] = useState<any[]>([]); const [sid, setSid] = useState(''); const [po, setPo] = useState(''); const [e2, setE2] = useState('');

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { api('/api/suppliers').then(res => setSup(res.items.filter((s: any) => s.is_active))).catch(() => undefined); }, []);

  const chosen = Object.entries(sel).filter(([, v]) => Number(v.qty) > 0);
  const units = chosen.reduce((s, [, v]) => s + Number(v.qty), 0);
  async function create() { setE2(''); try { const res = await api('/api/purchase-orders', { method: 'POST', body: JSON.stringify({ supplierId: sid, poNumber: po, items: chosen.map(([variantId, v]) => ({ variantId, quantity: Number(v.qty), suggestedQuantity: v.sug })) }) }); window.location.href = `/purchase-orders/${res.purchaseOrder.id}`; } catch (e: any) { setE2(e.message); } }
  const rows: any[] = data?.items ?? [];
  const entry = (x: any): Sel => ({ qty: String(x.suggested_order), sug: x.suggested_order, sup: x.preferred_supplier_id ?? null });
  function toggleRow(x: any, on: boolean) { if (on && !sid && x.preferred_supplier_id) setSid(x.preferred_supplier_id); setSel(on ? { ...sel, [x.variant_id]: entry(x) } : Object.fromEntries(Object.entries(sel).filter(([k]) => k !== x.variant_id))); }
  function toggleMany(items: any[], on: boolean) { const next = { ...sel }; items.forEach(x => { if (on) next[x.variant_id] = next[x.variant_id] ?? entry(x); else delete next[x.variant_id]; }); if (on && !sid) { const p = items.find(x => x.preferred_supplier_id); if (p) setSid(p.preferred_supplier_id); } setSel(next); }
  const stateOf = (items: any[]): 'none' | 'some' | 'all' => { const k = items.filter(x => sel[x.variant_id]).length; return k === 0 ? 'none' : k === items.length ? 'all' : 'some'; };

  /* ───── filters ───── */
  const powerCount = POWERS.filter(p => r[p.min] || r[p.max]).length;
  const filterCount = (node ? 1 : 0) + powerCount;
  const hasFilters = !!(dq || status || node || powerCount);
  function setPower(k: string, v: string) { setR({ ...r, [k]: v }); setPage(1); }
  function clearAll() { setQ(''); setDq(''); setStatus(''); setNode(null); setNodeName(''); setR({}); setPage(1); }
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (node) chips.push({ key: 'node', label: nodeName || 'Selected group', clear: () => { setNode(null); setNodeName(''); setPage(1); } });
  if (dq) chips.push({ key: 'q', label: `“${dq}”`, clear: () => { setQ(''); setDq(''); setPage(1); } });
  if (status) chips.push({ key: 'status', label: STATUS[status]?.[0] ?? status, clear: () => { setStatus(''); setPage(1); } });
  POWERS.forEach(p => { const lo = r[p.min], hi = r[p.max]; if (lo || hi) chips.push({ key: p.label, label: `${p.label} ${lo || '…'} to ${hi || '…'}`, clear: () => { setR({ ...r, [p.min]: '', [p.max]: '' }); setPage(1); } }); });

  /* ───── grouping (this page of results) ───── */
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; sub: string; none?: boolean; items: any[] }>();
    for (const x of rows) {
      const key = groupBy === 'supplier' ? (x.preferred_supplier_id ?? 'none') : `${x.workbook}\u0001${x.block}`;
      if (!m.has(key)) m.set(key, groupBy === 'supplier'
        ? { key, title: x.preferred_supplier ?? 'No preferred supplier', sub: '', none: !x.preferred_supplier_id, items: [] }
        : { key, title: x.workbook, sub: x.block ?? '', items: [] });
      m.get(key)!.items.push(x);
    }
    const all = Array.from(m.values());
    return groupBy === 'supplier' ? all.sort((a, b) => Number(!!a.none) - Number(!!b.none) || a.title.localeCompare(b.title)) : all;
  }, [rows, groupBy]);
  const allClosed = groups.length > 0 && groups.every(g => closed[g.key]);
  const sugOf = (x: any) => Number(data?.usingNet ? x.net_suggested_order : x.suggested_order) || 0;
  const pageUnits = rows.reduce((s, x) => s + sugOf(x), 0);
  const otherSup = chosen.filter(([, v]) => sid && v.sup && v.sup !== sid).length;
  const noSup = chosen.filter(([, v]) => !v.sup).length;
  const cols = 5 + (data?.usingNet ? 1 : 0) + (groupBy === 'workbook' ? 1 : 0);
  // Report downloads cover EVERY suggested order matching the current filters (not just this page).
  const reportQs = new URLSearchParams();
  if (dq) reportQs.set('q', dq); if (status) reportQs.set('status', status); if (node) reportQs.set('nodeId', node); if (net) reportQs.set('net', '1');
  Object.entries(r).forEach(([k, v]) => { if (v) reportQs.set(k, v); });
  const reportHref = (fmt: 'pdf' | 'xlsx') => `/api/suggested-orders/export?${reportQs.toString()}${reportQs.toString() ? '&' : ''}format=${fmt}`;

  return (<>
    <PageHeader title="Suggested orders" sub="Lenses below their target, with the quantity needed to get back to it. Tick the ones to order, adjust quantities, then create a draft purchase order."
      actions={data && data.total > 0 ? <>
        <a className="btn" href={reportHref('pdf')}><Ico n="download" />Report (PDF)</a>
        <a className="btn" href={reportHref('xlsx')}><Ico n="download" />Report (Excel)</a>
      </> : undefined} />

    {data && (
      <div className="kpis sug-kpis">
        <div className="kpi"><b>{data.total.toLocaleString()}</b><span>{data.total === 1 ? 'lens' : 'lenses'} to order{hasFilters ? ' (filtered)' : ''}</span></div>
        <div className="kpi"><b>{pageUnits.toLocaleString()}</b><span>units suggested on this page</span></div>
        <Link className="kpi kpi-link" href="/counts"><b>{data.needsCountWithTarget.toLocaleString()}</b><span>have a target but no recorded stock. Start a count →</span></Link>
        <div className={'kpi' + (chosen.length ? ' kpi-on' : '')}><b>{chosen.length.toLocaleString()}</b><span>{chosen.length ? `selected · ${units.toLocaleString()} units to order` : 'selected'}</span></div>
      </div>
    )}
    <Note tone="info" icon="info">Suggested order = target minus available, never below 0. It is a suggestion, not a purchase order. Lenses with no recorded stock or target are left out.</Note>

    <div className="sug-find card">
      <div className="toolbar" style={{ margin: 0 }}>
        <input type="search" className="search grow" aria-label="Search" placeholder="Search by power, label or workbook…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Group by">
          {([['workbook', 'By workbook'], ['supplier', 'By supplier']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={groupBy === k} className={groupBy === k ? 'on' : ''} onClick={() => setGroupBy(k)}>{l}</button>
          ))}
        </div>
        {data?.netEnabled && <label className="check"><input type="checkbox" checked={net} onChange={e => { setNet(e.target.checked); setPage(1); }} /> <span>Net of open purchase orders <span className="mut">(differs from the original Excel rule)</span></span></label>}
      </div>

      <div className="pills" role="group" aria-label="Urgency">
        <button type="button" aria-pressed={status === ''} onClick={() => { setStatus(''); setPage(1); }}>All</button>
        {URGENCY.map(k => (
          <button type="button" key={k} aria-pressed={status === k} onClick={() => { setStatus(status === k ? '' : k); setPage(1); }}>
            <span className={'dot ' + STATUS[k][1]} aria-hidden="true" />{STATUS[k][0]}
          </button>
        ))}
      </div>

      <details className="fold stock-fold">
        <summary><span>Group and power{filterCount > 0 && <span className="badge b-acc" style={{ marginLeft: 8 }}>{filterCount} set</span>}</span></summary>
        <div className="sug-fold-grid">
          <Tree sel={node} onSel={(id, name) => { setNode(id); setNodeName(name); setPage(1); }} title="Browse by group" />
          <div>
            <div className="power" role="group" aria-label="Power filters">
              {POWERS.map(p => (
                <div key={p.label} className="field">
                  <span>{p.label}</span>
                  <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <input inputMode="decimal" aria-label={`${p.label} from`} placeholder="from" value={r[p.min] ?? ''} onChange={e => setPower(p.min, e.target.value)} style={{ width: 76 }} />
                    <span className="mut">to</span>
                    <input inputMode="decimal" aria-label={`${p.label} to`} placeholder="to" value={r[p.max] ?? ''} onChange={e => setPower(p.max, e.target.value)} style={{ width: 76 }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="hint mut small" style={{ margin: '8px 0 0' }}>Lenses without that power are left out when a range is set.</p>
          </div>
        </div>
      </details>

      {chips.length > 0 && (
        <div className="row" role="group" aria-label="Active filters" style={{ margin: 0 }}>
          {chips.map(c => <span key={c.key} className="chip-filter">{c.label}<button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear}>×</button></span>)}
          {hasFilters && <button type="button" className="link" onClick={clearAll}>Clear all</button>}
          {loading && <span className="mut small" role="status">Updating…</span>}
        </div>
      )}
    </div>

    {err && <div className="err" role="alert">{err}</div>}
    {!data && !err && <Loading rows={8} />}
    {data && (rows.length === 0
      ? <EmptyState icon="check" title={hasFilters ? 'No suggestions match these filters' : 'Nothing to order right now'} action={hasFilters ? <button onClick={clearAll}>Clear all filters</button> : undefined}>{hasFilters ? 'Try another urgency, group or power range.' : 'Every lens with a recorded stock and target is at or above its target.'}</EmptyState>
      : <>
        <div className="list-tools" style={{ margin: '4px 2px 8px' }}>
          <span className="mut small">{groups.length} {groups.length === 1 ? 'group' : 'groups'} on this page{chosen.length > 0 && rows.some(x => sel[x.variant_id]) === false ? ' · your selection is on other pages' : ''}</span>
          {groups.length > 1 && <button type="button" className="link" onClick={() => setClosed(Object.fromEntries(groups.map(g => [g.key, !allClosed])))}>{allClosed ? 'Expand all' : 'Collapse all'}</button>}
        </div>
        <div className="wrap sugwrap" tabIndex={0} role="region" aria-label="Suggested orders" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <table className="sugtable">
            <thead><tr>
              <th style={{ width: 40 }}><GroupCheck state={stateOf(rows)} label="Pick every lens on this page" onChange={on => toggleMany(rows, on)} /></th>
              <th>Lens</th><th className="n">Stock vs target</th><th className="n">Suggested</th>{data.usingNet && <th className="n">Net</th>}
              {groupBy === 'workbook' && <th className="hide-sm">Preferred supplier</th>}<th className="n">Order qty</th>
            </tr></thead>
            {groups.map((g, gi) => {
              const shut = !!closed[g.key]; const st = stateOf(g.items); const gUnits = g.items.reduce((s, x) => s + sugOf(x), 0);
              return (
                <tbody key={g.key}>
                  <tr className="sug-grp">
                    <td><GroupCheck state={st} label={`Pick every lens in ${g.title}`} onChange={on => toggleMany(g.items, on)} /></td>
                    <td colSpan={cols - 1}>
                      <button type="button" className="sug-grp-btn" aria-expanded={!shut} aria-controls={`sg-${gi}`} onClick={() => setClosed({ ...closed, [g.key]: !shut })}>
                        <Ico n="chevron" />
                        <span className="sug-grp-title">
                          <b className={g.none ? 'b-warn' : ''}>{g.title}</b>{g.sub && <small>{g.sub}</small>}
                        </span>
                        <span className="sug-grp-meta">{g.items.length} {g.items.length === 1 ? 'lens' : 'lenses'} · {gUnits.toLocaleString()} units{st !== 'none' ? ` · ${g.items.filter(x => sel[x.variant_id]).length} selected` : ''}</span>
                      </button>
                    </td>
                  </tr>
                  {!shut && g.items.map((x: any) => {
                    const s = sel[x.variant_id]; const f = fill(x); const [stText, stCls] = STATUS[x.stock_status] ?? ['', ''];
                    const edited = s && String(s.sug) !== s.qty; const bad = s && !(Number(s.qty) > 0);
                    return (
                      <tr key={x.variant_id} className={s ? 'picked' : undefined}>
                        <td><input type="checkbox" aria-label={`Select ${fmtPower(x.row_label_source)}${x.col_label_source ? ' × ' + fmtPower(x.col_label_source) : ''}`} checked={!!s} onChange={e => toggleRow(x, e.target.checked)} /></td>
                        <td>
                          <Link className="lens-link" href={`/inventory/${x.variant_id}`}><Lens row={x.row_label_source} col={x.col_label_source} /></Link>
                          {x.stock_status === 'out_of_stock' && <span className={'sug-st ' + stCls}>{stText}</span>}
                          {groupBy === 'supplier' && <span className="sub where" title={x.workbook}>{x.workbook} › {x.block}</span>}
                        </td>
                        <td className="n">
                          <span className="stockcell">
                            <span className="nums"><b>{num(x.available_quantity)}</b><span className="of"> / {num(x.target_quantity)}</span></span>
                            {f && <span className={'meter ' + f.tone} aria-hidden="true"><i style={{ width: f.pct + '%' }} /></span>}
                          </span>
                        </td>
                        <td className="n"><b className="sug-n">{x.suggested_order}</b></td>
                        {data.usingNet && <td className="n">{x.net_suggested_order}</td>}
                        {groupBy === 'workbook' && <td className="hide-sm">{x.preferred_supplier ?? <span className="sug-nosup">None set</span>}</td>}
                        <td className="n">{s
                          ? <span className="sug-qty"><input aria-label="Order quantity" inputMode="numeric" className={bad ? 'bad' : edited ? 'edited' : ''} value={s.qty} onChange={e => setSel({ ...sel, [x.variant_id]: { ...s, qty: e.target.value.replace(/\D/g, '') } })} />{edited && <button type="button" className="link small" onClick={() => setSel({ ...sel, [x.variant_id]: { ...s, qty: String(s.sug) } })}>Use {s.sug}</button>}</span>
                          : <span className="mut small">Tick to order</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        <Pager d={data} page={page} setPage={setPage} />
      </>)}

    {chosen.length > 0 && <section className="card selbar sug-bar" aria-label="Create purchase order">
      <div className="sug-bar-sum"><b>{chosen.length} line{chosen.length === 1 ? '' : 's'}</b><span className="mut"> · {units.toLocaleString()} units</span></div>
      <select aria-label="Supplier" value={sid} onChange={e => setSid(e.target.value)}><option value="">Choose supplier…</option>{sup.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select>
      <input aria-label="PO number" placeholder="PO number" value={po} onChange={e => setPo(e.target.value)} />
      <button className="p" disabled={!sid || !po.trim()} onClick={create}>Create draft purchase order</button>
      <button className="link" onClick={() => setSel({})}>Clear selection</button>
      {(otherSup > 0 || noSup > 0) && <span className="sug-warn small" role="note">
        {otherSup > 0 && <>{otherSup} selected {otherSup === 1 ? 'lens prefers' : 'lenses prefer'} a different supplier. </>}
        {noSup > 0 && <>{noSup} {noSup === 1 ? 'has' : 'have'} no preferred supplier.</>}
      </span>}
      {e2 && <span className="err" role="alert">{e2}</span>}
    </section>}
  </>);
}