'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from './api';
import { Ico } from './ui';

type N = { id: string; kind: string; source_name: string; original_name?: string | null; child_count: number; variant_count: number };
type Crumb = { id: string; name: string; count?: number; kind?: string; orig?: string | null };
type OnSel = (id: string | null, name: string, path?: string[], meta?: { kind?: string; original?: string | null }) => void;
const KIND_ICON: Record<string, string> = { family: 'folder', folder: 'folder', workbook: 'book', block: 'grid' };
const KIND_LABEL: Record<string, string> = { family: 'Category', folder: 'Folder', workbook: 'Workbook', block: 'Grid' };
const fmt = (n: number) => n.toLocaleString();

/* Step-by-step history (opt-in: trackHistory). Every level you open is a browser-history entry that remembers the whole path, so
 * • the browser Back button and the "← Back" button go up ONE level at a time,
 * • coming back from a lens / bill / count (browser Back or the page's "← Back") shows the same folder again, not the top.
 * The address does not change; the path lives in history.state. */
const HK = 'roTree';
type Snap = { stack: Crumb[]; n: number };
const readSnap = (): Snap | null => { try { const v = window.history.state?.[HK]; return v && Array.isArray(v.stack) && typeof v.n === 'number' ? v : null; } catch { return null; } };
const writeSnap = (snap: Snap, mode: 'push' | 'replace') => { try { const st = { ...(window.history.state ?? {}), [HK]: snap }; if (mode === 'push') window.history.pushState(st, ''); else window.history.replaceState(st, ''); } catch { /* history unavailable: the path is just not tracked */ } };
const idsOf = (s: Crumb[]) => s.map(x => x.id).join('/');

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

