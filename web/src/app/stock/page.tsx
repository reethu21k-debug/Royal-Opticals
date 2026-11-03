'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Tree from '@/components/Tree';
import { useList, Pager } from '@/components/useInventory';
import { api, num, signed, ago, STATUS, STATUS_ORDER } from '@/components/api';
import { PageHeader, Badge, Ico, type Tone } from '@/components/ui';
import { fmtPower } from '@/lib/power-format';

type Mode = 'receive' | 'issue' | 'count';

const MODES: { key: Mode; title: string; hint: string; verb: string }[] = [
  { key: 'receive', title: 'Receive', hint: 'Stock arriving from a supplier', verb: 'Receive' },
  { key: 'issue', title: 'Issue', hint: 'Stock leaving: sale, damage, return', verb: 'Issue' },
  { key: 'count', title: 'Adjust', hint: 'Set stock from a physical count', verb: 'Set count' },
];

// Same tones the movements page uses: received = green, issued = amber, adjusted = blue.
const DONE: Record<Mode, { label: string; tone: Tone }> = {
  receive: { label: 'Received', tone: 'ok' },
  issue: { label: 'Issued', tone: 'warn' },
  count: { label: 'Set count', tone: 'info' },
};

const POWERS: { label: string; min: string; max: string }[] = [
  { label: 'SPH', min: 'sphMin', max: 'sphMax' },
  { label: 'CYL', min: 'cylMin', max: 'cylMax' },
  { label: 'ADD', min: 'addMin', max: 'addMax' },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]]));

const PAGE_SIZE = 40;
const SESSION_KEY = 'ro-stock-entry-session-v1';

/** One saved stock entry, kept in this browser tab so the user can see what they have already done. */
type Entry = { id: string; variantId: string; row: string; col: string; workbook: string; block: string; mode: Mode; qty: number; before: number | null; after: number | null; at: number };
const shortOf = (e: Entry) => (e.mode === 'receive' ? `+${e.qty}` : e.mode === 'issue' ? `−${e.qty}` : `set ${e.qty}`);
const labelOf = (row?: string | null, col?: string | null) => `${row == null ? '—' : fmtPower(row)}${col ? ` × ${fmtPower(col)}` : ''}`;

const Search = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

function statusOf(r: any): [string, string] {
  return STATUS[r?.stock_status] ?? ['Unknown', ''];
}

// How full the shelf is relative to its target (same rule as the inventory table).
function fill(r: any): { pct: number; tone: string } | null {
  if (r.available_quantity === null || r.available_quantity === undefined || !(r.target_quantity > 0)) return null;
  const tone = r.stock_status === 'out_of_stock' ? 'bad' : r.stock_status === 'below_target' ? 'warn' : r.stock_status === 'unverified' ? 'info' : '';
  return { pct: Math.max(0, Math.min(100, Math.round((r.available_quantity / r.target_quantity) * 100))), tone };
}

// Highlights the part of a label that matches the search box.
function Hl({ text, q }: { text: string; q: string }) {
  const t = q.trim(); const i = t ? text.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
}

