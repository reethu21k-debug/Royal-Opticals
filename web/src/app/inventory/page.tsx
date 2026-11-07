'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Tree from '@/components/Tree';
import InventoryTable from '@/components/InventoryTable';
import { useList, Pager } from '@/components/useInventory';
import { api, STATUS, STATUS_ORDER } from '@/components/api';
import { PageHeader, Ico, Loading, EmptyState, Note } from '@/components/ui';

const STATUS_LABEL: Record<string, string> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]]));

const POWERS: { label: string; min: string; max: string }[] = [
  { label: 'SPH', min: 'sphMin', max: 'sphMax' },
  { label: 'CYL', min: 'cylMin', max: 'cylMax' },
  { label: 'ADD', min: 'addMin', max: 'addMax' },
];

function Inner() {
  const sp = useSearchParams();
  const [node, setNode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trail, setTrail] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState(sp.get('status') || '');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('active');
  const [r, setR] = useState<Record<string, string>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');   // list order; ascending = the existing default order

  // order: 'sph' = SPH-first order inside KRIPTOK LENS / PROGRESSIVE LENS only (see lib/inventory-query.ts). Other folders keep their order.
  const { data, err, loading, qs } = useList('/api/inventory', { nodeId: node, q: dq, status, active, page, pageSize: 50, dir: dir === 'desc' ? 'desc' : '', order: 'sph', ...r });

  // bulk target
  const [bt, setBt] = useState('');
  const [btMissing, setBtMissing] = useState(true);
  const [btReason, setBtReason] = useState('');
  const [btMsg, setBtMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [btBusy, setBtBusy] = useState(false);

  // debounce search
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);

  async function bulkTarget() {
    setBtMsg(null);
    if (!confirm(`Set target ${bt} for ${btMissing ? 'items without a target' : 'ALL items'} in "${name}"?`)) return;
    setBtBusy(true);
    try {
      const res = await api('/api/stock/targets/bulk', { method: 'POST', body: JSON.stringify({ nodeId: node, target: Number(bt), onlyMissing: btMissing, reason: btReason }) });
      setBtMsg({ ok: true, text: `${res.changed} targets changed.` });
      setPage(1);
    } catch (e: any) { setBtMsg({ ok: false, text: e.message }); } finally { setBtBusy(false); }
  }

  const powerCount = POWERS.filter(p => r[p.min] || r[p.max]).length;
  const hasFilters = !!(node || dq || status || active !== 'active' || powerCount);

  function setPower(k: string, v: string) { setR({ ...r, [k]: v }); setPage(1); }
  function clearAll() { setNode(null); setName(''); setTrail([]); setQ(''); setDq(''); setStatus(''); setActive('active'); setR({}); setPage(1); }

  // Order report (lenses below target) for exactly what is on screen: group, search, power ranges, active/archived.
  // The report only lists lenses that need ordering, so a status filter is passed on only when it is one of those two.
  const reportQs = new URLSearchParams();
  if (node) reportQs.set('nodeId', node); if (dq) reportQs.set('q', dq); if (active !== 'active') reportQs.set('active', active);
  if (status === 'out_of_stock' || status === 'below_target') reportQs.set('status', status);
  Object.entries(r).forEach(([k, v]) => { if (v) reportQs.set(k, v); });
  const reportHref = (fmt: 'pdf' | 'xlsx') => `/api/suggested-orders/export?${reportQs.toString()}${reportQs.toString() ? '&' : ''}format=${fmt}`;
  const exportHref = `/api/export/inventory?${qs.replace(/&?page=\d+/, '').replace(/&?pageSize=\d+/, '')}`;

  // removable chips for everything currently narrowing the list
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (node) chips.push({ key: 'node', label: name || 'Selected group', clear: () => { setNode(null); setName(''); setTrail([]); setPage(1); } });
  if (active !== 'active') chips.push({ key: 'active', label: active === 'archived' ? 'Archived only' : 'Active and archived', clear: () => { setActive('active'); setPage(1); } });
  if (dq) chips.push({ key: 'q', label: `“${dq}”`, clear: () => { setQ(''); setDq(''); setPage(1); } });
  if (status) chips.push({ key: 'status', label: STATUS_LABEL[status] ?? status, clear: () => { setStatus(''); setPage(1); } });
  POWERS.forEach(p => {
    const lo = r[p.min], hi = r[p.max];
    if (lo || hi) chips.push({ key: p.label, label: `${p.label} ${lo || '…'} to ${hi || '…'}`, clear: () => { setR({ ...r, [p.min]: '', [p.max]: '' }); setPage(1); } });
  });

  const moreCount = powerCount + (active !== 'active' ? 1 : 0);

  return (
    <>
      <PageHeader
        crumbs={trail.length ? [{ label: 'All inventory' }, ...trail.map(t => ({ label: t }))] : name ? [{ label: 'All inventory' }, { label: name }] : undefined}
        title="Inventory"
        sub="Find any lens, see how it compares with its target, and export what you see."
        actions={<>
          <a className="btn" href={reportHref('pdf')}><Ico n="download" />Order report (PDF)</a>
          <a className="btn" href={reportHref('xlsx')}><Ico n="download" />Order report (Excel)</a>
          <a className="btn" href={exportHref}><Ico n="download" />Export view (xlsx)</a>
        </>}
      />

      <div className="split">
        <Tree reports trackHistory sel={node} onSel={(id, n, path) => { setNode(id); setName(n); setTrail(path ?? (n ? [n] : [])); setPage(1); }} />

        <div>
          {/* ───── search & quick status filter ───── */}
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <input type="search" className="search grow" aria-label="Search" placeholder="Search by power, label or workbook…" value={q} onChange={e => setQ(e.target.value)} />
            <button type="button" onClick={() => { setDir(dir === 'asc' ? 'desc' : 'asc'); setPage(1); }}
              title={dir === 'asc' ? 'Ascending order. Click to show the list in descending order.' : 'Descending order. Click to show the list in ascending order.'}
              aria-label={`Sort order: ${dir === 'asc' ? 'ascending' : 'descending'}. Activate to switch to ${dir === 'asc' ? 'descending' : 'ascending'}.`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', transition: 'transform .18s', transform: dir === 'desc' ? 'rotate(180deg)' : 'none' }}><path d="M12 19V5m0 0-5 5m5-5 5 5" /></svg>
              {dir === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
          <div className="pills" role="group" aria-label="Stock status" style={{ marginBottom: 12 }}>
            <button type="button" aria-pressed={status === ''} onClick={() => { setStatus(''); setPage(1); }}>All</button>
            {STATUS_ORDER.map(k => (
              <button type="button" key={k} aria-pressed={status === k} onClick={() => { setStatus(status === k ? '' : k); setPage(1); }}>
                <span className={'dot ' + STATUS[k][1]} aria-hidden="true" />{STATUS[k][0]}
              </button>
            ))}
          </div>

          {(chips.length > 0 || hasFilters) && (
            <div className="row" role="group" aria-label="Active filters">
              {chips.map(c => (
                <span key={c.key} className="chip-filter">{c.label}
                  <button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear}>×</button>
                </span>
              ))}
              {hasFilters && <button className="link" onClick={clearAll}>Clear all</button>}
              {loading && <span className="mut small" role="status">Updating…</span>}
            </div>
          )}

          <details className="fold" open={moreOpen} onToggle={e => setMoreOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              <span>More filters{moreCount > 0 && <span className="badge b-acc" style={{ marginLeft: 8 }}>{moreCount} set</span>}</span>
              <span className="mut small" style={{ fontWeight: 400 }}>Power range · archived</span>
            </summary>
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <div className="power" role="group" aria-label="Power filters">
                  {POWERS.map(p => (
                    <div key={p.label} className="field">
                      <span>{p.label}</span>
                      <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                        <input inputMode="decimal" aria-label={`${p.label} from`} placeholder="from" value={r[p.min] ?? ''} onChange={e => setPower(p.min, e.target.value)} style={{ width: 80 }} />
                        <span className="mut">to</span>
                        <input inputMode="decimal" aria-label={`${p.label} to`} placeholder="to" value={r[p.max] ?? ''} onChange={e => setPower(p.max, e.target.value)} style={{ width: 80 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint mut small" style={{ margin: '10px 0 0' }}>Lenses without that power are left out when a range is set.</p>
              </div>
              <div className="field">
                <span>Show</span>
                <div className="seg" role="tablist" aria-label="Active or archived" style={{ justifySelf: 'start' }}>
                  {[['active', 'Active'], ['archived', 'Archived'], ['all', 'Both']].map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={active === k} className={active === k ? 'on' : ''} onClick={() => { setActive(k); setPage(1); }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </details>

          {/* ───── bulk target (only when a group is selected) ───── */}
          {node && (
            <details className="fold">
              <summary>Set target for everything in “{name}”</summary>
              <div>
                <div className="action-bar" style={{ marginTop: 0 }}>
                  <label className="field" style={{ minWidth: 110, flex: '0 0 110px' }}>
                    <span>Target</span>
                    <input aria-label="Bulk target" inputMode="numeric" placeholder="e.g. 10" value={bt} onChange={e => setBt(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field">
                    <span>Reason (required)</span>
                    <input aria-label="Bulk target reason" placeholder="e.g. seasonal restock plan" value={btReason} onChange={e => setBtReason(e.target.value)} />
                  </label>
                  <button className="p" disabled={bt === '' || !btReason.trim() || btBusy} onClick={bulkTarget}>{btBusy ? 'Applying…' : 'Apply target'}</button>
                </div>
                <label className="check" style={{ margin: '12px 0 0' }}>
                  <input type="checkbox" checked={btMissing} onChange={e => setBtMissing(e.target.checked)} />
                  <span>Only where no target is set</span>
                </label>
                {!btMissing && <Note tone="warn" icon="alert">This will overwrite existing targets for every item in this group.</Note>}
                {btMsg && <div className={btMsg.ok ? 'okmsg' : 'err'} role={btMsg.ok ? 'status' : 'alert'}>{btMsg.text}</div>}
              </div>
            </details>
          )}

          {err && <div className="err" role="alert">{err}</div>}
          {data && (
            data.items.length === 0 ? (
              <EmptyState icon="search" title="No lenses match these filters" action={hasFilters ? <button onClick={clearAll}>Clear all filters</button> : undefined}>
                Try a wider power range, a different status, or another group.
              </EmptyState>
            ) : (
              <div className="fade-in" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
                <InventoryTable items={data.items} />
                <Pager d={data} page={page} setPage={setPage} />
                <p className="mut small" style={{ margin: '8px 0 0' }}>Lenses with zero stock are always shown. “Not recorded” is never treated as zero.</p>
              </div>
            )
          )}
          {!data && !err && <Loading rows={8} label="Loading lenses" />}
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading rows={6} />}><Inner /></Suspense>;
}