'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/components/api';
import { PageHeader, Badge, Loading, Note, Ico, type Tone } from '@/components/ui';
import { balanceOf, deductions, fmtPower, lineAmount, money, round2, stockDelta } from '@/lib/billing';
import { fmtPower as fmtLabel } from '@/lib/power-format';
import s from './billing.module.css';
import { downloadFile } from './download';

type Side = 'R' | 'L';
type Source = 'inventory' | 'external';
type Eye = {
  source: Source; variantId: string | null; invLabel: string; invWhere: string; avail: number | null;
  lensType: string; sph: string; cyl: string; axis: string; add: string; qty: string; rate: string;
  locked: { sph: boolean; cyl: boolean; add: boolean };   // powers that came from the inventory record are not retyped
};
type Line = { key: string; R: Eye; L: Eye };

const blankEye = (): Eye => ({ source: 'inventory', variantId: null, invLabel: '', invWhere: '', avail: null, lensType: '', sph: '', cyl: '', axis: '', add: '', qty: '1', rate: '', locked: { sph: false, cyl: false, add: false } });
const blankLine = (): Line => ({ key: crypto.randomUUID(), R: blankEye(), L: blankEye() });
const used = (e: Eye) => (e.source === 'inventory' ? !!e.variantId : !!(e.lensType.trim() || e.sph || e.cyl || e.axis || e.add));
const toNum = (v: string): number | null | 'bad' => { const t = v.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : 'bad'; };
// Display helpers (stored labels and messages are never changed): powers inside a lens label such as "1 × -0.5" are shown with two decimals.
const lensLabel = (s: string) => s.split(' × ').map(p => fmtLabel(p)).join(' × ');
const tidy = (m: string) => m.replace(/(stock for |unknown inventory lens )([^(]+?)( \(|$)/, (_x, a: string, l: string, z: string) => a + lensLabel(l) + z);
const STATUS: Record<string, [string, Tone]> = { draft: ['Draft', 'warn'], finalized: ['Finalized', 'ok'], void: ['Void', 'mute'] };

function eyeFromItem(i: any): Eye {
  return {
    source: i.source, variantId: i.variant_id ?? null, invLabel: lensLabel(i.inventory_label ?? ''), invWhere: '', avail: i.stock_available === null || i.stock_available === undefined ? null : Number(i.stock_available),
    lensType: i.lens_type ?? '', sph: i.sph === null ? '' : fmtPower(i.sph), cyl: i.cyl === null ? '' : fmtPower(i.cyl), axis: i.axis === null ? '' : String(i.axis), add: i.add_power === null ? '' : fmtPower(i.add_power),
    qty: String(i.quantity), rate: String(Number(i.rate)),
    locked: { sph: false, cyl: false, add: false },
  };
}

/* ───────── inventory lens finder (dialog) ───────── */
function Picker({ onPick, onClose }: { onPick: (x: any) => void; onClose: () => void }) {
  const [f, setF] = useState({ q: '', sph: '', cyl: '', add: '' });
  const [data, setData] = useState<{ items: any[]; needFilter: boolean } | null>(null);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const [hi, setHi] = useState(0);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');   // order of the search results
  useEffect(() => { ref.current?.focus(); const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (f.q.trim()) p.set('q', f.q.trim());
      for (const k of ['sph', 'cyl', 'add'] as const) if (f[k].trim() !== '' && Number.isFinite(Number(f[k]))) p.set(k, String(Number(f[k])));
      if (dir === 'desc') p.set('dir', 'desc');
      setLoading(true); setErr('');
      api(`/api/billing/lenses?${p}`).then(d => alive && setData(d)).catch(e => alive && setErr(e.message)).finally(() => alive && setLoading(false));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [f, dir]);
  const isOk = (x: any) => x.available_quantity !== null && Number(x.available_quantity) > 0 && x.available_state === 'recorded';
  const okIdx = (data?.items ?? []).map((x, i) => (isOk(x) ? i : -1)).filter(i => i >= 0);
  useEffect(() => { setHi(0); }, [data]);
  const onKeys = (e: React.KeyboardEvent) => {
    if (!okIdx.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, okIdx.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); onPick(data!.items[okIdx[Math.min(hi, okIdx.length - 1)]]); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const tidyPower = (k: 'sph' | 'cyl' | 'add') => () => { const t = f[k].trim(); if (t !== '' && Number.isFinite(Number(t))) setF(x => ({ ...x, [k]: fmtPower(Number(t)) })); };
  return (
    <div className={s.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Choose a lens from the inventory">
        <div className={s.dlgHead}><h2>Choose a lens from the inventory</h2><button type="button" onClick={onClose} aria-label="Close">Close</button></div>
        <div className={s.filters} onKeyDown={onKeys}>
          <input ref={ref} className={s.q} aria-label="Lens name" placeholder="Lens type, e.g. CR 1.56 HMC" value={f.q} onChange={set('q')} />
          <input inputMode="decimal" aria-label="SPH" placeholder="SPH" value={f.sph} onChange={set('sph')} onBlur={tidyPower('sph')} />
          <input inputMode="decimal" aria-label="CYL" placeholder="CYL" value={f.cyl} onChange={set('cyl')} onBlur={tidyPower('cyl')} />
          <input inputMode="decimal" aria-label="ADD" placeholder="ADD" value={f.add} onChange={set('add')} onBlur={tidyPower('add')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '0 0 8px' }}>
          <p className={s.keys} style={{ margin: 0 }}>Type to search · ↑ ↓ to move · Enter to pick · Esc to close</p>
          <button type="button" className="sm" onClick={() => { setDir(dir === 'asc' ? 'desc' : 'asc'); ref.current?.focus(); }}
            title={dir === 'asc' ? 'Ascending order. Click to show results in descending order.' : 'Descending order. Click to show results in ascending order.'}
            aria-label={`Sort order: ${dir === 'asc' ? 'ascending' : 'descending'}. Activate to switch to ${dir === 'asc' ? 'descending' : 'ascending'}.`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 14, height: 14, stroke: 'currentColor', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', transition: 'transform .18s', transform: dir === 'desc' ? 'rotate(180deg)' : 'none' }}><path d="M12 19V5m0 0-5 5m5-5 5 5" /></svg>
            {dir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        {data?.needFilter && <p className="mut small">Type part of the lens name, or enter a SPH / CYL / ADD value, to search the inventory.</p>}
        {data && !data.needFilter && data.items.length === 0 && !loading && (
          <Note tone="info" icon="info">No matching lens in the inventory. If it has to be bought from another supplier, close this and set the line to <b>External order</b>.</Note>
        )}
        <div className={s.results} style={{ opacity: loading ? 0.6 : 1 }}>
          {data?.items.map((x, i) => {
            const q = x.available_quantity === null ? null : Number(x.available_quantity);
            const ok = q !== null && q > 0 && x.available_state === 'recorded';
            const active = ok && okIdx[Math.min(hi, okIdx.length - 1)] === i;
            const why = q === null ? 'Stock not recorded' : x.available_state !== 'recorded' ? 'Stock unverified' : q <= 0 ? 'Out of stock' : '';
            return (
              <button type="button" key={x.variant_id} className={s.result + (active ? ' ' + s.resultHi : '')} ref={el => { if (el && active) el.scrollIntoView({ block: 'nearest' }); }} disabled={!ok} onClick={() => onPick(x)} title={ok ? 'Use this lens' : `${why}: it can’t be taken from the inventory`}>
                <span><b>{lensLabel(`${x.row_label_source ?? '—'}${x.col_label_source ? ` × ${x.col_label_source}` : ''}`)}</b><small>{x.workbook} › {x.block}</small></span>
                <span className={s.stockN}>{ok ? <><b>{q}</b> in stock</> : <Badge tone="bad">{why}</Badge>}</span>
              </button>
            );
          })}
        </div>
        {data && data.items.length >= 40 && <p className="mut small">Showing the first 40 matches. Narrow the search to see others.</p>}
      </div>
    </div>
  );
}

/* ───────── the bill ───────── */
export default function BillEditor({ id }: { id?: string }) {
  const router = useRouter();
  const idem = useRef(crypto.randomUUID());
  const [loaded, setLoaded] = useState(!id);
  const [bill, setBill] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [h, setH] = useState({ customerName: '', billDate: new Date().toISOString().slice(0, 10), oldBalance: '', returnAmount: '', advanceAmount: '', notes: '' });
  const [picker, setPicker] = useState<{ key: string; side: Side } | null>(null);
  const [dl, setDl] = useState<'' | 'pdf' | 'xlsx'>('');
  const [modes, setModes] = useState<Record<string, 'none' | 'open'>>({});   // UI only: which eyes the user marked "None"
  const [err, setErr] = useState<string[]>([]); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const [orig, setOrig] = useState<Map<string, number>>(new Map());   // inventory quantities as last saved (to show the stock change of an edit)
  const status: string = bill?.status ?? 'draft';
  const fin = status === 'finalized';          // finalized bills can be edited: stock is adjusted by the difference
  const ro = status === 'void';                // only a void bill is read-only

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api(`/api/bills/${id}`); const b = r.bill; setBill(b);
      const o = new Map<string, number>(); for (const i of r.items) if (i.source === 'inventory' && i.variant_id) o.set(i.variant_id, (o.get(i.variant_id) ?? 0) + Number(i.quantity)); setOrig(o);
      setH({ customerName: b.customer_name ?? '', billDate: b.bill_date ?? '', oldBalance: Number(b.old_balance) ? String(Number(b.old_balance)) : '', returnAmount: Number(b.return_amount) ? String(Number(b.return_amount)) : '', advanceAmount: Number(b.advance_amount) ? String(Number(b.advance_amount)) : '', notes: b.notes ?? '' });
      const byNo = new Map<number, Line>();
      for (const i of r.items) { const l = byNo.get(i.line_no) ?? { key: crypto.randomUUID(), R: blankEye(), L: blankEye() }; l[i.side as Side] = eyeFromItem(i); byNo.set(i.line_no, l); }
      const arr = Array.from(byNo.entries()).sort((a, c) => a[0] - c[0]).map(x => x[1]);
      while (b.status === 'draft' && arr.length < 1) arr.push(blankLine());
      const m: Record<string, 'none' | 'open'> = {};
      for (const l of arr) for (const sd of ['R', 'L'] as Side[]) if (!used(l[sd]) && used(l[sd === 'R' ? 'L' : 'R'])) m[`${l.key}:${sd}`] = 'none';
      setModes(m); setLines(arr); setLoaded(true);
    } catch (e: any) { setErr([tidy(e.message)]); setLoaded(true); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  function patch(key: string, side: Side, p: Partial<Eye>) { setLines(ls => ls.map(l => (l.key === key ? { ...l, [side]: { ...l[side], ...p } } : l))); setErr([]); setMsg(''); }
  function copyRtoL(key: string) { setLines(ls => ls.map(l => (l.key === key ? { ...l, L: { ...l.R, locked: { ...l.R.locked } } } : l))); setMode(key, 'L', 'open'); setErr([]); setMsg(''); }
  async function getFile(fmt: 'pdf' | 'xlsx') {
    setDl(fmt); setErr([]);
    try { await downloadFile(`/api/bills/export?ids=${id}&format=${fmt}`); } catch (e: any) { setErr([tidy(e.message)]); } finally { setDl(''); }
  }
  const mk = (key: string, sd: Side) => `${key}:${sd}`;
  function setMode(key: string, sd: Side, m: 'none' | 'open') { setModes(p => ({ ...p, [mk(key, sd)]: m })); }
  const isNone = (l: Line, sd: Side) => { const m = modes[mk(l.key, sd)]; return m ? m === 'none' : ro && !used(l[sd]) && used(l[sd === 'R' ? 'L' : 'R']); };
  function noEye(key: string, sd: Side) { patch(key, sd, { ...blankEye() }); setMode(key, sd, 'none'); }
  function eyesOnly(key: string, which: 'both' | Side) {
    if (which === 'both') { setMode(key, 'R', 'open'); setMode(key, 'L', 'open'); return; }
    noEye(key, which === 'R' ? 'L' : 'R'); setMode(key, which, 'open');
  }
  function chooseSource(l: Line, sd: Side, k: Source) { if (isNone(l, sd) || l[sd].source !== k) setSource(l.key, sd, k); setMode(l.key, sd, 'open'); }
  function setSource(key: string, side: Side, source: Source) { patch(key, side, { ...blankEye(), source, qty: lines.find(l => l.key === key)![side].qty || '1' }); }
  function pickLens(x: any) {
    if (!picker) return;
    const lk = (v: any) => v !== null && v !== undefined;
    patch(picker.key, picker.side, {
      source: 'inventory', variantId: x.variant_id, invLabel: lensLabel(`${x.row_label_source ?? '—'}${x.col_label_source ? ` × ${x.col_label_source}` : ''}`), invWhere: `${x.workbook} › ${x.block}`,
      avail: Number(x.available_quantity), lensType: `${x.workbook} › ${x.block}`,
      sph: lk(x.sph) ? fmtPower(x.sph) : '', cyl: lk(x.cyl) ? fmtPower(x.cyl) : '', add: lk(x.add_power) ? fmtPower(x.add_power) : '',
      locked: { sph: lk(x.sph), cyl: lk(x.cyl), add: lk(x.add_power) },
    });
    setPicker(null);
  }

  // ── derived: payload, totals, live stock check ──
  const built = useMemo(() => {
    const errors: string[] = []; const items: any[] = []; let no = 0;
    for (const l of lines) {
      const eyes = (['R', 'L'] as Side[]).filter(sd => used(l[sd])); if (!eyes.length) continue; no++;
      for (const sd of eyes) {
        const e = l[sd]; const where = `Line ${no} ${sd === 'R' ? 'Right' : 'Left'}`;
        const qty = Number(e.qty); const rate = e.rate.trim() === '' ? 0 : Number(e.rate);
        const sph = toNum(e.sph), cyl = toNum(e.cyl), add = toNum(e.add), axis = toNum(e.axis);
        if (e.source === 'external' && !e.lensType.trim()) errors.push(`${where}: enter the lens type for the external order.`);
        if (!Number.isInteger(qty) || qty < 1) errors.push(`${where}: quantity must be a whole number, 1 or more.`);
        if (!Number.isFinite(rate) || rate < 0) errors.push(`${where}: rate must be a number, 0 or more.`);
        if (sph === 'bad' || cyl === 'bad' || add === 'bad') errors.push(`${where}: SPH / CYL / ADD must be numbers.`);
        if (axis === 'bad' || (typeof axis === 'number' && (!Number.isInteger(axis) || axis < 0 || axis > 180))) errors.push(`${where}: axis must be a whole number from 0 to 180.`);
        items.push({ lineNo: no, side: sd, source: e.source, variantId: e.source === 'inventory' ? e.variantId : null, lensType: e.lensType.trim() || undefined,
          sph: sph === 'bad' ? null : sph, cyl: cyl === 'bad' ? null : cyl, add: add === 'bad' ? null : add, axis: axis === 'bad' ? null : axis, quantity: qty, rate });
      }
    }
    return { items, errors };
  }, [lines]);

  const total = round2(built.items.reduce((t, i) => t + (Number.isFinite(i.quantity) && Number.isFinite(i.rate) ? lineAmount(i.quantity, i.rate) : 0), 0));
  const ob = Number(h.oldBalance) || 0, ret = Number(h.returnAmount) || 0, adv = Number(h.advanceAmount) || 0;
  const balance = balanceOf(total, ob, ret, adv);
  const inv = built.items.filter(i => i.source === 'inventory'), ext = built.items.filter(i => i.source === 'external');
  const ded = useMemo(() => deductions(built.items), [built.items]);
  const availOf = useMemo(() => { const m = new Map<string, number | null>(); for (const l of lines) for (const sd of ['R', 'L'] as Side[]) if (l[sd].variantId) m.set(l[sd].variantId!, l[sd].avail); return m; }, [lines]);
  const delta = useMemo(() => stockDelta(fin ? orig : new Map(), ded), [fin, orig, ded]);   // draft: everything is new; finalized: only the difference
  const overs = useMemo(() => new Set(Array.from(delta).filter(([v, q]) => q > 0 && (availOf.get(v) ?? 0) < q).map(([v]) => v)), [delta, availOf]);
  const netOut = Array.from(delta.values()).reduce((a, d) => a + (d > 0 ? d : 0), 0), netBack = Array.from(delta.values()).reduce((a, d) => a + (d < 0 ? -d : 0), 0);
  const lensCount = Array.from(ded.values()).reduce((a, b) => a + b, 0);

  // ── actions ──
  const payload = (finalize: boolean) => ({ ...h, oldBalance: ob, returnAmount: ret, advanceAmount: adv, customerName: h.customerName || undefined, notes: h.notes || undefined, items: built.items, finalize });
  async function save(finalize: boolean) {
    setMsg('');
    const errs = [...built.errors];
    if (!built.items.length) errs.push('Add at least one lens to the bill.');
    if ((finalize || fin) && overs.size) errs.push('Some inventory lenses do not have enough stock. Reduce the quantity or change the line to External order.');
    if (errs.length) { setErr(errs); return; }
    if (fin && !confirm(`Save changes to this finalized bill?\n\n• ${netOut} lens${netOut === 1 ? '' : 'es'} will be taken from stock.\n• ${netBack} lens${netBack === 1 ? '' : 'es'} will be put back in stock.\n• Totals and balance are recalculated. The old version is kept in the audit log.`)) return;
    if (finalize && !confirm(`Finalize this bill?\n\n• ${lensCount} lens${lensCount === 1 ? '' : 'es'} from ${ded.size} inventory item${ded.size === 1 ? '' : 's'} will be deducted from stock.\n• ${ext.reduce((a, i) => a + i.quantity, 0)} external lens${ext.length === 1 ? '' : 'es'} will be billed but NOT deducted.\n\nA finalized bill can still be edited later; stock is then adjusted by the difference.`)) return;
    setBusy(true); setErr([]);
    try {
      const r = id
        ? await api(`/api/bills/${id}`, { method: 'PUT', body: JSON.stringify(payload(finalize)) })
        : await api('/api/bills', { method: 'POST', body: JSON.stringify({ ...payload(finalize), idempotencyKey: idem.current }) });
      if (!id) { router.replace(`/billing/${r.bill.id}`); return; }
      await load(); setMsg(finalize ? 'Bill finalized. Inventory has been updated.' : fin ? 'Changes saved. Stock was adjusted by the difference.' : 'Draft saved. Stock has not been changed.');
    } catch (e: any) { setErr([tidy(e.message)]); } finally { setBusy(false); }
  }
  async function voidBill() {
    const reason = prompt(status === 'finalized' ? 'Why is this bill being voided? The inventory lenses on it will be put back in stock.' : 'Why is this draft being cancelled?');
    if (!reason?.trim()) return;
    setBusy(true); setErr([]);
    try { await api(`/api/bills/${id}/action`, { method: 'POST', body: JSON.stringify({ action: 'void', reason }) }); await load(); setMsg('Bill voided.'); }
    catch (e: any) { setErr([tidy(e.message)]); } finally { setBusy(false); }
  }

  async function saveName() {
    setBusy(true); setErr([]); setMsg('');
    try { await api(`/api/bills/${id}`, { method: 'PATCH', body: JSON.stringify({ customerName: h.customerName }) }); await load(); setMsg('Customer name updated.'); }
    catch (e: any) { setErr([tidy(e.message)]); } finally { setBusy(false); }
  }

  if (!loaded) return <Loading rows={6} label="Loading bill" />;
  const [stLabel, stTone] = STATUS[status] ?? [status, '' as Tone];
  const inp = (v: string, on: (x: string) => void, cls: string, label: string, extra?: { disabled?: boolean; ph?: string; power?: boolean }) =>
    <input className={cls} inputMode="decimal" aria-label={label} value={v} placeholder={extra?.ph} disabled={ro || extra?.disabled} readOnly={extra?.disabled} onChange={e => on(e.target.value)}
      onBlur={extra?.power ? ev => { const n = toNum(ev.target.value); if (typeof n === 'number') on(fmtPower(n)); } : undefined} />;
  const fld = (cap: string, input: React.ReactNode) => <label className={s.fld}><span>{cap}</span>{input}</label>;

  const seg = (l: Line, idx: number, sd: Side, none: boolean) => {
    const e = l[sd]; const side = sd === 'R' ? 'Right' : 'Left';
    const opts: { k: 'none' | Source; label: string; cls: string; on: boolean }[] = [
      { k: 'none', label: 'None', cls: s.segNone, on: none },
      { k: 'inventory', label: 'Inventory', cls: s.segInv, on: !none && e.source === 'inventory' },
      { k: 'external', label: 'External order', cls: s.segExt, on: !none && e.source === 'external' },
    ];
    return (
      <div className={s.srcSeg} role="group" aria-label={`Line ${idx + 1} ${side} source`}>
        {opts.map(o => <button type="button" key={o.k} className={o.cls} aria-pressed={o.on} disabled={ro} onClick={() => { if (o.k === 'none') noEye(l.key, sd); else chooseSource(l, sd, o.k); }}>{o.label}</button>)}
      </div>);
  };

  return (<>
    <PageHeader back="/billing" actions={id && bill ? <div className={s.dlBtns}>
      <button type="button" disabled={!!dl} title="Downloads the saved version of this bill" onClick={() => getFile('pdf')}><Ico n="download" />{dl === 'pdf' ? 'Preparing…' : 'PDF'}</button>
      <button type="button" disabled={!!dl} title="Downloads the saved version of this bill" onClick={() => getFile('xlsx')}><Ico n="download" />{dl === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
    </div> : undefined} title={bill ? `Bill ${bill.bill_number}` : 'New bill'} badge={bill ? <> <Badge tone={stTone}>{stLabel}</Badge></> : undefined}
      sub="Pick each lens from the inventory, or mark it as an External order. Only inventory lenses are deducted from stock."
      crumbs={[{ label: 'Billing', href: '/billing' }, { label: bill ? bill.bill_number : 'New bill' }]} />

    {status === 'finalized' && <Note tone="ok" icon="check">Finalized. You can still edit this bill: when you save, stock is adjusted only by the difference (inventory lenses only; external orders never affect stock).</Note>}
    {status === 'void' && <Note tone="warn" icon="alert">This bill was voided{bill?.void_reason ? `: ${bill.void_reason}` : ''}. Inventory lenses on it were put back in stock.</Note>}

    <div className={s.head}>
      <label className={s.field}>Customer name<input value={h.customerName} onChange={e => setH({ ...h, customerName: e.target.value })} placeholder="Customer / shop name" /></label>
      <label className={s.field}>Date<input type="date" value={h.billDate} disabled={ro} onChange={e => setH({ ...h, billDate: e.target.value })} /></label>
      <label className={s.field}>Old balance (O.B.)<input inputMode="decimal" value={h.oldBalance} disabled={ro} onChange={e => setH({ ...h, oldBalance: e.target.value })} placeholder="0.00" /></label>
    </div>

    {ro && id && h.customerName.trim() !== (bill?.customer_name ?? '') && <div className={s.addBar}>
      <button type="button" className="p" disabled={busy} onClick={saveName}>Save customer name</button>
      <button type="button" disabled={busy} onClick={() => setH(x => ({ ...x, customerName: bill?.customer_name ?? '' }))}>Undo</button>
      <span className="mut small">Only the name changes. Lines, totals and stock stay as they are.</span>
    </div>}

    <div className={s.lines} role="region" aria-label="Bill lines">
      {lines.map((l, idx) => {
        const n = lines.slice(0, idx + 1).filter(x => used(x.R) || used(x.L)).length;
        const any = used(l.R) || used(l.L);
        const lineOver = !ro && (['R', 'L'] as Side[]).some(sd => !!l[sd].variantId && overs.has(l[sd].variantId!));
        const lineTotal = (['R', 'L'] as Side[]).reduce((t, sd) => t + (used(l[sd]) ? lineAmount(Number(l[sd].qty), Number(l[sd].rate)) : 0), 0);
        return (
          <section key={l.key} className={s.lineCard + (lineOver ? ' ' + s.lineOver : '')} aria-label={`Line ${idx + 1}`}>
            <div className={s.lineHead}>
              <span className={s.lineTitle}>Line {any ? n : idx + 1}</span>
              {!ro && <div className={s.srcSeg} role="group" aria-label={`Line ${idx + 1} eyes`}>
                <button type="button" aria-pressed={!isNone(l, 'R') && !isNone(l, 'L')} onClick={() => eyesOnly(l.key, 'both')}>Both eyes</button>
                <button type="button" aria-pressed={!isNone(l, 'R') && isNone(l, 'L')} onClick={() => eyesOnly(l.key, 'R')}>Right only</button>
                <button type="button" aria-pressed={isNone(l, 'R') && !isNone(l, 'L')} onClick={() => eyesOnly(l.key, 'L')}>Left only</button>
              </div>}
              {!ro && <div className={s.lineActs}>
                <button type="button" disabled={!used(l.R)} title="Use the same lens, powers, quantity and rate for the left eye" onClick={() => copyRtoL(l.key)}>Same for left eye</button>
                {lines.length > 1 && <button type="button" className="danger" aria-label={`Remove line ${idx + 1}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><Ico n="x" />Remove</button>}
              </div>}
              <span className={s.lineSum}>Line total<b>{any ? money(round2(lineTotal)) : '0.00'}</b></span>
            </div>
            {(['R', 'L'] as Side[]).map(sd => {
              const e = l[sd]; const on = used(e); const over = !ro && !!e.variantId && overs.has(e.variantId);
              const amt = on ? lineAmount(Number(e.qty), Number(e.rate)) : null;
              const side = sd === 'R' ? 'Right' : 'Left';
              if (isNone(l, sd)) return (
                <div key={sd} className={s.eyeRow + ' ' + s.eyeNone}>
                  <span className={s.eyeTag + (sd === 'L' ? ' ' + s.eyeL : '')} title={`${side} eye`}>{sd}<span className="sr"> {side} eye</span></span>
                  {seg(l, idx, sd, true)}
                  <span className={s.noneMsg}>No lens for the {side.toLowerCase()} eye. Nothing is billed or deducted for it.</span>
                </div>);
              return (
                <div key={sd} className={[s.eyeRow, over ? s.rowOver : '', !on && any ? s.rowUnused : ''].join(' ')}>
                  <span className={s.eyeTag + (sd === 'L' ? ' ' + s.eyeL : '')} title={`${side} eye`}>{sd}<span className="sr"> {side} eye</span></span>
                  <div className={s.lensCell}>
                    {seg(l, idx, sd, false)}
                    {e.source === 'inventory'
                      ? (ro
                        ? <div className={s.roLens}>{e.invLabel ? <><b>{e.invLabel}</b><small className="mut">{e.lensType}</small></> : <span className="mut">—</span>}</div>
                        : <div className={s.pickRow}><button type="button" className={s.pickBtn + (e.variantId ? ' ' + s.picked : '')} title={e.variantId ? 'Change lens' : undefined} onClick={() => setPicker({ key: l.key, side: sd })}>
                          {e.variantId
                            ? <><span className={s.pickMain}><b>{e.invLabel}</b><small>{e.invWhere || e.lensType}</small></span>{e.avail !== null && <span className={s.pickStock + (over ? ' ' + s.low : '')}>{e.avail} in stock</span>}</>
                            : <span className={s.pickHint}><Ico n="search" /> Choose from inventory…</span>}
                        </button>
                        {e.variantId && <button type="button" className={s.clearBtn} aria-label={`Remove lens from line ${idx + 1} ${side} eye`} title="Remove this lens" onClick={() => setSource(l.key, sd, 'inventory')}><Ico n="x" /></button>}
                        </div>)
                      : <input aria-label={`Line ${idx + 1} ${sd} lens type`} value={e.lensType} disabled={ro} placeholder="Lens details (supplier order)" onChange={ev => patch(l.key, sd, { lensType: ev.target.value })} style={{ width: '100%' }} />}
                    {over && <span className={s.warnTxt}>Only {e.avail ?? 0} in stock. <button type="button" className={s.linkBtn} onClick={() => setPicker({ key: l.key, side: sd })}>Choose another lens</button>, reduce qty, or use External order.</span>}
                  </div>
                  {fld('SPH', inp(e.sph, v => patch(l.key, sd, { sph: v }), s.num, 'SPH', { power: true, disabled: e.source === 'inventory' && e.locked.sph }))}
                  {fld('CYL', inp(e.cyl, v => patch(l.key, sd, { cyl: v }), s.num, 'CYL', { power: true, disabled: e.source === 'inventory' && e.locked.cyl }))}
                  {fld('AXIS', inp(e.axis, v => patch(l.key, sd, { axis: v.replace(/\D/g, '') }), s.axis, 'Axis', { ph: '0–180' }))}
                  {fld('ADD', inp(e.add, v => patch(l.key, sd, { add: v }), s.num, 'ADD', { power: true, disabled: e.source === 'inventory' && e.locked.add }))}
                  {fld('Qty', inp(e.qty, v => patch(l.key, sd, { qty: v.replace(/\D/g, '') }), s.qty, 'Quantity'))}
                  {fld('Rate', inp(e.rate, v => patch(l.key, sd, { rate: v }), s.rate, 'Rate', { ph: '0.00' }))}
                  <div className={s.amountBox}><span className={s.amountCap}>Amount</span><div className={s.amount}>{amt === null ? '' : money(amt)}</div></div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>

    {!ro && <div className={s.addBar}><button type="button" className={s.addBtn} onClick={() => setLines(ls => [...ls, blankLine()])}><Ico n="plus" /> Add line</button><span className="mut small">Customer changing only one eye? Use <b>Right only</b> or <b>Left only</b> on the line.</span></div>}

    <div className={s.foot}>
      <div>
        <label className={s.field}>Notes<textarea rows={3} value={h.notes} disabled={ro} onChange={e => setH({ ...h, notes: e.target.value })} style={{ height: 'auto', padding: 10 }} /></label>
        <div className={s.split2} aria-live="polite">
          <span><Badge tone="ok">Inventory</Badge> {inv.length} lens line{inv.length === 1 ? '' : 's'}{!ro && !fin && lensCount > 0 ? ` · ${lensCount} to deduct on finalize` : ''}{fin ? ` · stock change on save: ${netOut} out, ${netBack} back` : ''}</span>
          <span><Badge tone="warn">External</Badge> {ext.length} lens line{ext.length === 1 ? '' : 's'} · never deducted</span>
        </div>
      </div>
      <div className="card"><div className={s.totals}>
        <div className="r"><span>Total</span><b>{money(total)}</b></div>
        <div className="r"><span>O.B.</span><span>{money(ob)}</span></div>
        <label className="r"><span>Return</span><input inputMode="decimal" aria-label="Return" value={h.returnAmount} disabled={ro} onChange={e => setH({ ...h, returnAmount: e.target.value })} placeholder="0.00" /></label>
        <label className="r"><span>Advance</span><input inputMode="decimal" aria-label="Advance" value={h.advanceAmount} disabled={ro} onChange={e => setH({ ...h, advanceAmount: e.target.value })} placeholder="0.00" /></label>
        <div className={'r ' + s.big}><span>Balance amount</span><b>{money(balance)}</b></div>
      </div></div>
    </div>

    <div className={s.dock}>
      {err.length > 0 && <div className="err" role="alert">{err.length === 1 ? err[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{err.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
      {msg && <div className="okmsg" role="status">{msg}</div>}
      <div className={s.dockRow}>
        <div className={s.dockNums} aria-live="polite"><span>Total<b>{money(total)}</b></span><span className="bal">Balance<b>{money(balance)}</b></span></div>
        <div className={s.dockBtns}>
          {id && status !== 'void' && <button type="button" className="danger" disabled={busy} onClick={voidBill}>{status === 'finalized' ? 'Void bill' : 'Cancel draft'}</button>}
          {fin && <button type="button" className="p big" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save changes'}</button>}
          {!ro && !fin && <>
            <button type="button" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save draft'}</button>
            <button type="button" className="p big" disabled={busy} onClick={() => save(true)}>Finalize bill</button>
          </>}
        </div>
      </div>
      {fin && <span className="mut small">Saving adjusts stock by the difference. If a lens does not have enough stock, nothing is changed.</span>}
      {!ro && !fin && <span className="mut small">A draft never changes stock. Finalizing deducts inventory lenses; you can still edit the bill afterwards.</span>}
    </div>

    {picker && <Picker onPick={pickLens} onClose={() => setPicker(null)} />}
  </>);
}