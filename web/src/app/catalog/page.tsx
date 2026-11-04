'use client';
import { useState } from 'react';
import Tree from '@/components/Tree';
import { api } from '@/components/api';
import { PageHeader, Note } from '@/components/ui';

export default function CatalogAdmin() {
  const [node, setNode] = useState<string | null>(null); const [name, setName] = useState(''); const [label, setLabel] = useState(''); const [child, setChild] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [rev, setRev] = useState(0);
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
          <button className="danger" onClick={() => { if (confirm(`Archive “${name}”? It will disappear from the tree; stock history is kept.`)) run(async () => { await api(`/api/catalog/${node}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }); setNode(null); }, 'Archived.'); }}>Archive this folder</button>
        </section>}
        {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
      </div></div>
  </>);
}