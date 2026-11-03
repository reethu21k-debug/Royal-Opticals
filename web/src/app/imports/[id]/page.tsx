'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Tree from '@/components/Tree';
import { api } from '@/components/api';
import { PageHeader, StatusPill, Badge, Loading, Note } from '@/components/ui';
import { fmtPower } from '@/lib/power-format';

export default function ImportBatch() {
  const { id } = useParams<{ id: string }>(); const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [parent, setParent] = useState<string | null>(null); const [parentName, setParentName] = useState(''); const [wb, setWb] = useState(''); const [busy, setBusy] = useState(false); const [page, setPage] = useState(1);
  const load = useCallback(() => api(`/api/imports/${id}?page=${page}&pageSize=50`).then(r => { setD(r); setWb(w => w || r.batch.filename); }).catch(e => setErr(e.message)), [id, page]); useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<any>, ok: string) { setErr(''); setMsg(''); setBusy(true); try { await fn(); setMsg(ok); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function newFolder() { const name = prompt('New folder name (stored exactly as typed)'); if (!name) return;
    await run(async () => { const r = await api('/api/catalog', { method: 'POST', body: JSON.stringify({ parentId: parent, name, kind: 'folder' }) }); setParent(r.node.id); setParentName(r.node.source_name); }, 'Folder created and selected.'); }
  if (!d) return err ? <div className="err" role="alert">{err}</div> : <Loading rows={6} />;
  const b = d.batch, s = b.summary ?? {}; const staged = b.status === 'staged';
  const pages = Math.max(1, Math.ceil(b.total_source_records / 50));
  return (<>
    <PageHeader crumbs={[{ label: 'Import Excel', href: '/imports' }, { label: b.filename }]} title={b.filename} badge={<StatusPill kind="import" value={b.status} />}
      sub={staged ? 'This file is staged. Review it below, then choose where it goes and approve.' : undefined} />
    <div className="grid" style={{ marginBottom: 14 }}>
      <div className="card stat"><b>{b.total_source_records}</b><span>grid positions found</span></div>
      <div className="card stat"><b>{s.stats?.blankStock ?? 0}</b><span>blank stock cells (kept as “not recorded”, not zero)</span></div>
      <div className="card stat"><b>{s.stats?.blankTarget ?? 0}</b><span>blank target cells</span></div>
      <div className="card stat"><b>{s.blocks?.length ?? 0}</b><span>blocks (grids)</span></div></div>
    {s.findings?.length > 0 && <section className="card" aria-label="Findings"><h2 className="card-title">Findings that will be queued for review</h2>
      <p className="card-sub">None of these block the import. Each one is saved to Data review for a decision.</p>
      <div className="mini">{s.findings.map((f: any, i: number) => <div key={i} className="m" style={{ justifyContent: 'flex-start', gap: 10, alignItems: 'baseline' }}><StatusPill kind="severity" value={f.severity} /><span><code>{f.code}</code> <span className="mut">· {f.detail}</span></span></div>)}</div>
      {s.findings.some((f: any) => f.code === 'STOCK_SHEET_IDENTICAL_TO_TARGET') && <Note tone="warn" icon="alert">The stock sheet equals the target sheet, so its quantities will import as <b>unverified</b> and need a physical count before any stock movement.</Note>}</section>}
    <section className="card" aria-label="Sheets"><h2 className="card-title">Sheets in this file</h2><div className="wrap" tabIndex={0} role="region" aria-label="Sheets table" style={{ maxHeight: 220, boxShadow: 'none', marginTop: 8 }}><table><thead><tr><th>Sheet</th><th>Layout</th><th className="n">Cells</th><th className="n">Formulas</th><th className="n">Errors</th><th className="n">Blocks</th></tr></thead><tbody>
      {s.sheets?.map((x: any) => <tr key={x.name}><td><code>{x.name}</code></td><td>{x.layout}</td><td className="n">{x.cells}</td><td className="n">{x.formulas}</td><td className="n">{x.errors}</td><td className="n">{x.blocks}</td></tr>)}</tbody></table></div></section>
    {staged && <section className="card" aria-label="Approve and import"><h2 className="card-title">Approve &amp; import</h2><p className="card-sub">Choose where this workbook goes. Names are kept exactly, and existing positions are never overwritten.</p>
      <div className="split"><Tree title="Destination folder" sel={parent} onSel={(pid, n) => { setParent(pid); setParentName(n); }} /><div style={{ display: 'grid', gap: 14 }}>
        <div className="scope"><span className="mut">Destination:</span><b>{parentName || '(top level)'}</b><button className="sm" onClick={newFolder}>New folder here</button></div>
        <label className="field" style={{ maxWidth: 420 }}><span>Workbook name</span><input value={wb} onChange={e => setWb(e.target.value)} /></label>
        <div><button className="p big" disabled={busy || !wb.trim()} onClick={() => { if (confirm('Import this workbook into live inventory?')) run(() => api(`/api/imports/${id}/execute`, { method: 'POST', body: JSON.stringify({ parentNodeId: parent, workbookName: wb }) }), 'Imported.'); }}>Approve &amp; import</button></div></div></div></section>}
    {b.status === 'imported' && <section className="card"><div className="row" style={{ margin: 0 }}><button className="danger" disabled={busy} onClick={() => { const r = prompt('Reason for rolling back this import?'); if (r) run(() => api(`/api/imports/${id}/rollback`, { method: 'POST', body: JSON.stringify({ reason: r }) }), 'Rolled back.'); }}>Roll back import</button><span className="mut">Refused if later stock movements, orders or counts touch these variants.</span></div></section>}
    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
    <div className="section-title"><h2>Records</h2><span className="row" style={{ margin: 0, gap: 6 }}>{d.byStatus.map((x: any) => <Badge key={x.status} tone={x.status === 'imported' ? 'ok' : x.status === 'held' ? 'warn' : ''}>{x.status}: {x.n}</Badge>)}</span></div>
    <div className="wrap" tabIndex={0} role="region" aria-label="Import records"><table><thead><tr><th>Source cells</th><th>Row</th><th>Column</th><th>Target</th><th>Stock</th><th>Status</th><th>Flags</th></tr></thead><tbody>
      {d.records.map((r: any, i: number) => <tr key={i}><td className="mut">{r.source_cell}</td><td><code>{fmtPower(r.row_label)}</code></td><td><code>{fmtPower(r.col_label)}</code></td><td>{r.target_raw ?? '—'}</td><td>{r.stock_raw ?? '—'}</td><td><StatusPill kind="record" value={r.status} />{r.hold_reason && <span className="sub">{r.hold_reason}</span>}</td><td className="mut">{(r.flags ?? []).join(', ')}</td></tr>)}</tbody></table></div>
    <div className="pager"><span>Page {page} of {pages}</span><div className="btns"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button><button disabled={page * 50 >= b.total_source_records} onClick={() => setPage(page + 1)}>Next →</button></div></div>
  </>);
}