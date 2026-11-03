'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, num, STATUS } from '@/components/api';
import { PageHeader, Loading, Note, Badge } from '@/components/ui';
import { fmtPower } from '@/lib/power-format';

const MARK: Record<string, string> = { stock_unknown: '?', unverified: '!', out_of_stock: '✕', below_target: '▼', ok: '' };
const tone = (s: string) => (STATUS[s]?.[1] ?? 'b-mute').replace('b-', '');
export default function Matrix() {
  const { id } = useParams<{ id: string }>(); const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [sel, setSel] = useState<any>(null);
  useEffect(() => { api(`/api/blocks/${id}/matrix`).then(setD).catch(e => setErr(e.message)); }, [id]);
  if (err) return <div className="err" role="alert">{err}</div>; if (!d) return <Loading rows={8} />;
  const grid = new Map<string, any>(d.cells.map((c: any) => [`${c.ri}:${c.ci}`, c]));
  const parts = String(d.node.path ?? '').split('/').filter(Boolean);
  return (<>
    <PageHeader crumbs={[{ label: 'Inventory', href: '/inventory' }, ...parts.map(p => ({ label: p }))]} title="Power matrix" sub={<>Each cell shows <b>available / target</b>. A dash means “not recorded in the source”, never zero. The grid follows the order of the original sheet.</>} />
    <div className="legend-row" aria-label="Legend">
      {(['ok', 'below_target', 'out_of_stock', 'stock_unknown', 'unverified'] as const).map(k => <span key={k}><span className={'dot ' + STATUS[k][1]} aria-hidden="true" />{STATUS[k][0]}{MARK[k] && <b aria-hidden="true"> {MARK[k]}</b>}</span>)}
    </div>
    <div className="wrap" tabIndex={0} role="region" aria-label="Scrollable table" style={{ maxHeight: '65vh' }}><table aria-label="Power matrix">
      <thead><tr><th style={{ position: 'sticky', left: 0, zIndex: 2 }}>{d.rowAxis ?? ''}{d.colAxis ? ` \\ ${d.colAxis}` : ''}</th>{d.cols.map((c: any) => <th key={c.key} className="n"><code>{fmtPower(c.label)}</code></th>)}</tr></thead>
      <tbody>{d.rows.map((r: any, ri: number) => (<tr key={r.key}><th style={{ position: 'sticky', left: 0, background: '#f1f3f9' }}><code>{fmtPower(r.label)}</code>{r.occurrence > 0 && <> <Badge tone="warn">Duplicate #{r.occurrence + 1}</Badge></>}</th>
        {d.cols.map((c: any, ci: number) => { const cell = grid.get(`${ri}:${ci}`); if (!cell) return <td key={c.key} className="n mut">·</td>;
          const st = cell.availableState === 'unverified' ? 'unverified' : cell.status; const t = tone(st);
          return <td key={c.key} className="n"><button className={`mcell t-${t}` + (sel?.variantId === cell.variantId ? ' on' : '')} aria-pressed={sel?.variantId === cell.variantId} onClick={() => setSel(cell)} aria-label={`available ${num(cell.available)} of target ${num(cell.target)}`}>
            <b>{num(cell.available)}</b><span className="mut">/{num(cell.target)}</span> <span className={'b-' + t}>{MARK[st]}</span></button></td>; })}</tr>))}</tbody></table></div>
    {sel && <section className="card selbar" style={{ position: 'static' }}><b>Selected:</b> <span>available {num(sel.available)} ({sel.availableState}) · target {num(sel.target)} · suggested order {num(sel.suggestedOrder)}</span> <Link className="btn p sm" href={`/inventory/${sel.variantId}`}>Open lens (receive / issue / count)</Link></section>}
  </>);
}