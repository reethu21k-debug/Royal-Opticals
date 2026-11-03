'use client';
import { useEffect, useRef, useState } from 'react';
import type { GLine } from './CountGrid';
import { fmtPower } from '@/lib/power-format';

/**
 * Quick count: ONE lens at a time, big number box, Enter saves and jumps to the next lens that is still uncounted.
 * Made for standing at the shelf (phone or tablet) and for keyboard-only speed at a desk.
 *   Enter = save and next  ·  Enter on an empty box = skip (stays "not counted")  ·  ↑ = back  ·  ↓ = skip
 * Blank is never zero: only the "0 — none on shelf" button or typing 0 records zero.
 */

const MAX = 1_000_000;
const STYLES = `
.qc{max-width:680px;margin:0 auto 24px}
.qc-card{padding:20px 20px 22px}
.qc-top{display:flex;justify-content:space-between;gap:6px 14px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--mut);margin-bottom:8px}
.qc-bar{height:8px;border-radius:99px;background:var(--soft-2);overflow:hidden;margin-bottom:18px}
.qc-bar i{display:block;height:100%;background:var(--ok);border-radius:99px;transition:width .2s}
.qc-where{font-size:12.5px;color:var(--mut);overflow-wrap:anywhere}
.qc-lens{font-size:36px;font-weight:700;line-height:1.15;margin:4px 0 6px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.qc-sys{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14px;color:var(--mut);margin-bottom:16px}
.qc-sys b{color:var(--fg);font-size:18px}
.qc-entry{display:flex;gap:10px;align-items:center;margin-bottom:12px}
.qc-entry input{flex:1;min-width:0;width:100%;height:76px;text-align:center;font-size:44px;font-weight:700;border-radius:14px;font-variant-numeric:tabular-nums}
button.qc-step{flex:none;width:76px;height:76px;padding:0;font-size:34px;line-height:1;border-radius:14px}
.qc-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.qc-actions button{height:52px;font-size:16px}
.qc-links{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:center;font-size:13px;margin-top:6px}
.qc-next{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--mut);margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.qc-chip{padding:2px 9px;border-radius:99px;background:var(--soft);border:1px solid var(--line);color:var(--fg);font-variant-numeric:tabular-nums}
.qc-err{color:var(--bad);font-size:13px;margin:0 0 10px}
.qc-done{text-align:center;padding:14px 0 6px}
.qc-done h3{font-size:22px;margin:0 0 6px}
.qc-done p{margin:0 0 14px;color:var(--mut)}
.qc-done .qc-actions{max-width:420px;margin:0 auto 12px}
@media (max-width:700px){.qc-lens{font-size:30px}.qc-entry input{height:68px;font-size:38px}button.qc-step{width:64px;height:68px}}
`;

const lensName = (l: GLine) => `${fmtPower(l.row_label_source)}${l.col_label_source ? ' × ' + fmtPower(l.col_label_source) : ''}`;

