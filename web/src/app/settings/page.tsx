'use client';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { PageHeader, Loading, Note } from '@/components/ui';

export default function Settings() {
  const [d, setD] = useState<any>(null); const [reasons, setReasons] = useState(''); const [net, setNet] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { api('/api/settings').then(r => { setD(r); setReasons((r.issueReasons ?? r.issueReasonsSuggested).join('\n')); setNet(r.netReplenishmentEnabled); }).catch(e => setErr(e.message)); }, []);
  async function save(body: object) { setErr(''); setMsg(''); try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) }); setMsg('Saved.'); } catch (e: any) { setErr(e.message); } }
  if (!d) return err ? <div className="err" role="alert">{err}</div> : <Loading rows={4} />;
  const list = reasons.split('\n').map(x => x.trim()).filter(Boolean);
  return (<>
    <PageHeader title="Settings" sub="Only administrators can change settings. Every change is audited." />
    <section className="card" aria-label="Stock issue reasons">
      <h2 className="card-title">Stock issue reasons</h2>
      <p className="card-sub">{d.issueReasons ? 'Issues must use one of these reasons.' : 'Not set up yet: issues currently accept any text. Saving a list makes the reason required and limits it to the list.'}</p>
      <label className="field" style={{ maxWidth: 360 }}>
        <span>One reason per line</span>
        <textarea aria-label="Issue reasons" rows={7} value={reasons} onChange={e => setReasons(e.target.value)} />
        <span className="hint">{list.length} {list.length === 1 ? 'reason' : 'reasons'}</span>
      </label>
      <div className="row" style={{ marginTop: 12 }}><button className="p" disabled={list.length === 0} onClick={() => save({ issueReasons: list })}>Save reasons</button></div>
    </section>
    <section className="card" aria-label="Net replenishment">
      <h2 className="card-title">Net replenishment <span className="mut" style={{ fontWeight: 400 }}>(optional)</span></h2>
      <p className="card-sub">When on, Suggested orders can show an extra column that also subtracts quantities already on open purchase orders. The original rule, target minus available (never below 0), is not replaced.</p>
      <label className="check"><input type="checkbox" checked={net} onChange={e => { setNet(e.target.checked); save({ netReplenishmentEnabled: e.target.checked }); }} /> <span>Enable net replenishment view</span></label>
    </section>
    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
  </>);
}
