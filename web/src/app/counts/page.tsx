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
  const [hidden, setHidden] = useState(false);   // hide / show the list of counts (remembered in this browser)

  useEffect(() => { try { setHidden(localStorage.getItem('counts-list-hidden') === '1'); } catch {} }, []);
  function toggleList() { setHidden(h => { const n = !h; try { localStorage.setItem('counts-list-hidden', n ? '1' : '0'); } catch {} return n; }); }

  useEffect(() => { api('/api/counts').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);

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
      <button type="button" className="btn sm" onClick={toggleList} aria-expanded={!hidden} aria-controls="counts-list" style={{ marginBottom: 6 }}
        title={hidden ? 'Show the list of counts' : 'Hide the list of counts'}>
        {hidden ? `Show counts${items ? ` (${shown.length})` : ''}` : 'Hide counts'}
      </button>
    </div>
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
        return (<Link key={s.id} href={`/counts/${s.id}`} className="card session">
          <div className="session-top"><b>{s.name}</b><Badge tone={STATUS_TONE[s.status] ?? 'mute'}>{STATUS_LABEL[s.status] ?? s.status}</Badge></div>
          <div className="mut small" style={{ marginTop: 4 }}>{s.scope_name ?? 'All inventory'} · started {ago(s.created_at)}</div>
          <div className={'bar' + (pct === 100 ? ' done' : '')} role="progressbar" aria-label={`${s.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
          <div className="session-foot"><span><b>{s.counted.toLocaleString()}</b> of {s.lines.toLocaleString()} counted ({pct}%)</span><span className="go">{s.status === 'open' ? 'Continue' : 'View'}</span></div>
        </Link>);
      })}
    </div>
    </div>

    {/* ───── start a new count ───── */}
    <div className="section-title" id="new-count" style={{ marginTop: 36 }}><h2>Start a new count</h2><span className="mut small">Two quick steps</span></div>
    <div className="split">
      <div>
        <div className="step-label"><span className="step-no">1</span>Choose what to count</div>
        <Tree title="What are you counting?" sel={node} onSel={(id, n, path) => { setNode(id); setNodeName(n); setTrail(path ?? []); }} />
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