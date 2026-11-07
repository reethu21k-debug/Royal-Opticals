'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Tree from '@/components/Tree';
import { api, ago } from '@/components/api';
import { PageHeader, Badge, EmptyState, Loading, Ico, type Tone } from '@/components/ui';

type Session = { id: string; name: string; scope_name: string | null; status: string; counted: number; lines: number; created_at: string };
const STATUS_LABEL: Record<string, string> = { open: 'In progress', submitted: 'Waiting for approval', approved: 'Approved', cancelled: 'Cancelled' };
const STATUS_TONE: Record<string, Tone> = { open: 'warn', submitted: 'info', approved: 'ok', cancelled: 'mute' };
const TABS: [string, string][] = [['active', 'Active'], ['approved', 'Approved'], ['cancelled', 'Cancelled'], ['all', 'All']];
const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Counts() {
  const [items, setItems] = useState<Session[] | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [node, setNode] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState('');
  const [trail, setTrail] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('active');
  const [selecting, setSelecting] = useState(false);   // select mode: tick several counts and delete them together
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);   // hide / show the list of counts (remembered in this browser)

  useEffect(() => { try { setHidden(localStorage.getItem('counts-list-hidden') === '1'); } catch {} }, []);
  function toggleList() { setHidden(h => { const n = !h; try { localStorage.setItem('counts-list-hidden', n ? '1' : '0'); } catch {} return n; }); }

  useEffect(() => { api('/api/counts').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);

  async function remove(e: React.MouseEvent, s: Session) {
    e.preventDefault(); e.stopPropagation();   // the card is a link: do not open the count
    if (!confirm(`Delete the count "${s.name}"?\n\n${s.counted.toLocaleString()} of ${s.lines.toLocaleString()} lines were counted in it. They will be lost. Stock is not changed.\n\nThis cannot be undone.`)) return;
    setErr('');
    try { await api(`/api/counts/${s.id}`, { method: 'DELETE' }); setItems(list => (list ?? []).filter(x => x.id !== s.id)); }
    catch (er: any) { setErr(er.message); }
  }

  function toggleSel(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function stopSelecting() { setSelecting(false); setSel(new Set()); }
  async function removeSelected() {
    const list = (items ?? []).filter(x => sel.has(x.id) && x.status !== 'approved');
    if (!list.length) return;
    const lost = list.reduce((a, x) => a + x.counted, 0);
    if (!confirm(`Delete ${list.length} count${list.length === 1 ? '' : 's'}?\n\n${list.slice(0, 8).map(x => '• ' + x.name).join('\n')}${list.length > 8 ? `\n• …and ${list.length - 8} more` : ''}\n\n${lost.toLocaleString()} counted lines will be lost. Stock is not changed.\n\nThis cannot be undone.`)) return;
    setErr(''); setBusy(true);
    try {
      await api('/api/counts/delete', { method: 'POST', body: JSON.stringify({ ids: list.map(x => x.id) }) });
      const gone = new Set(list.map(x => x.id));
      setItems(l => (l ?? []).filter(x => !gone.has(x.id)));
      stopSelecting();
    } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  }

  const isActive = (s: Session) => s.status === 'open' || s.status === 'submitted';
  const shown = useMemo(() => (items ?? []).filter(s => tab === 'all' ? true : tab === 'active' ? isActive(s) : s.status === tab), [items, tab]);
  const counts = useMemo(() => ({ active: (items ?? []).filter(isActive).length }), [items]);
  const suggested = `${nodeName || 'All inventory'} — ${today()}`;

  async function create() {
    setErr(''); setBusy(true);
    try {
      const r = await api('/api/counts', { method: 'POST', body: JSON.stringify({ name: (name.trim() || suggested), nodeId: node ?? undefined }) });
      window.location.href = `/counts/${r.session.id}`;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (<>
    <PageHeader title="Stock counts"
      sub={<>Count the shelf and type what you see. Stock only changes after a manager approves, and anything you leave blank stays <b>unknown</b>, never zero.</>}
      actions={<a className="btn p" href="#new-count"><Ico n="plus" />Start a new count</a>} />

    {err && <div className="err" role="alert">{err}</div>}

    {/* ───── existing sessions ───── */}
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div className="tabs" role="tablist" aria-label="Filter counts" style={{ flex: '1 1 auto' }}>
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (hidden) toggleList(); }}>{label}{k === 'active' && counts.active > 0 && <span className="n">{counts.active}</span>}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      {!hidden && shown.length > 0 && (selecting
        ? <button type="button" className="btn sm" onClick={stopSelecting}>Cancel selection</button>
        : <button type="button" className="btn sm" onClick={() => setSelecting(true)} title="Tick several counts and delete them together">Select</button>)}
      <button type="button" className="btn sm" onClick={toggleList} aria-expanded={!hidden} aria-controls="counts-list" style={{ marginBottom: 6 }}
        title={hidden ? 'Show the list of counts' : 'Hide the list of counts'}>
        {hidden ? `Show counts${items ? ` (${shown.length})` : ''}` : 'Hide counts'}
      </button>
      </div>
    </div>
    {selecting && !hidden && (() => {
      const pickable = shown.filter(x => x.status !== 'approved');
      const allOn = pickable.length > 0 && pickable.every(x => sel.has(x.id));
      return (<div className="card" role="toolbar" aria-label="Selected counts" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', margin: '10px 0' }}>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(pickable.map(x => x.id)))} />
          <span>Select all shown ({pickable.length})</span>
        </label>
        <span className="mut small">{sel.size} selected{shown.some(x => x.status === 'approved') ? ' · approved counts cannot be deleted' : ''}</span>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={sel.size === 0 || busy} onClick={removeSelected} style={{ color: 'var(--bad)' }}>{busy ? 'Deleting…' : `Delete selected (${sel.size})`}</button>
      </div>);
    })()}
    <div id="counts-list" hidden={hidden}>
    {!items && !err && <Loading rows={3} label="Loading counts" />}
    {items && shown.length === 0 && (
      <EmptyState icon="clipboard" title={tab === 'active' ? 'No counts in progress' : `No ${tab === 'all' ? '' : tab + ' '}counts yet`}>
        {tab === 'active' ? 'Choose a group below and press Start counting to begin.' : 'They will show up here.'}
      </EmptyState>
    )}
    <div className="sessions">
      {shown.map(s => {
        const pct = s.lines ? Math.round((s.counted / s.lines) * 100) : 0;
        const pick = selecting && s.status !== 'approved';
        return (<Link key={s.id} href={`/counts/${s.id}`} className="card session"
          onClick={selecting ? (e => { e.preventDefault(); if (pick) toggleSel(s.id); }) : undefined}
          style={sel.has(s.id) ? { outline: '2px solid var(--acc)', outlineOffset: -2 } : undefined}>
          <div className="session-top"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {selecting && <input type="checkbox" checked={sel.has(s.id)} disabled={!pick} readOnly aria-label={`Select ${s.name}`} style={{ flex: '0 0 auto' }} />}
            <b>{s.name}</b></span><Badge tone={STATUS_TONE[s.status] ?? 'mute'}>{STATUS_LABEL[s.status] ?? s.status}</Badge></div>
          <div className="mut small" style={{ marginTop: 4 }}>{s.scope_name ?? 'All inventory'} · started {ago(s.created_at)}</div>
          <div className={'bar' + (pct === 100 ? ' done' : '')} role="progressbar" aria-label={`${s.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
          <div className="session-foot"><span><b>{s.counted.toLocaleString()}</b> of {s.lines.toLocaleString()} counted ({pct}%)</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span className="go">{s.status === 'open' ? 'Continue' : 'View'}</span>
            {s.status !== 'approved' && !selecting && (
              <button type="button" onClick={e => remove(e, s)} aria-label={`Delete count ${s.name}`} title="Delete this count"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0, borderRadius: 8, color: 'var(--bad, #b42318)' }}>
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 15, height: 15, stroke: 'currentColor', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
              </button>)}
          </span></div>
        </Link>);
      })}
    </div>
    </div>

    {/* ───── start a new count ───── */}
    <div className="section-title" id="new-count" style={{ marginTop: 36 }}><h2>Start a new count</h2><span className="mut small">Two quick steps</span></div>
    <div className="split">
      <div>
        <div className="step-label"><span className="step-no">1</span>Choose what to count</div>
        <Tree title="What are you counting?" trackHistory sel={node} onSel={(id, n, path) => { setNode(id); setNodeName(n); setTrail(path ?? []); }} />
      </div>
      <div>
        <div className="step-label"><span className="step-no">2</span>Name it and start</div>
        <div className="card start-card">
          <div className="scope" aria-live="polite">
            <span className="mut">Counting:</span>
            <b>{nodeName || 'All inventory'}</b>
            {trail.length > 1 && <span className="mut small">in {trail.slice(0, -1).join(' › ')}</span>}
            {node && <button className="link" onClick={() => { setNode(null); setNodeName(''); setTrail([]); }}>Change to all inventory</button>}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (!busy) create(); }} style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>Session name <span className="mut" style={{ fontWeight: 400 }}>(optional)</span></span>
              <input aria-label="Session name" placeholder={suggested} value={name} onChange={e => setName(e.target.value)} />
              <span className="hint">Leave blank to use “{suggested}”.</span>
            </label>
            <div><button className="p big" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Start counting'}</button></div>
          </form>
        </div>
        <p className="mut small">In the count, type the number you see for each line. Every entry saves as you go, and you can leave and come back.</p>
      </div>
    </div>
  </>);
}