/** Inline rename for one folder / file / grid. The new name is saved on the server in one place, so every screen, export and report shows it. */
function RenameForm({ initial, original, kindLabel, onSave, onCancel }: { initial: string; original?: string | null; kindLabel: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save(name: string) { setBusy(true); setErr(''); try { await onSave(name); } catch (e: any) { setErr(e.message || 'Could not rename'); setBusy(false); } }
  const changed = v.trim() !== '' && v.trim() !== initial;
  return (
    <form className="gb-rename" onSubmit={e => { e.preventDefault(); if (changed) save(v); }} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="row">
        <input autoFocus aria-label={`New name for this ${kindLabel.toLowerCase()}`} value={v} maxLength={200} onChange={e => setV(e.target.value)} onFocus={e => e.currentTarget.select()} />
        <button type="submit" className="p" disabled={!changed || busy}>{busy ? 'Saving…' : 'Save name'}</button>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <div className="hint">Everything inside keeps its data. The new name shows everywhere in the app, in order reports and in exports.</div>
      {original && original !== initial && <div className="hint">Originally imported as “{original}”. <button type="button" className="link" disabled={busy} onClick={() => save(original)}>Restore original name</button></div>}
      {err && <div className="err small" role="alert">{err}</div>}
    </form>
  );
}

/**
 * Drill-down group browser. Shows ONE level at a time as tiles: tap a tile to select it and step inside.
 * The breadcrumb jumps back to any level. The selected group is always the level you are looking at.
 * Same props as before — onSel(id | null, name, path[]) — so every page keeps working.
 * reports: also show "Order report" PDF / Excel download links for the level you are on and for every group tile.
 * editable: show a rename pencil on every tile and on the level you are inside (folders, files and grids at every depth); onRenamed fires after a save.
 */
export default function Tree({ sel, onSel, title = 'Browse by group', reports = false, editable = false, onRenamed, trackHistory = false }: { sel: string | null; onSel: OnSel; title?: string; reports?: boolean; editable?: boolean; onRenamed?: (id: string, name: string) => void; trackHistory?: boolean }) {
  const cache = useRef<Record<string, N[]>>({});
  const [stack, setStack] = useState<Crumb[]>([]);
  const [kids, setKids] = useState<N[] | null>(null); const [err, setErr] = useState(''); const [tick, setTick] = useState(0); const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);   // id of the tile being renamed, or 'cur' for the level you are inside
  const cur = stack.length ? stack[stack.length - 1] : null;
  const pos = useRef(0);                        // position of the current level among the history entries this browser pushed
  const entries = useRef<string[]>(['']);       // entries[pos] = ids of the path shown at that position (to know if the parent is the previous entry)
  const onSelRef = useRef(onSel); onSelRef.current = onSel;
  const applyStack = (next: Crumb[]) => {       // show a path that came from history (browser Back / Forward / return from a detail page)
    setStack(next);
    if (next.length === 0) onSelRef.current(null, '', []); else { const t = next[next.length - 1]; onSelRef.current(t.id, t.name, next.map(x => x.name), { kind: t.kind, original: t.orig }); }
  };
  useEffect(() => {
    if (!trackHistory) return;
    const snap = readSnap();
    if (snap) { pos.current = snap.n; entries.current[snap.n] = idsOf(snap.stack); if (snap.stack.length) applyStack(snap.stack); }
    else writeSnap({ stack: [], n: 0 }, 'replace');   // mark the screen you started on as the top level
    const onPop = (e: PopStateEvent) => { const v = e.state?.[HK] as Snap | undefined; if (!v || !Array.isArray(v.stack)) return; pos.current = v.n; entries.current[v.n] = idsOf(v.stack); applyStack(v.stack); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (next: Crumb[]) => { if (!trackHistory) return; const n = pos.current + 1; pos.current = n; entries.current.length = n; entries.current[n] = idsOf(next); writeSnap({ stack: next, n }, 'push'); };

  // keep in step with the page: cleared from outside → back to the top; set from outside → show that group
  useEffect(() => {
    if (sel === null) { if (stack.length) setStack([]); }
    else if (cur?.id !== sel) setStack([{ id: sel, name: 'Selected folder' }]);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = cur?.id ?? 'root'; setFilter(''); setErr(''); setEditing(null);
    if (cache.current[key]) { setKids(cache.current[key]); return; }
    let alive = true; setKids(null);
    api<{ items: N[] }>('/api/catalog' + (cur ? `?parentId=${cur.id}` : '')).then(r => { cache.current[key] = r.items; if (alive) setKids(r.items); }).catch(e => alive && setErr(e.message || 'Could not load groups'));
    return () => { alive = false; };
  }, [cur?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = (s: Crumb[]) => s.map(c => c.name);
  function open(n: N) { const next = [...stack, { id: n.id, name: n.source_name, count: n.variant_count, kind: n.kind, orig: n.original_name }]; setStack(next); remember(next); onSel(n.id, n.source_name, names(next), { kind: n.kind, original: n.original_name }); }
  /** rename on the server, then refresh just what this browser has cached (the list it sits in, and the breadcrumb if it is the current level) */
  async function rename(id: string, name: string, isCur: boolean) {
    const r = await api<{ node: { source_name: string; original_name: string | null } }>(`/api/catalog/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    const saved = r.node.source_name; const orig = r.node.original_name;
    if (isCur) {
      const next = stack.map(c => c.id === id ? { ...c, name: saved, orig } : c); setStack(next); if (trackHistory) writeSnap({ stack: next, n: pos.current }, 'replace');
      delete cache.current[stack.length > 1 ? stack[stack.length - 2].id : 'root'];   // the list that contains it still has the old name
      onSel(id, saved, names(next), { kind: cur?.kind, original: orig });
    } else { delete cache.current[cur?.id ?? 'root']; setTick(t => t + 1); }
    setEditing(null); onRenamed?.(id, saved);
  }
  function goTo(depth: number) { // depth -1 = top
    const next = stack.slice(0, depth + 1); setStack(next); remember(next);
    if (next.length === 0) onSel(null, '', []); else { const t = next[next.length - 1]; onSel(t.id, t.name, names(next), { kind: t.kind, original: t.orig }); }
  }
  /** "← Back": one level up. If the level above is the previous history entry (the usual case) step back in history, otherwise open it as a new entry. */
  function up() {
    if (!stack.length) return;
    if (trackHistory && pos.current > 0 && entries.current[pos.current - 1] === idsOf(stack.slice(0, -1))) { window.history.back(); return; }
    goTo(stack.length - 2);
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
        {editable && cur && editing !== 'cur' && <button type="button" className="sm" onClick={() => setEditing('cur')} aria-label={`Rename ${cur.name}`}><Ico n="edit" /> Rename</button>}
        {stack.length > 0 && <button type="button" className="sm" onClick={up}>← Back</button>}
      </div>
      {editable && cur && editing === 'cur' && <RenameForm initial={cur.name} original={cur.orig} kindLabel={KIND_LABEL[cur.kind ?? ''] ?? 'item'} onSave={n => rename(cur.id, n, true)} onCancel={() => setEditing(null)} />}

      {reports && <ReportLinks id={cur?.id ?? null} label={cur ? cur.name : 'All inventory'} />}

      {err && <div className="err small" role="alert" style={{ margin: '4px 0' }}>{err} <button type="button" className="link" onClick={() => setTick(t => t + 1)}>Retry</button></div>}
      {!kids && !err && <div className="tree-skel" role="status" aria-label="Loading groups">{[0, 1, 2].map(i => <i key={i} className="skeleton" />)}</div>}

      {kids && kids.length > 7 && <input type="search" className="search gb-filter" aria-label="Filter this level" placeholder={`Filter ${kids.length} groups…`} value={filter} onChange={e => setFilter(e.target.value)} />}
      {kids && (
        <ul className="gb-list">
          {shown.map(k => (
            <li key={k.id}>
              {editable && editing === k.id
                ? <RenameForm initial={k.source_name} original={k.original_name} kindLabel={KIND_LABEL[k.kind] ?? 'item'} onSave={n => rename(k.id, n, false)} onCancel={() => setEditing(null)} />
                : <div className={editable ? 'gb-row' : undefined}>
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
              {editable && <button type="button" className="gb-edit" onClick={() => setEditing(k.id)} aria-label={`Rename ${k.source_name}`} title="Rename"><Ico n="edit" /></button>}
              </div>}
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