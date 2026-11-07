'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, num, STATUS, signed, fmtDateTime } from '@/components/api';
import { PageHeader, Badge, Lens, Loading, StatusPill } from '@/components/ui';


export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // suppliers
  const [sup, setSup] = useState<any>(null);
  const [allSup, setAllSup] = useState<any[]>([]);
  const [sid, setSid] = useState('');
  const [pref, setPref] = useState(false);
  const [scode, setScode] = useState('');
  const [supErr, setSupErr] = useState('');

  // stock actions
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [count, setCount] = useState('');
  const [target, setTarget] = useState('');

  const load = useCallback(() => api(`/api/inventory/${id}`).then(setD).catch(e => setErr(e.message)), [id]);
  const loadSup = useCallback(() => api(`/api/product-suppliers?variantId=${id}`).then(setSup).catch(() => undefined), [id]);
  useEffect(() => {
    load(); loadSup();
    api('/api/suppliers').then(r => setAllSup(r.items.filter((x: any) => x.is_active))).catch(() => undefined);
  }, [load, loadSup]);

  async function act(path: string, body: object, done: string, after: () => void) {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ variantId: id, idempotencyKey: crypto.randomUUID(), ...body }) });
      setMsg(done); after(); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function linkSupplier() {
    setSupErr('');
    try {
      await api('/api/product-suppliers', { method: 'POST', body: JSON.stringify({ variantId: id, supplierId: sid, preferred: pref, supplierProductCode: scode || undefined }) });
      setSid(''); setScode(''); setPref(false); loadSup();
    } catch (e: any) { setSupErr(e.message); }
  }
  async function removeSupplier(l: any) {
    if (!confirm(`Remove ${l.supplier_name} from this variant?`)) return;
    setSupErr('');
    try { await api(`/api/product-suppliers/${l.id}`, { method: 'DELETE' }); loadSup(); } catch (e: any) { setSupErr(e.message); }
  }

  if (!d) return err ? <div className="err" role="alert">{err}</div> : <Loading rows={6} />;

  const v = d.variant;
  const [lab, cls] = STATUS[v.stock_status] ?? ['Unknown', ''];
  const n = qty === '' ? NaN : Number(qty);
  const qtyOk = Number.isInteger(n) && n > 0;
  const hasStock = v.available_quantity !== null && v.available_quantity !== undefined;
  const overIssue = qtyOk && hasStock && n > Number(v.available_quantity);
  const countOk = count !== '' && Number.isInteger(Number(count)) && Number(count) >= 0;
  const targetOk = target !== '' && Number.isInteger(Number(target)) && Number(target) >= 0;
  const digits = (s: string) => s.replace(/\D/g, '');

  return (
    <>
      {/* ───── header ───── */}
      <PageHeader
        back="/inventory"
        crumbs={[{ label: 'Inventory', href: '/inventory' }, ...String(v.path ?? '').split('/').filter(Boolean).map((x: string) => ({ label: x }))]}
        title={<Lens row={v.row_label_source} col={v.col_axis_name ? v.col_label_source : null} />}
        badge={<Badge tone={cls.replace('b-', '') as any}>{lab}</Badge>}
        sub={<>{v.row_axis_name}{v.col_axis_name ? ` × ${v.col_axis_name}` : ''}{v.row_occurrence > 0 && <> <Badge tone="warn">Duplicate row label #{v.row_occurrence + 1}</Badge></>}</>}
        actions={<Link className="btn" href={`/stock?variantId=${id}`}>Open in stock entry</Link>}
      />

      {/* ───── stock summary ───── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpis">
          <div className="kpi"><b>{num(v.available_quantity)}</b><span>Available ({v.available_state})</span></div>
          <div className="kpi"><b>{num(v.target_quantity)}</b><span>Target ({v.target_state})</span></div>
          <div className="kpi"><b>{num(v.suggested_order)}</b><span>Suggested order</span></div>
        </div>

        {v.suggested_order === null && (
          <div className="note info" style={{ marginTop: 14, marginBottom: 0 }}>
            <div>
              Suggested order is unknown:{' '}
              {v.available_state !== 'recorded'
                ? <><b>this lens needs a physical count</b>. It is only calculated once available stock is verified.</>
                : <><b>no valid target</b> is set.</>}
              {' '}Legacy Excel (blank = 0) would show <b>{num(v.legacy_suggested_order_blank_as_zero)}</b>. This is informational only and never used for ordering.
            </div>
          </div>
        )}
        {v.available_state === 'unverified' && (
          <div className="note warn" role="note" style={{ marginTop: 14, marginBottom: 0 }}>
            This stock figure is unverified (the source stock grid equals the target grid). Record a physical count before receiving or issuing.
          </div>
        )}
        {(v.target_state === 'invalid' || v.available_state === 'invalid') && (
          <div className="note bad" role="note" style={{ marginTop: 14, marginBottom: 0 }}>
            The original cell value is not a valid quantity. It is kept exactly as written (see Source record) and flagged Invalid. Nothing was guessed.
          </div>
        )}
      </div>

      {/* ───── record stock change ───── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="card-title">Record stock change</h2>
        <p className="card-sub">The reason is saved with every change. It is required for physical counts.</p>

        <label className="field" style={{ maxWidth: 420, marginBottom: 14 }}>
          <span>Reason</span>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. PO number, damaged in store, monthly count" />
        </label>

        <div className="act-grid">
          <div className="act">
            <h3>Receive or issue</h3>
            <p>Add stock that arrived or remove stock that left.</p>
            <label className="field">
              <span>Quantity</span>
              <input inputMode="numeric" placeholder="0" value={qty} onChange={e => setQty(digits(e.target.value))} />
            </label>
            {overIssue && <div className="err" style={{ margin: 0 }} role="alert">Only {num(v.available_quantity)} available, so you can’t issue {num(n)}.</div>}
            <div className="row">
              <button className="p" disabled={busy || !qtyOk}
                onClick={() => act('/api/stock/receive', { quantity: n, reason: reason || undefined }, `Received ${num(n)}.`, () => { setQty(''); setReason(''); })}>
                Receive{qtyOk ? ` ${num(n)}` : ''}
              </button>
              <button disabled={busy || !qtyOk || overIssue}
                onClick={() => act('/api/stock/issue', { quantity: n, reason: reason || undefined }, `Issued ${num(n)}.`, () => { setQty(''); setReason(''); })}>
                Issue{qtyOk ? ` ${num(n)}` : ''}
              </button>
            </div>
          </div>

          <div className="act">
            <h3>Physical count</h3>
            <p>Set available stock to what you counted on the shelf.</p>
            <label className="field">
              <span>Counted quantity</span>
              <input inputMode="numeric" placeholder="0" value={count} onChange={e => setCount(digits(e.target.value))} />
            </label>
            {countOk && hasStock && <p className="mut" style={{ margin: 0 }}>Adjustment: <b>{signed(Number(count) - Number(v.available_quantity))}</b></p>}
            <div className="row">
              <button disabled={busy || !countOk || !reason.trim()}
                onClick={() => act('/api/stock/count', { count: Number(count), reason }, `Stock set to ${num(Number(count))}.`, () => { setCount(''); setReason(''); })}>
                Post count
              </button>
              {!reason.trim() && <span className="mut small">Reason required</span>}
            </div>
          </div>

          <div className="act">
            <h3>Target</h3>
            <p>The level this lens should be stocked to.</p>
            <label className="field">
              <span>New target</span>
              <input inputMode="numeric" placeholder="0" value={target} onChange={e => setTarget(digits(e.target.value))} />
            </label>
            <div className="row">
              <button disabled={busy || !targetOk}
                onClick={() => act('/api/stock/target', { target: Number(target), reason: reason || undefined }, `Target set to ${num(Number(target))}.`, () => { setTarget(''); setReason(''); })}>
                Set target
              </button>
            </div>
          </div>
        </div>

        {err && <div className="err" role="alert">{err}</div>}
        {msg && <div className="okmsg" role="status">{msg}</div>}
      </div>

      {/* ───── suppliers ───── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="card-title">Suppliers</h2>
        <p className="card-sub">
          Effective preferred supplier (this lens, otherwise the nearest folder): <b style={{ color: 'var(--fg)' }}>{sup?.effectivePreferred?.supplier_name ?? 'none'}</b>
        </p>

        {sup?.items?.length === 0 && <p className="mut">No suppliers linked to this variant.</p>}
        {sup?.items?.map((l: any) => (
          <div key={l.id} className="sup-row">
            <b>{l.supplier_name}</b>
            {l.is_preferred && <span className="badge b-ok">Preferred</span>}
            {l.supplier_product_code && <span className="mut">Code {l.supplier_product_code}</span>}
            <span className="grow" />
            <button className="sm danger" onClick={() => removeSupplier(l)}>Remove</button>
          </div>
        ))}

        <div className="row" style={{ marginTop: 14 }}>
          <select aria-label="Supplier" value={sid} onChange={e => setSid(e.target.value)}>
            <option value="">Link a supplier…</option>
            {allSup.map(x => <option key={x.id} value={x.id}>{x.supplier_name}</option>)}
          </select>
          <input aria-label="Supplier product code" placeholder="Supplier code (optional)" value={scode} onChange={e => setScode(e.target.value)} />
          <label className="row" style={{ margin: 0 }}>
            <input type="checkbox" checked={pref} onChange={e => setPref(e.target.checked)} /> <span>Preferred</span>
          </label>
          <button className="p" disabled={!sid} onClick={linkSupplier}>Link supplier</button>
        </div>
        {supErr && <div className="err" role="alert">{supErr}</div>}
      </div>

      {/* ───── source record (collapsed) ───── */}
      <details className="fold">
        <summary>Source record</summary>
        <div>
          {d.source && (
            <div className="kpis">
              <div className="kpi"><b><code>{String(d.source.target_raw)}</code></b><span>Target cell (raw)</span></div>
              <div className="kpi"><b><code>{String(d.source.stock_raw)}</code></b><span>Stock cell (raw)</span></div>
              <div className="kpi"><b><code>{String(d.source.legacy_order_cached)}</code></b><span>Legacy order{d.source.legacy_order_formula ? ` · ${d.source.legacy_order_formula}` : ''}</span></div>
            </div>
          )}
          {d.source?.source_flags?.length > 0 && (
            <p style={{ marginTop: 12 }}>
              {d.source.source_flags.map((f: string) => <span key={f} className="badge b-warn" style={{ marginRight: 4 }}>{f}</span>)}
            </p>
          )}
          {d.importRecords.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {d.importRecords.map((r: any, k: number) => (
                <div key={k} className="mut small">{r.source_file} · {r.source_cell} · {r.status}</div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* ───── movement history ───── */}
      <div className="section-title"><h2>Movement history</h2><span className="mut small">{d.movements.length} {d.movements.length === 1 ? 'entry' : 'entries'}</span></div>
      <div className="wrap" tabIndex={0} role="region" aria-label="Movement history">
        <table>
          <thead>
            <tr><th>When</th><th>Type</th><th className="n">Change</th><th className="n">Before</th><th className="n">After</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {d.movements.map((m: any) => {
              const delta = Number(m.quantity_delta);
              return (
                <tr key={m.id}>
                  <td className="mut">{fmtDateTime(m.created_at)}</td>
                  <td><StatusPill kind="movement" value={m.movement_type} /></td>
                  <td className={'n ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : '')}>{signed(m.quantity_delta)}</td>
                  <td className="n">{num(m.quantity_before)}</td>
                  <td className="n">{num(m.quantity_after)}</td>
                  <td className="wrapcell">{m.reason}</td>
                </tr>
              );
            })}
            {d.movements.length === 0 && <tr><td colSpan={6} className="mut" style={{ textAlign: 'center', padding: 28 }}>No movements yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}