export default function QuickCount({ items, rowState, hasNextPage, onNextPage, onSave, onNotice }: {
  items: GLine[]; rowState: Record<string, string>; hasNextPage: boolean; onNextPage: () => void;
  onSave: (l: GLine, raw: string) => Promise<boolean>; onNotice: (message: string) => void;
}) {
  const [skipCounted, setSkipCounted] = useState(true);
  const [idx, setIdx] = useState(() => { const i = items.findIndex(l => l.counted_quantity === null); return i < 0 ? 0 : i; });
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ l: GLine; prev: number | null; value: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const cur: GLine | undefined = items[idx];
  const counted = items.filter(l => l.counted_quantity !== null).length;
  const remaining = items.length - counted;
  const pct = items.length ? Math.round((counted / items.length) * 100) : 0;

  // every time the lens changes: show its current count and put the cursor in the box
  useEffect(() => {
    setVal(cur?.counted_quantity != null ? String(cur.counted_quantity) : ''); setErr('');
    const t = setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
    return () => clearTimeout(t);
  }, [cur?.variant_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextIdx = (from: number) => { for (let i = from + 1; i < items.length; i++) if (!skipCounted || items[i].counted_quantity === null) return i; return items.length; };
  const firstUncounted = () => items.findIndex(l => l.counted_quantity === null);

  async function commit(raw: string) {
    if (!cur || busy) return;
    const t = raw.trim();
    if (t === '') { setIdx(nextIdx(idx)); return; }             // empty = skip, never zero
    const v = Number(t);
    if (!Number.isInteger(v) || v < 0 || v > MAX) { setErr('Type a whole number, 0 or more.'); return; }
    setBusy(true); setErr('');
    const prev = cur.counted_quantity;
    const ok = await onSave(cur, String(v));
    setBusy(false);
    if (!ok) { setErr(rowState[cur.variant_id] && rowState[cur.variant_id] !== 'saving' ? rowState[cur.variant_id] : 'Could not save. Try again.'); return; }
    setLast({ l: cur, prev, value: v }); setIdx(nextIdx(idx));
  }
  async function clearCurrent() {
    if (!cur || busy) return; setBusy(true);
    const ok = await onSave(cur, ''); setBusy(false);
    if (ok) { setVal(''); setLast(null); input.current?.focus(); }
  }
  async function undoLast() {
    if (!last || busy) return; setBusy(true);
    const ok = await onSave(last.l, last.prev === null ? '' : String(last.prev)); setBusy(false);
    if (ok) { const i = items.findIndex(x => x.variant_id === last.l.variant_id); if (i >= 0) setIdx(i); onNotice(`Undid ${lensName(last.l)}.`); setLast(null); }
  }
  const bump = (d: number) => { const base = val.trim() === '' ? 0 : Number(val); setVal(String(Math.max(0, (Number.isFinite(base) ? base : 0) + d))); input.current?.focus(); };

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commit(val); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(nextIdx(idx)); }
  }

  if (items.length === 0) return <div className="card mut" style={{ padding: 18, textAlign: 'center' }}>No lines match this view.</div>;

  const upcoming: GLine[] = []; for (let i = idx + 1; i < items.length && upcoming.length < 4; i++) if (!skipCounted || items[i].counted_quantity === null) upcoming.push(items[i]);
  const rec = cur?.recorded_quantity ?? null; const canSame = !!cur && cur.recorded_state === 'recorded' && rec !== null;
  const errShown = err || (cur && typeof rowState[cur.variant_id] === 'string' && rowState[cur.variant_id] !== 'saving' && rowState[cur.variant_id] !== 'saved' ? rowState[cur.variant_id] : '');

  return (
    <div className="qc">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="card qc-card">
        <div className="qc-top">
          <span><b>{counted}</b> of {items.length} counted · {remaining} to go</span>
          <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={skipCounted} onChange={e => setSkipCounted(e.target.checked)} /> <span>Skip lines already counted</span></label>
        </div>
        <div className="qc-bar" role="progressbar" aria-label="Progress on these lines" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>

        {cur ? (<>
          <div className="qc-where">{cur.workbook} › {cur.block} · line {idx + 1} of {items.length}</div>
          <div className="qc-lens" aria-live="polite">{lensName(cur)}</div>
          <div className="qc-sys">
            <span>System stock</span><b>{rec === null ? '—' : rec}</b>
            {cur.recorded_state === 'unverified' && <span className="badge b-info">unverified</span>}
            {cur.recorded_state !== 'recorded' && cur.recorded_state !== 'unverified' && <span className="badge b-mute">not recorded</span>}
            {cur.counted_quantity !== null && <span className="badge b-ok">already counted: {cur.counted_quantity}</span>}
          </div>

          <div className="qc-entry">
            <button type="button" className="qc-step" aria-label="Minus one" tabIndex={-1} onClick={() => bump(-1)}>−</button>
            <input ref={input} aria-label={`Counted quantity for ${lensName(cur)}`} inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="–"
              value={val} onChange={e => { setVal(e.target.value.replace(/[^0-9]/g, '')); setErr(''); }} onKeyDown={onKey} onFocus={e => e.target.select()} />
            <button type="button" className="qc-step" aria-label="Plus one" tabIndex={-1} onClick={() => bump(1)}>+</button>
          </div>
          {errShown && <p className="qc-err" role="alert">{errShown}</p>}

          <div className="qc-actions">
            <button type="button" className="p" disabled={busy} onClick={() => commit(val)}>{busy ? 'Saving…' : val.trim() === '' ? 'Skip →' : 'Save & next →'}</button>
            {canSame && <button type="button" disabled={busy} onClick={() => commit(String(rec))}>Same as system ({rec})</button>}
            <button type="button" disabled={busy} onClick={() => commit('0')}>0 — none on shelf</button>
          </div>
          <div className="qc-links">
            <button type="button" className="link" disabled={idx === 0 || busy} onClick={() => setIdx(Math.max(0, idx - 1))}>← Back</button>
            <button type="button" className="link" disabled={busy} onClick={() => setIdx(nextIdx(idx))}>Skip (leave blank)</button>
            {cur.counted_quantity !== null && <button type="button" className="link" disabled={busy} onClick={clearCurrent}>Clear this count</button>}
            {last && <button type="button" className="link" disabled={busy} onClick={undoLast}>Undo last ({lensName(last.l)} = {last.value})</button>}
          </div>

          {upcoming.length > 0 && <div className="qc-next"><span>Next:</span>{upcoming.map(l => <span key={l.variant_id} className="qc-chip">{lensName(l)}</span>)}</div>}
          <div className="qc-next" style={{ border: 0, paddingTop: 0, marginTop: 8 }}>Enter = save &amp; next · Enter on an empty box = skip · ↑ back · ↓ skip</div>
        </>) : (
          <div className="qc-done">
            <h3>{remaining === 0 ? 'All lines counted ✓' : 'End of these lines'}</h3>
            <p>{remaining === 0 ? 'Every line shown has a number. Press “Submit for approval” at the top when you are done.' : `${remaining} line${remaining === 1 ? ' is' : 's are'} still not counted (skipped).`}</p>
            <div className="qc-actions">
              {remaining > 0 && <button type="button" className="p" onClick={() => setIdx(Math.max(0, firstUncounted()))}>Go to first uncounted</button>}
              {hasNextPage && <button type="button" onClick={onNextPage}>Next page →</button>}
              <button type="button" onClick={() => setIdx(Math.max(0, items.length - 1))}>← Back to last line</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}