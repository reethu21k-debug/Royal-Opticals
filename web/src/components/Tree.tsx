'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from './api';
import { Ico } from './ui';

type N = { id: string; kind: string; source_name: string; child_count: number; variant_count: number };
type Crumb = { id: string; name: string; count?: number };
type OnSel = (id: string | null, name: string, path?: string[]) => void;
const KIND_ICON: Record<string, string> = { family: 'folder', folder: 'folder', workbook: 'book', block: 'grid' };
const KIND_LABEL: Record<string, string> = { family: 'Category', folder: 'Folder', workbook: 'Workbook', block: 'Grid' };
const fmt = (n: number) => n.toLocaleString();

/** "Order report" downloads (PDF / Excel) for one level of the hierarchy. id = null means everything. Includes every sub-level below it. */
function ReportLinks({ id, label }: { id: string | null; label: string }) {
  const base = '/api/suggested-orders/export?' + (id ? `nodeId=${id}&` : '');
  const a = { color: 'var(--acc)', fontWeight: 600, textDecoration: 'none' } as const;
  return (
    <div className="small" role="group" aria-label={`Order report for ${label}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 4px 0' }}>
      <span className="mut">Order report</span>
      <a href={base + 'format=pdf'} style={a} aria-label={`Download PDF order report for ${label}`}>PDF</a>
      <a href={base + 'format=xlsx'} style={a} aria-label={`Download Excel order report for ${label}`}>Excel</a>
    </div>
  );
}

/**
 * Drill-down group browser. Shows ONE level at a time as tiles: tap a tile to select it and step inside.
 * The breadcrumb jumps back to any level. The selected group is always the level you are looking at.
 * Same props as before — onSel(id | null, name, path[]) — so every page keeps working.
 * reports: also show "Order report" PDF / Excel download links for the level you are on and for every group tile.
 */
export default function Tree({ sel, onSel, title = 'Browse by group', reports = false }: { sel: string | null; onSel: OnSel; title?: string; reports?: boolean }) {
  const cache = useRef<Record<string, N[]>>({});
  const [stack, setStack] = useState<Crumb[]>([]);
  const [kids, setKids] = useState<N[] | null>(null); const [err, setErr] = useState(''); const [tick, setTick] = useState(0); const [filter, setFilter] = useState('');
  const cur = stack.length ? stack[stack.length - 1] : null;

  // keep in step with the page: cleared from outside → back to the top; set from outside → show that group
  useEffect(() => {
    if (sel === null) { if (stack.length) setStack([]); }
    else if (cur?.id !== sel) setStack([{ id: sel, name: 'Selected folder' }]);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = cur?.id ?? 'root'; setFilter(''); setErr('');
    if (cache.current[key]) { setKids(cache.current[key]); return; }
    let alive = true; setKids(null);
    api<{ items: N[] }>('/api/catalog' + (cur ? `?parentId=${cur.id}` : '')).then(r => { cache.current[key] = r.items; if (alive) setKids(r.items); }).catch(e => alive && setErr(e.message || 'Could not load groups'));
    return () => { alive = false; };
  }, [cur?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = (s: Crumb[]) => s.map(c => c.name);
  function open(n: N) { const next = [...stack, { id: n.id, name: n.source_name, count: n.variant_count }]; setStack(next); onSel(n.id, n.source_name, names(next)); }
  function goTo(depth: number) { // depth -1 = top
    const next = stack.slice(0, depth + 1); setStack(next);
    if (next.length === 0) onSel(null, '', []); else onSel(next[next.length - 1].id, next[next.length - 1].name, names(next));
  }
  const rootTotal = (cache.current['root'] ?? []).reduce((s, r) => s + r.variant_count, 0);
  const total = cur ? cur.count : rootTotal;
  const max = Math.max(1, ...(kids ?? []).map(k => k.variant_count));
  const shown = (kids ?? []).filter(k => k.source_name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <nav className="card tree gb" aria-label="Group browser">
      <h2 className="tree-title">{title}</h2>

      {stack.length > 0 && <ol className="gb-crumbs" aria-label="Where you are">
        <li>{stack.length === 0 ? <b aria-current="location">All inventory</b> : <button type="button" className="link" onClick={() => goTo(-1)}>All inventory</button>}</li>
        {stack.map((c, i) => (
          <li key={c.id}><Ico n="chevron" className="sep" />{i === stack.length - 1 ? <b aria-current="location">{c.name}</b> : <button type="button" className="link" onClick={() => goTo(i)}>{c.name}</button>}</li>
        ))}
      </ol>}

      <div className="gb-now" aria-live="polite">
        <div><b>{cur ? cur.name : 'All inventory'}</b><span>{total !== undefined && total !== null && (cur || rootTotal) ? `${fmt(total)} lenses` : ''}</span></div>
        {stack.length > 0 && <button type="button" className="sm" onClick={() => goTo(stack.length - 2)}>← Back</button>}
      </div>

      {reports && <ReportLinks id={cur?.id ?? null} label={cur ? cur.name : 'All inventory'} />}

      {err && <div className="err small" role="alert" style={{ margin: '4px 0' }}>{err} <button type="button" className="link" onClick={() => setTick(t => t + 1)}>Retry</button></div>}
      {!kids && !err && <div className="tree-skel" role="status" aria-label="Loading groups">{[0, 1, 2].map(i => <i key={i} className="skeleton" />)}</div>}

      {kids && kids.length > 7 && <input type="search" className="search gb-filter" aria-label="Filter this level" placeholder={`Filter ${kids.length} groups…`} value={filter} onChange={e => setFilter(e.target.value)} />}
      {kids && (
        <ul className="gb-list">
          {shown.map(k => (
            <li key={k.id}>
              <button type="button" className="gb-tile" onClick={() => open(k)} title={`${k.source_name} · ${KIND_LABEL[k.kind] ?? k.kind}`}>
                <Ico n={KIND_ICON[k.kind] ?? 'folder'} className="kind" />
                <span className="gb-main">
                  <span className="gb-name">{k.source_name}<span className="sr"> ({fmt(k.variant_count)})</span></span>
                  <span className="gb-meta">{KIND_LABEL[k.kind] ?? k.kind}{k.child_count > 0 ? ` · ${k.child_count} inside` : ''}</span>
                  <span className="gb-share" aria-hidden="true"><i style={{ width: Math.max(3, Math.round((k.variant_count / max) * 100)) + '%' }} /></span>
                </span>
                <span className="gb-count"><b aria-hidden="true">{fmt(k.variant_count)}</b><small aria-hidden="true">lenses</small></span>
                {k.child_count > 0 && <Ico n="chevron" className="go" />}
              </button>
              {reports && <ReportLinks id={k.id} label={k.source_name} />}
            </li>
          ))}
          {kids.length === 0 && (cur
            ? <li className="tree-note">This is the lowest level. Everything shown on the right belongs to <b>{cur.name}</b>.</li>
            : <li className="tree-note">No groups yet. <Link href="/imports">Import a workbook</Link> to get started.</li>)}
          {kids.length > 0 && shown.length === 0 && <li className="tree-note">No group matches “{filter}”.</li>}
        </ul>
      )}
    </nav>
  );
}