export default function StockEntry() {
  const [mode, setMode] = useState<Mode>('receive');
  const [pick, setPick] = useState<any>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);

  // finder: search, group, status, power range, page
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [node, setNode] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState('');
  const [status, setStatus] = useState('');
  const [r, setR] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  // what has been saved in this session, and the freshest numbers for lenses we just changed
  const [log, setLog] = useState<Entry[]>([]);
  const [live, setLive] = useState<Record<string, any>>({});
  const [showAll, setShowAll] = useState(false);

  const { data, err: listErr, loading } = useList('/api/inventory', { nodeId: node, q: dq, status, page, pageSize: PAGE_SIZE, ...r });

  // debounce search so we don't hit the API on every keystroke
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);

  // deep link: /stock?variantId=<id> opens that lens directly
  useEffect(() => {
    const vid = new URLSearchParams(window.location.search).get('variantId');
    if (vid) api(`/api/inventory/${vid}`).then(x => setPick({ ...x.variant, workbook: x.variant.path, block: '' })).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { api('/api/settings').then(s => setReasons(s.issueReasons)).catch(() => undefined); }, []);

  // session log survives a refresh of this tab
  useEffect(() => { try { const s = sessionStorage.getItem(SESSION_KEY); if (s) setLog(JSON.parse(s)); } catch { /* storage unavailable: start empty */ } }, []);
  function saveLog(next: Entry[]) { setLog(next); try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* ignore */ } }

  // a fresh page of results is the server's truth, so drop our local overlay
  useEffect(() => { setLive({}); }, [data]);

  const cfg = MODES.find(m => m.key === mode)!;
  const issueNeedsList = mode === 'issue' && reasons !== null;
  const hasStock = pick && pick.available_quantity !== null && pick.available_quantity !== undefined;
  const current: number = hasStock ? Number(pick.available_quantity) : 0;
  const n = qty === '' ? NaN : Number(qty);
  const validNum = Number.isInteger(n) && n >= 0;

  // live preview of what posting will do
  let next: number | null = null; let delta = 0;
  if (validNum) {
    if (mode === 'receive') { delta = n; next = current + n; }
    else if (mode === 'issue') { delta = -n; next = current - n; }
    else { delta = n - current; next = n; }
  }
  const overIssue = mode === 'issue' && validNum && hasStock && n > current;
  const reasonMissing = (mode === 'count' || issueNeedsList) && !reason.trim();
  const qtyInvalid = !validNum || (mode !== 'count' && n === 0);
  const canPost = !!pick && !busy && !qtyInvalid && !overIssue && !reasonMissing;

  function reset() { setErr(''); setMsg(''); }
  function chooseMode(m: Mode) { setMode(m); setQty(''); setReason(''); reset(); }
  function choose(row: any) {
    setPick(row); setQty(''); reset();
    // on narrow screens the entry panel sits below the list: bring it into view
    if (window.matchMedia('(max-width: 960px)').matches) entryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => qtyRef.current?.focus(), 0);
  }
  function bump(by: number) { setQty(String(Math.max(0, (validNum ? n : 0) + by))); reset(); }

  async function submit() {
    if (!canPost) return;
    reset(); setBusy(true);
    try {
      const body: any = { variantId: pick.variant_id, idempotencyKey: crypto.randomUUID(), reason: reason || undefined };
      if (mode === 'count') await api('/api/stock/count', { method: 'POST', body: JSON.stringify({ ...body, count: n, reason }) });
      else await api(`/api/stock/${mode}`, { method: 'POST', body: JSON.stringify({ ...body, quantity: n }) });
      const res = await api(`/api/inventory/${pick.variant_id}`);
      setPick({ ...pick, ...res.variant });
      const v = res.variant;
      setLive(l => ({ ...l, [pick.variant_id]: { available_quantity: v.available_quantity, available_state: v.available_state, stock_status: v.stock_status, target_quantity: v.target_quantity, target_state: v.target_state } }));
      saveLog([{ id: crypto.randomUUID(), variantId: pick.variant_id, row: pick.row_label_source ?? '', col: pick.col_label_source ?? '', workbook: pick.workbook ?? '', block: pick.block ?? '',
        mode, qty: n, before: hasStock ? current : null, after: v.available_quantity ?? null, at: Date.now() }, ...log].slice(0, 200));
      setMsg(mode === 'count' ? `Stock set to ${num(n)}.` : `${mode === 'receive' ? 'Received' : 'Issued'} ${num(n)}. New available: ${num(next)}.`);
      setQty(''); setReason('');
      qtyRef.current?.focus();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  /* ───── finder: filters, chips, grouping ───── */
  const powerCount = POWERS.filter(p => r[p.min] || r[p.max]).length;
  const filterCount = (node ? 1 : 0) + powerCount;
  const hasFilters = !!(node || dq || status || powerCount);
  function setPower(k: string, v: string) { setR({ ...r, [k]: v }); setPage(1); }
  function clearAll() { setNode(null); setNodeName(''); setQ(''); setDq(''); setStatus(''); setR({}); setPage(1); }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (node) chips.push({ key: 'node', label: nodeName || 'Selected group', clear: () => { setNode(null); setNodeName(''); setPage(1); } });
  if (dq) chips.push({ key: 'q', label: `“${dq}”`, clear: () => { setQ(''); setDq(''); setPage(1); } });
  if (status) chips.push({ key: 'status', label: STATUS_LABEL[status] ?? status, clear: () => { setStatus(''); setPage(1); } });
  POWERS.forEach(p => {
    const lo = r[p.min], hi = r[p.max];
    if (lo || hi) chips.push({ key: p.label, label: `${p.label} ${lo || '…'} to ${hi || '…'}`, clear: () => { setR({ ...r, [p.min]: '', [p.max]: '' }); setPage(1); } });
  });

  // overlay the numbers we just saved, then group by workbook › block (the list arrives in source order)
  const rows: any[] = useMemo(() => (data?.items ?? []).map((x: any) => (live[x.variant_id] ? { ...x, ...live[x.variant_id] } : x)), [data, live]);
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; workbook: string; block: string; axes: string; items: any[] }>();
    for (const x of rows) {
      const key = `${x.workbook}\u0001${x.block}`;
      if (!m.has(key)) m.set(key, { key, workbook: x.workbook, block: x.block, axes: x.row_axis_name && x.col_axis_name ? `${x.row_axis_name} × ${x.col_axis_name}` : (x.row_axis_name ?? ''), items: [] });
      m.get(key)!.items.push(x);
    }
    return Array.from(m.values());
  }, [rows]);
  const allClosed = groups.length > 0 && groups.every(g => closed[g.key]);

  const byLens = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of log) { const a = m.get(e.variantId); if (a) a.push(e); else m.set(e.variantId, [e]); }
    return m;
  }, [log]);

  const idx = pick ? rows.findIndex(x => x.variant_id === pick.variant_id) : -1;
  const nextRow = idx >= 0 ? rows[idx + 1] : undefined;

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const els = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-lens]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    els[Math.max(0, Math.min(els.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }

  async function reopen(e: Entry) {
    try {
      const x = await api(`/api/inventory/${e.variantId}`);
      choose({ ...x.variant, workbook: e.workbook || x.variant.path, block: e.block });
    } catch (er: any) { setErr(er.message); }
  }

  const sum = useMemo(() => ({
    received: log.filter(e => e.mode === 'receive').reduce((s, e) => s + e.qty, 0),
    issued: log.filter(e => e.mode === 'issue').reduce((s, e) => s + e.qty, 0),
    counted: log.filter(e => e.mode === 'count').length,
    lenses: byLens.size,
  }), [log, byLens]);

  const [stLabel, stClass] = statusOf(pick);
  const shownLog = showAll ? log : log.slice(0, 6);

  return (
    <>
      <PageHeader title="Stock entry" sub="Pick what happened, find the lens, enter the quantity." />

      <div className="modes" role="tablist" aria-label="Stock action">
        {MODES.map(m => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => chooseMode(m.key)}>
            <b>{m.title}</b><small>{m.hint}</small>
          </button>
        ))}
      </div>

      <div className="split wide">
        {/* ───── left: find a lens ───── */}
        <div className="card stock-find">
          <div className="find-head">
            <h2>Find a lens</h2>
            {data && <span className="find-count" aria-live="polite">{data.total.toLocaleString()} {data.total === 1 ? 'lens' : 'lenses'}</span>}
          </div>

          <div className="searchbox">
            <input
              ref={searchRef}
              type="search"
              aria-label="Find a lens"
              placeholder="Label, workbook or power…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('button[data-lens]')?.focus(); } }}
            />
          </div>

          <div className="pills" role="group" aria-label="Stock status">
            <button type="button" aria-pressed={status === ''} onClick={() => { setStatus(''); setPage(1); }}>All</button>
            {STATUS_ORDER.map(k => (
              <button type="button" key={k} aria-pressed={status === k} onClick={() => { setStatus(status === k ? '' : k); setPage(1); }}>
                <span className={'dot ' + STATUS[k][1]} aria-hidden="true" />{STATUS[k][0]}
              </button>
            ))}
          </div>

          <details className="fold stock-fold">
            <summary>
              <span>Group and power{filterCount > 0 && <span className="badge b-acc" style={{ marginLeft: 8 }}>{filterCount} set</span>}</span>
            </summary>
            <div style={{ display: 'grid', gap: 14 }}>
              <Tree sel={node} onSel={(id, name) => { setNode(id); setNodeName(name); setPage(1); }} title="Browse by group" />
              <div>
                <div className="power" role="group" aria-label="Power filters">
                  {POWERS.map(p => (
                    <div key={p.label} className="field">
                      <span>{p.label}</span>
                      <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
                        <input inputMode="decimal" aria-label={`${p.label} from`} placeholder="from" value={r[p.min] ?? ''} onChange={e => setPower(p.min, e.target.value)} style={{ width: 70 }} />
                        <span className="mut">to</span>
                        <input inputMode="decimal" aria-label={`${p.label} to`} placeholder="to" value={r[p.max] ?? ''} onChange={e => setPower(p.max, e.target.value)} style={{ width: 70 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint mut small" style={{ margin: '8px 0 0' }}>Lenses without that power are left out when a range is set.</p>
              </div>
            </div>
          </details>

          {chips.length > 0 && (
            <div className="row" role="group" aria-label="Active filters" style={{ margin: 0 }}>
              {chips.map(c => (
                <span key={c.key} className="chip-filter">{c.label}
                  <button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear}>×</button>
                </span>
              ))}
              {hasFilters && <button type="button" className="link" onClick={clearAll}>Clear all</button>}
            </div>
          )}

          {listErr && <div className="err" role="alert" style={{ margin: 0 }}>{listErr}</div>}

          {!data && !listErr ? (
            <div className="tree-skel" role="status" aria-label="Loading lenses">{[0, 1, 2, 3].map(i => <i key={i} className="skeleton" style={{ height: 52, opacity: 1 - i * 0.15 }} />)}</div>
          ) : data && rows.length === 0 ? (
            <div className="panel-empty">
              <Search /><b>No lenses found</b>
              <span>Try a different label, workbook or power{hasFilters ? ', or clear the filters' : ''}.</span>
              {hasFilters && <button type="button" onClick={clearAll}>Clear all filters</button>}
            </div>
          ) : data && (
            <>
              <div className="list-tools">
                <span className="mut small">{groups.length} {groups.length === 1 ? 'group' : 'groups'} on this page{loading ? ' · updating…' : ''}</span>
                {groups.length > 1 && (
                  <button type="button" className="link" onClick={() => setClosed(Object.fromEntries(groups.map(g => [g.key, !allClosed])))}>
                    {allClosed ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
              </div>

              <div className="lens-groups" ref={listRef} onKeyDown={onListKey} style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }} aria-label="Search results">
                {groups.map((g, gi) => {
                  const shut = !!closed[g.key];
                  const touchedIn = g.items.filter(x => byLens.has(x.variant_id)).length;
                  const sub = [g.block, g.axes].filter(Boolean).join(' · ');
                  return (
                    <section key={g.key} className="lgrp" data-closed={shut ? '' : undefined}>
                      <button type="button" className="lgrp-head" aria-expanded={!shut} aria-controls={`lgrp-${gi}`} onClick={() => setClosed({ ...closed, [g.key]: !shut })}>
                        <Ico n="chevron" />
                        <span className="lgrp-title">
                          <b title={g.workbook}><Hl text={g.workbook} q={dq} /></b>
                          {sub && <small>{sub}</small>}
                        </span>
                        {touchedIn > 0 && <span className="lgrp-done" title="Lenses you have already entered in this group">{touchedIn} entered</span>}
                        <span className="lgrp-n" aria-label={`${g.items.length} lenses`}>{g.items.length}</span>
                      </button>
                      {!shut && (
                        <ul id={`lgrp-${gi}`} aria-label={`${g.workbook}${g.block ? ', ' + g.block : ''}`}>
                          {g.items.map((x: any) => {
                            const [stText, stCls] = statusOf(x); const f = fill(x); const done = byLens.get(x.variant_id);
                            const detail = done?.map(e => `${DONE[e.mode].label} ${shortOf(e)} · ${ago(new Date(e.at))}`).join('\n');
                            return (
                              <li key={x.variant_id}>
                                <button type="button" data-lens className={'lrow' + (pick?.variant_id === x.variant_id ? ' on' : '')} aria-pressed={pick?.variant_id === x.variant_id} onClick={() => choose(x)}>
                                  <span className={'dot ' + stCls} aria-hidden="true" />
                                  <span className="meta">
                                    <code><Hl text={labelOf(x.row_label_source, x.col_label_source)} q={dq} />
                                      {x.row_occurrence > 0 && <span className="dup" title="Duplicate row label in the source grid"> #{x.row_occurrence + 1}</span>}
                                    </code>
                                    {x.stock_status !== 'ok' && <small className={stCls}>{stText}</small>}
                                  </span>
                                  {done && <span className="touched" title={detail}><Ico n="check" />{done.length > 1 ? `${done.length} entries` : shortOf(done[0])}</span>}
                                  <span className="stockcell" title="Available / target">
                                    <span className="nums"><b>{num(x.available_quantity)}</b>{x.target_quantity > 0 && <span className="of"> / {num(x.target_quantity)}</span>}</span>
                                    {f && <span className={'meter ' + f.tone} aria-hidden="true"><i style={{ width: f.pct + '%' }} /></span>}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
              <Pager d={data} page={page} setPage={p => { setPage(p); listRef.current?.scrollTo({ top: 0 }); }} />
            </>
          )}
        </div>

        {/* ───── right: entry panel + what you've entered ───── */}
        <div className="stock-side">
          <div className="card" ref={entryRef}>
            {!pick ? (
              <div className="panel-empty">
                <Search />
                <b>No lens selected</b>
                <span>Choose a lens from the list to {cfg.title.toLowerCase()} stock.</span>
              </div>
            ) : (
              <>
                <div className="pick-head">
                  <div>
                    <h2><code>{fmtPower(pick.row_label_source)}</code>{pick.col_label_source && <> × <code>{fmtPower(pick.col_label_source)}</code></>}</h2>
                    <div className="path">{pick.workbook}{pick.block ? ` · ${pick.block}` : ''}</div>
                  </div>
                  <span className={'badge ' + stClass}>{stLabel}</span>
                </div>

                <div className="kpis">
                  <div className="kpi"><b>{num(pick.available_quantity)}</b><span>Available{pick.available_state ? ` (${pick.available_state})` : ''}</span></div>
                  <div className="kpi"><b>{num(pick.target_quantity)}</b><span>Target</span></div>
                </div>

                {mode !== 'count' && !hasStock && (
                  <div className="note warn" role="note" style={{ marginTop: 14 }}>
                    Stock isn’t recorded for this lens yet. Switch to “Adjust” to set the first value.
                  </div>
                )}

                <div className="qty-line">
                  <div className="field">
                    <span>{mode === 'count' ? 'Physical count' : 'Quantity'}</span>
                    <div className="qty-big">
                      <button type="button" aria-label="Decrease" onClick={() => bump(-1)} disabled={!validNum || n <= 0}>−</button>
                      <input
                        ref={qtyRef}
                        inputMode="numeric"
                        aria-label={mode === 'count' ? 'Physical count' : 'Quantity'}
                        placeholder="0"
                        value={qty}
                        onChange={e => { setQty(e.target.value.replace(/\D/g, '')); reset(); }}
                        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                      />
                      <button type="button" aria-label="Increase" onClick={() => bump(1)}>+</button>
                    </div>
                  </div>
                  {mode !== 'count' && (
                    <div className="quick" aria-label="Quick add">
                      {[5, 10, 25].map(v => <button type="button" key={v} onClick={() => bump(v)}>+{v}</button>)}
                    </div>
                  )}
                </div>

                {validNum && next !== null && (
                  overIssue ? (
                    <div className="result bad" role="alert">Only {num(current)} available. You can’t issue {num(n)}.</div>
                  ) : (
                    <div className="result" aria-live="polite">
                      <span>{hasStock ? num(current) : '—'}</span><span aria-hidden="true">→</span><b>{num(next)}</b>
                      <span className="mut">
                        {mode === 'count' ? (hasStock ? `(${delta > 0 ? '+' : ''}${delta} adjustment)` : '(first count)') : `(${delta > 0 ? '+' : ''}${delta})`}
                      </span>
                    </div>
                  )
                )}

                <div className="action-bar">
                  <label className="field">
                    <span>Reason{mode === 'count' || issueNeedsList ? ' (required)' : ' (optional)'}</span>
                    {issueNeedsList ? (
                      <select value={reason} onChange={e => setReason(e.target.value)}>
                        <option value="">Select a reason…</option>
                        {reasons!.map(x => <option key={x}>{x}</option>)}
                      </select>
                    ) : (
                      <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                        placeholder={mode === 'count' ? 'e.g. monthly stock take' : 'e.g. PO number'}
                      />
                    )}
                  </label>
                  <button className="p big" disabled={!canPost} onClick={submit}>
                    {busy ? 'Saving…' : validNum && n > 0 || (mode === 'count' && validNum) ? `${cfg.verb} ${num(n)}` : cfg.verb}
                  </button>
                </div>

                {err && <div className="err" role="alert">{err}</div>}
                {msg && (
                  <div className="okmsg ok-row" role="status">
                    <span>{msg}</span>
                    {nextRow && <button type="button" className="sm" onClick={() => choose(nextRow)}>Next lens <Ico n="chevron" className="ic" /></button>}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card sess">
            <div className="find-head">
              <h2>Entered this session</h2>
              {log.length > 0 && (
                <button type="button" className="link" onClick={() => { if (confirm('Clear this list? Stock that is already saved is not affected.')) saveLog([]); }}>Clear list</button>
              )}
            </div>
            {log.length === 0 ? (
              <p className="mut small" style={{ margin: '4px 0 0' }}>Nothing yet. Each lens you save appears here so you can check what is done.</p>
            ) : (
              <>
                <div className="sess-sum" aria-label="Session totals">
                  <span><b>{sum.lenses}</b> {sum.lenses === 1 ? 'lens' : 'lenses'}</span>
                  {sum.received > 0 && <span className="t-ok">Received <b>+{sum.received}</b></span>}
                  {sum.issued > 0 && <span className="t-warn">Issued <b>−{sum.issued}</b></span>}
                  {sum.counted > 0 && <span className="t-info">Counted <b>{sum.counted}</b></span>}
                </div>
                <ul className="sess-list">
                  {shownLog.map(e => (
                    <li key={e.id}>
                      <button type="button" className="lrow" onClick={() => reopen(e)} title="Open this lens again">
                        <span className="meta">
                          <code>{labelOf(e.row, e.col)}</code>
                          <small>{e.workbook}{e.block ? ` › ${e.block}` : ''}</small>
                        </span>
                        <span className="sess-num">
                          <span><Badge tone={DONE[e.mode].tone}>{DONE[e.mode].label} {e.mode === 'count' ? e.qty : signed(e.mode === 'issue' ? -e.qty : e.qty)}</Badge></span>
                          <small>{e.before === null ? '—' : e.before} → <b>{num(e.after)}</b> · {ago(new Date(e.at))}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {log.length > 6 && <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${log.length}`}</button>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}