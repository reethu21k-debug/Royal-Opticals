'use client';
import { useEffect, useRef, useState } from 'react';
import Tree from '@/components/Tree';
import { api } from '@/components/api';
import { PageHeader, Note } from '@/components/ui';

// Confirmation required before a folder is archived: the signed-in user types their own email address twice. Checked again on the server.
function ArchiveDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: (e1: string, e2: string) => Promise<void> }) {
  const [e1, setE1] = useState(''); const [e2, setE2] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !busy) onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onCancel]);
  const valid = /^\S+@\S+\.\S+$/.test(e1.trim()) && e1.trim().toLowerCase() === e2.trim().toLowerCase();
  async function go() { setErr(''); setBusy(true); try { await onConfirm(e1.trim(), e2.trim()); } catch (e: any) { setErr(e.message); setBusy(false); } }
  return (
    <div role="presentation" onMouseDown={ev => { if (ev.target === ev.currentTarget && !busy) onCancel(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,40,.45)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}>
      <form role="dialog" aria-modal="true" aria-labelledby="arch-title" className="card" onSubmit={e => { e.preventDefault(); if (valid && !busy) go(); }}
        style={{ width: 'min(520px, 100%)', display: 'grid', gap: 14, maxHeight: '92vh', overflow: 'auto' }}>
        <h2 id="arch-title" className="card-title" style={{ margin: 0 }}>Delete “{name}”?</h2>
        <p className="card-sub" style={{ margin: 0 }}>The folder will disappear from every list. Stock history is kept. To confirm, type the email address you are signed in with, twice.</p>
        <label className="field"><span>Your email address</span>
          <input ref={first} type="email" autoComplete="off" inputMode="email" aria-label="Your email address" placeholder="you@example.com" value={e1} onChange={ev => setE1(ev.target.value)} /></label>
        <label className="field"><span>Type your email address again</span>
          <input type="email" autoComplete="off" inputMode="email" aria-label="Your email address again" placeholder="you@example.com" value={e2} onChange={ev => setE2(ev.target.value)} onPaste={undefined} /></label>
        {e2 && !valid && <div className="hint mut small" role="status">The two addresses must be the same.</div>}
        <Note tone="warn" icon="alert"><b>Need assistance?</b> We recommend consulting your agency, Stryvenix Agency, at <a href="mailto:contact@stryvenix.com">contact@stryvenix.com</a> before proceeding.</Note>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', margin: 0 }}>
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="danger" disabled={!valid || busy}>{busy ? 'Deleting…' : 'Delete Anyway'}</button>
        </div>
      </form>
    </div>
  );
}

export default function CatalogAdmin() {
  const [node, setNode] = useState<string | null>(null); const [name, setName] = useState(''); const [label, setLabel] = useState(''); const [child, setChild] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [rev, setRev] = useState(0); const [confirming, setConfirming] = useState(false);
  async function run(fn: () => Promise<any>, ok: string) { setErr(''); setMsg(''); try { await fn(); setMsg(ok); setRev(r => r + 1); } catch (e: any) { setErr(e.message); } }
  return (<>
    <PageHeader title="Categories and folders" sub={<>Rename any folder, file or grid at any level with the pencil — the new name shows everywhere in the app. You can also add folders, add a <b>display label</b>, or archive one. The original imported name is always kept, so you can restore it.</>} />
    <div className="split"><Tree key={rev} title="Folders" editable sel={node} onSel={(id, n) => { setNode(id); setName(n); setLabel(''); }} onRenamed={(id, n) => { if (id === node) setName(n); setMsg(`Renamed to “${n}”. It now shows across the app.`); setErr(''); }} />
      <div>
        <section className="card" aria-label="Add a folder">
          <h2 className="card-title">Add a folder{node ? <> inside “{name}”</> : ' at the top level'}</h2>
          <p className="card-sub">{node ? 'Pick a different group on the left to add it somewhere else.' : 'Pick a group on the left to add inside it.'}</p>
          <div className="row"><input aria-label="New folder name" placeholder="Folder name, typed exactly" value={child} onChange={e => setChild(e.target.value)} className="grow" />
            <button className="p" disabled={!child.trim()} onClick={() => run(async () => { await api('/api/catalog', { method: 'POST', body: JSON.stringify({ parentId: node, name: child, kind: 'folder' }) }); setChild(''); }, 'Folder created.')}>Add folder here</button></div>
        </section>
        {node && <section className="card" aria-label="Selected folder">
          <h2 className="card-title">{name}</h2>
          <p className="card-sub">Changes here affect only this folder.</p>
          <div className="row"><input aria-label="Display label" placeholder="Display label (optional)" value={label} onChange={e => setLabel(e.target.value)} className="grow" /><button onClick={() => run(() => api(`/api/catalog/${node}`, { method: 'PATCH', body: JSON.stringify({ displayLabel: label || null }) }), 'Label saved.')}>Save label</button></div>
          <Note tone="warn" icon="alert">Archiving hides this folder from every list. Stock history is kept.</Note>
          <button className="danger" onClick={() => setConfirming(true)}>Archive this folder</button>
        </section>}
        {confirming && node && <ArchiveDialog name={name} onCancel={() => setConfirming(false)}
          onConfirm={async (e1, e2) => { await api(`/api/catalog/${node}`, { method: 'PATCH', body: JSON.stringify({ isActive: false, confirmEmail: e1, confirmEmail2: e2 }) }); setConfirming(false); setNode(null); setErr(''); setMsg('Folder deleted (archived). Stock history is kept.'); setRev(r => r + 1); }} />}
        {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
      </div></div>
  </>);
}