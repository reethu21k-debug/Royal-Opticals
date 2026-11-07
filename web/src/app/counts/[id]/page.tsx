'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, num } from '@/components/api';
import { PageHeader, Badge, Ico, Loading, Note, type Tone } from '@/components/ui';
import CountGrid, { type GLine as Line, type Change } from './CountGrid';
import QuickCount from './QuickCount';
import { fmtPower } from '@/lib/power-format';

type Summary = { lines: number; counted: number; differences: number };
type Data = { session: any; canSetTargets?: boolean; summary: Summary; items: Line[]; total: number; page: number; pageSize: number };
type RowState = 'saving' | 'saved' | string;   // string = error message

const FILTERS: [string, string][] = [['all', 'All'], ['uncounted', 'To count'], ['counted', 'Counted'], ['differences', 'Differences']];
const RESULT: Record<string, string> = { posted: 'Stock updated', unchanged: 'No change', stale: 'Skipped — stock moved meanwhile', not_counted: 'Not counted' };
const STATUS_LABEL: Record<string, string> = { open: 'In progress', submitted: 'Waiting for approval', approved: 'Approved', cancelled: 'Cancelled' };
const STATUS_TONE: Record<string, Tone> = { open: 'warn', submitted: 'info', approved: 'ok', cancelled: 'mute' };
const GUIDE: Record<string, string> = {
  open: 'Quick counts one lens at a time (best at the shelf or on a phone). Grid and List show many at once. Every entry saves by itself. Leave a lens blank if you did not count it.',
  submitted: 'Counting is finished and waiting for a manager. Nothing has changed in stock yet.',
  approved: 'This count has been posted to stock.',
  cancelled: 'This count was cancelled. Stock was not changed.' };

