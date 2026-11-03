'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmtDateTime } from '@/components/api';
import { PageHeader, StatusPill, Ico, Loading, EmptyState } from '@/components/ui';

export default function Imports() {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api('/api/imports').then(r => setItems(r.items)).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  async function upload(f: File | null) {
    if (!f) return; setErr(''); setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/imports', { method: 'POST', body: fd }); const j = await r.json();
      if (!r.ok) throw new Error(j.error + (j.sheets ? ` (sheets found: ${j.sheets.join(', ')})` : '')); window.location.href = `/imports/${j.batch.id}`; }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (<>
    <PageHeader title="Import Excel" sub={<>Upload an inventory workbook with the sheets <code>LENS QUANTITY</code>, <code>STOCK LENS</code> and <code>ORDER LENS</code>. Uploading only <b>stages</b> it: nothing touches live stock until a manager reviews the preview and approves. A file that was already imported is rejected, so stock can never be doubled.</>} />
    <label className={'drop' + (busy ? ' busy' : '')}>
      <Ico n="upload" /><b>{busy ? 'Reading workbook…' : 'Choose a workbook to upload'}</b><span>Excel (.xlsx) · you’ll review a preview before anything is imported</span>
      <input type="file" accept=".xlsx" aria-label="Workbook (.xlsx)" disabled={busy} onChange={e => upload(e.target.files?.[0] ?? null)} />
    </label>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="section-title"><h2>Import history</h2></div>
    {!items && !err && <Loading rows={3} />}
    {items && (items.length === 0 ? <EmptyState icon="upload" title="No imports yet">Upload your first workbook above.</EmptyState>
      : <div className="wrap" tabIndex={0} role="region" aria-label="Import history"><table><thead><tr><th>File</th><th>Status</th><th className="n">Positions</th><th className="n">Imported</th><th className="n">Held</th><th>Uploaded</th></tr></thead><tbody>
        {items.map(b => <tr key={b.id}><td><Link className="rowlink" href={`/imports/${b.id}`}>{b.filename}</Link></td><td><StatusPill kind="import" value={b.status} /></td><td className="n">{b.total_source_records}</td><td className="n">{b.imported_records ?? ''}</td><td className="n">{b.held_records ?? ''}</td><td className="mut">{fmtDateTime(b.created_at)}</td></tr>)}
      </tbody></table></div>)}
  </>);
}