export default function Count() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState(''); const [qd, setQd] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [targetState, setTargetState] = useState<Record<string, RowState>>({});   // save state of the targets grid, per lens
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<'quick' | 'grid' | 'list' | 'targets' | null>(null);   // null = Quick while counting, List once counting is closed
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  // List view (explicitly chosen, or shown automatically once counting is closed) uses the right-hand-power-first order. Quick and Grid are unchanged.
  const listOrder = view === 'list' || (view !== 'grid' && view !== 'targets' && !!data && data.session.status !== 'open');

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ page: String(page), pageSize: view === 'list' ? '100' : '200', filter, ...(qd ? { q: qd } : {}), ...(listOrder ? { order: 'list' } : {}), ...(view === 'grid' || view === 'targets' ? { all: '1' } : {}) });
    api<Data>(`/api/counts/${id}?${qs}`).then(d => alive && (setData(d), setErr(''))).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id, page, filter, qd, reload, view, listOrder]);

  const act = useCallback(async (action: string) => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api(`/api/counts/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      setMsg({ submit: 'Submitted for manager approval.', approve: 'Approved and posted to stock.', reopen: 'Reopened — you can keep counting.', cancel: 'Session cancelled.' }[action] ?? 'Done.');
      setReload(t => t + 1);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [id]);

  // keep the counters and the visible rows in step with what was just saved
  function applyLocal(changes: Map<string, number | null>) {
    setData(d => {
      if (!d) return d;
      let counted = d.summary.counted, differences = d.summary.differences;
      const items = d.items.map(x => {
        if (!changes.has(x.variant_id)) return x;
        const v = changes.get(x.variant_id) ?? null;
        const wasC = x.counted_quantity !== null, isC = v !== null;
        const wasD = wasC && x.counted_quantity !== x.recorded_quantity, isD = isC && v !== x.recorded_quantity;
        counted += (isC ? 1 : 0) - (wasC ? 1 : 0); differences += (isD ? 1 : 0) - (wasD ? 1 : 0);
        return { ...x, counted_quantity: v };
      });
      return { ...d, items, summary: { ...d.summary, counted, differences } };
    });
  }

  // ── targets grid (beside the count grid): saved through /api/counts/:id/targets -> set_targets_bulk (history + audit) ──
  function applyTargetLocal(changes: Map<string, number>) {
    setData(d => d ? { ...d, items: d.items.map(x => changes.has(x.variant_id) ? { ...x, target_quantity: changes.get(x.variant_id)!, target_state: 'recorded' } : x) } : d);
  }
  async function saveTargets(changes: Change[]) {
    const todo = changes.filter(c => c.value !== null && c.value !== (c.l.target_quantity ?? null)) as { l: Line; value: number }[];
    if (!todo.length) { setMsg('No target changed.'); return; }
    setErr(''); setMsg('');
    const ids = todo.map(c => c.l.variant_id);
    setTargetState(s => { const n = { ...s }; ids.forEach(i => { n[i] = 'saving'; }); return n; });
    try {
      for (let i = 0; i < todo.length; i += 500)
        await api(`/api/counts/${id}/targets`, { method: 'POST', body: JSON.stringify({ items: todo.slice(i, i + 500).map(c => ({ variantId: c.l.variant_id, target: c.value })) }) });
      applyTargetLocal(new Map(todo.map(c => [c.l.variant_id, c.value] as const)));
      setMsg(`Saved ${todo.length} target${todo.length === 1 ? '' : 's'}.`);
      setTargetState(s => { const n = { ...s }; ids.forEach(i => { n[i] = 'saved'; }); return n; });
      setTimeout(() => setTargetState(s => { const n = { ...s }; ids.forEach(i => { if (n[i] === 'saved') delete n[i]; }); return n; }), 1500);
    } catch (e: any) {
      const m = e.message || 'could not save'; setErr(m);
      setTargetState(s => { const n = { ...s }; ids.forEach(i => { n[i] = ids.length === 1 ? m : 'Not saved'; }); return n; });
    }
  }
  function saveTarget(l: Line, raw: string) {
    const v = Number(raw.trim());
    if (raw.trim() === '' || !Number.isInteger(v) || v < 0 || v > 1_000_000) { setTargetState(s => ({ ...s, [l.variant_id]: 'Whole number, 0 or more' })); return; }
    if (v === (l.target_quantity ?? null)) { setTargetState(s => { const n = { ...s }; delete n[l.variant_id]; return n; }); return; }
    void saveTargets([{ l, value: v }]);
  }

  async function saveMany(changes: Change[]) {
    const todo = changes.filter(c => c.value !== c.l.counted_quantity);
    if (!todo.length) { setMsg('Nothing to change.'); return; }
    setErr(''); setMsg('');
    const ids = todo.map(c => c.l.variant_id);
    setRowState(s => { const n = { ...s }; ids.forEach(i => { n[i] = 'saving'; }); return n; });
    try {
      for (let i = 0; i < todo.length; i += 500)
        await api(`/api/counts/${id}/bulk-lines`, { method: 'POST', body: JSON.stringify({ items: todo.slice(i, i + 500).map(c => ({ variantId: c.l.variant_id, count: c.value })) }) });
      applyLocal(new Map(todo.map(c => [c.l.variant_id, c.value] as const)));
      setMsg(`Saved ${todo.length} line${todo.length === 1 ? '' : 's'}.`);
    } catch (e: any) { setErr(e.message); }
    finally { setRowState(s => { const n = { ...s }; ids.forEach(i => { delete n[i]; }); return n; }); }
  }

  async function save(l: Line, raw: string): Promise<boolean> {
    const text = raw.trim();
    const value = text === '' ? null : Number(text);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000)) { setRowState(s => ({ ...s, [l.variant_id]: 'Whole number, 0 or more' })); return false; }
    if (value === l.counted_quantity) { setRowState(s => { const n = { ...s }; delete n[l.variant_id]; return n; }); return true; }
    setRowState(s => ({ ...s, [l.variant_id]: 'saving' }));
    try {
      await api(`/api/counts/${id}/lines`, { method: 'PUT', body: JSON.stringify({ variantId: l.variant_id, count: value }) });
      applyLocal(new Map([[l.variant_id, value]]));
      setRowState(s => ({ ...s, [l.variant_id]: 'saved' }));
      setTimeout(() => setRowState(s => s[l.variant_id] === 'saved' ? (({ [l.variant_id]: _, ...rest }) => rest)(s) : s), 1500);
      return true;
    } catch (e: any) { setRowState(s => ({ ...s, [l.variant_id]: e.message })); return false; }
  }

  function focusNext(from: HTMLInputElement, dir: 1 | -1) {
    const all: HTMLInputElement[] = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-count]') ?? []);
    const next = all[all.indexOf(from) + dir]; if (next) { next.focus(); next.select(); }
  }

  async function upload(f: File | null) {
    if (!f) return; setErr(''); setMsg('');
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`/api/counts/${id}/import`, { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr((j.error || 'import failed') + (j.errors ? ': ' + j.errors.slice(0, 5).map((x: any) => `row ${x.row} ${x.error}`).join('; ') : ''));
    else { setMsg(`Imported ${j.imported} counts (${j.skippedBlank} blank rows skipped).`); setReload(t => t + 1); }
  }

  if (err && !data) return (<><PageHeader back="/counts" title="Stock count" crumbs={[{ label: 'Stock counts', href: '/counts' }]} /><div className="err" role="alert">{err}</div></>);
  if (!data) return <Loading rows={6} label="Loading count" />;

  const s = data.session, open = s.status === 'open', sum = data.summary;
  const pct = sum.lines ? Math.round((sum.counted / sum.lines) * 100) : 0;
  const remaining = sum.lines - sum.counted;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const mode = view === 'quick' && !open ? 'list' : view ?? (open ? 'quick' : 'list');
  let lastGroup = '';

  return (<>
    <PageHeader back="/counts" crumbs={[{ label: 'Stock counts', href: '/counts' }, { label: s.name }]} title={s.name}
      badge={<Badge tone={STATUS_TONE[s.status] ?? 'mute'}>{STATUS_LABEL[s.status] ?? s.status}</Badge>} sub={GUIDE[s.status]} />

    {/* progress + the one next action stay in view while you scroll */}
    <div className="card count-bar">
      <div className="progress-top">
        <span><b>{pct}% counted</b> <span className="mut">· {sum.counted.toLocaleString()} of {sum.lines.toLocaleString()} lines</span></span>
        <span className="row" style={{ margin: 0 }}>
          {open && <button className="p" disabled={busy || sum.counted === 0} title={sum.counted === 0 ? 'Count at least one line first' : undefined} onClick={() => {
            const m = remaining > 0 ? `${remaining} line(s) are not counted. They will stay unknown (not zero).\n\nSubmit for approval?` : 'Submit for approval?';
            if (confirm(m)) act('submit'); }}>Submit for approval</button>}
          {s.status === 'submitted' && <>
            <button className="p" disabled={busy} onClick={() => { if (confirm('Approve and post these counts to stock? This cannot be undone.')) act('approve'); }}>Approve &amp; post to stock</button>
            <button disabled={busy} onClick={() => act('reopen')}>Reopen for counting</button></>}
        </span>
      </div>
      <div className={'bar big' + (pct === 100 ? ' done' : '')} role="progressbar" aria-label="Count progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ margin: '8px 0 0' }}><i style={{ width: pct + '%' }} /></div>
    </div>

    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
    {open && sum.counted > 0 && remaining > 0 && <Note tone="info" icon="info">{remaining.toLocaleString()} line{remaining === 1 ? '' : 's'} still to count. Lines you skip stay <b>unknown</b>, never zero.</Note>}

    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div className="chips">
        <span className="chip">To count <b>{remaining.toLocaleString()}</b></span>
        <span className="chip">Differences <b className={sum.differences ? 'b-warn' : ''}>{sum.differences.toLocaleString()}</b></span>
        {s.summary && <>
          <span className="chip">Stock updated <b>{s.summary.posted}</b></span>
          <span className="chip">No change <b>{s.summary.unchanged}</b></span>
          {s.summary.stale > 0 && <span className="chip">Skipped (stock moved) <b className="b-warn">{s.summary.stale}</b></span>}
          {s.summary.not_counted > 0 && <span className="chip">Not counted <b>{s.summary.not_counted}</b></span>}
        </>}
      </div>
      <div className="row" style={{ margin: 0 }}>
        <a className="btn sm" href={`/api/counts/${id}/sheet`}><Ico n="download" />Excel sheet</a>
        {open && <label className="btn sm"><Ico n="upload" />Import Excel<input type="file" accept=".xlsx" hidden onChange={e => { upload(e.target.files?.[0] ?? null); e.target.value = ''; }} /></label>}
        {(open || s.status === 'submitted') && <button className="sm danger" disabled={busy} onClick={() => { if (confirm('Cancel this session? Entered counts are kept but never posted.')) act('cancel'); }}>Cancel count</button>}
      </div>
    </div>

    <div className="toolbar">
      <input aria-label="Search lines" type="search" className="search grow" placeholder="Search power, workbook or block…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="tabs compact" role="tablist" aria-label="Show">
        {FILTERS.map(([k, label]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setPage(1); }}>{label}</button>)}
      </div>
      <div className="tabs compact" role="tablist" aria-label="Layout">
        {(open ? [['quick', 'Quick'], ['grid', 'Grid'], ['list', 'List'], ['targets', 'Targets']] as const : [['grid', 'Grid'], ['list', 'List'], ['targets', 'Targets']] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setView(k); setPage(1); }}>{label}</button>)}
      </div>
    </div>

    {mode === 'quick' ? <QuickCount key={`${page}|${filter}|${qd}`} items={data.items} rowState={rowState} hasNextPage={page < pages} onNextPage={() => setPage(page + 1)} onSave={save} onNotice={setMsg} /> :
    mode === 'targets' ? <CountGrid only="targets" items={data.items} open={open} rowState={rowState} onSave={save} onBulk={saveMany} onNotice={setMsg}
      canSetTargets={!!data.canSetTargets} targetRowState={targetState} onSaveTarget={saveTarget} onBulkTargets={saveTargets} /> :
    mode === 'grid' ? <CountGrid items={data.items} open={open} rowState={rowState} onSave={save} onBulk={saveMany} onNotice={setMsg}
      canSetTargets={!!data.canSetTargets} targetRowState={targetState} onSaveTarget={saveTarget} onBulkTargets={saveTargets} /> :
    <div className="wrap" tabIndex={0} role="region" aria-label="Count lines" style={{ maxHeight: 'max(420px, calc(100vh - 230px))' }}>
      <table ref={tableRef} className="counttable">
        <thead><tr><th>Lens</th><th className="n">System stock</th><th className="n">You counted</th><th className="n">Difference</th><th>{open ? '' : 'Result'}</th></tr></thead>
        <tbody>
          {data.items.map(l => {
            const group = `${l.workbook} › ${l.block}`; const head = group !== lastGroup; lastGroup = group;
            const st = rowState[l.variant_id];
            const diff = l.counted_quantity === null ? null : l.recorded_quantity === null ? 'new' : l.counted_quantity - l.recorded_quantity;
            return (<Fragment key={l.variant_id}>
              {head && <tr className="grouprow"><td colSpan={5}>{group}</td></tr>}
              <tr className={l.counted_quantity !== null ? 'done' : ''}>
                <td><code>{fmtPower(l.row_label_source)}</code>{l.col_label_source ? <> × <code>{fmtPower(l.col_label_source)}</code></> : null}</td>
                <td className="n">{num(l.recorded_quantity)}{l.recorded_state !== 'recorded' && <span className={'badge ' + (l.recorded_state === 'unverified' ? 'b-info' : 'b-mute')} style={{ marginLeft: 6 }}>{l.recorded_state === 'unverified' ? 'unverified' : 'not recorded'}</span>}</td>
                <td className="n">{open ? (
                  <span className="entry">
                    <button type="button" className="step" aria-label="Minus one" tabIndex={-1} onClick={() => save(l, String(Math.max(0, (l.counted_quantity ?? l.recorded_quantity ?? 1) - 1)))}>−</button>
                    <input data-count aria-label={`Counted quantity for ${fmtPower(l.row_label_source)} ${fmtPower(l.col_label_source)}`} inputMode="numeric" pattern="[0-9]*" placeholder="—"
                      defaultValue={l.counted_quantity ?? ''} key={`${l.variant_id}-${l.counted_quantity}`} className={typeof st === 'string' && st !== 'saving' && st !== 'saved' ? 'bad' : ''}
                      onFocus={e => e.target.select()} onBlur={e => save(l, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusNext(e.currentTarget, 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusNext(e.currentTarget, -1); } }} />
                    <button type="button" className="step" aria-label="Plus one" tabIndex={-1} onClick={() => save(l, String((l.counted_quantity ?? l.recorded_quantity ?? -1) + 1))}>+</button>
                    {l.recorded_quantity !== null && l.recorded_state === 'recorded' && l.counted_quantity !== l.recorded_quantity &&
                      <button type="button" className="same" tabIndex={-1} title="Shelf matches system stock" onClick={() => save(l, String(l.recorded_quantity))}>✓ same</button>}
                  </span>) : num(l.counted_quantity)}</td>
                <td className={'n ' + (typeof diff === 'number' && diff !== 0 ? (diff < 0 ? 'b-bad' : 'b-warn') : 'mut')}>{diff === null ? '' : diff === 'new' ? 'new' : diff > 0 ? `+${diff}` : diff}</td>
                <td className="small">{open
                  ? (st === 'saving' ? <span className="mut">Saving…</span> : st === 'saved' ? <span className="b-ok">Saved ✓</span> : st ? <span className="b-bad" role="alert">{st}</span> : null)
                  : (l.result ? (RESULT[l.result] ?? l.result) : '')}</td>
              </tr></Fragment>);
          })}
          {data.items.length === 0 && <tr><td colSpan={5} className="mut" style={{ padding: 18, textAlign: 'center' }}>{qd || filter !== 'all' ? 'No lines match this view.' : 'No lines in this session.'}</td></tr>}
        </tbody>
      </table>
    </div>}
    {mode === 'grid' || mode === 'targets'
      ? <div className="pager"><span>{data.total.toLocaleString()} lines · whole grid shown</span></div>
      : <div className="pager">
      <span>Page {page} of {pages} · {data.total.toLocaleString()} lines</span>
      <div className="btns"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button></div>
    </div>
    }

  </>);
}