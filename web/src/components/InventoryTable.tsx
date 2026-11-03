'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { num, STATUS, ago } from './api';
import { Badge, Lens } from './ui';

// How full the shelf is relative to its target, shown as a thin bar under the numbers.
function fill(r: any): { pct: number; tone: string } | null {
  if (r.available_quantity === null || r.available_quantity === undefined || !(r.target_quantity > 0)) return null;
  const tone = r.stock_status === 'out_of_stock' ? 'bad' : r.stock_status === 'below_target' ? 'warn' : r.stock_status === 'unverified' ? 'info' : '';
  return { pct: Math.max(0, Math.min(100, Math.round((r.available_quantity / r.target_quantity) * 100))), tone };
}

export default function InventoryTable({ items }: { items: any[] }) {
  const router = useRouter();
  return (
    <div className="wrap" tabIndex={0} role="region" aria-label="Scrollable table">
      <table>
        <thead><tr>
          <th>Lens <span className="mut" style={{ fontWeight: 400 }}>(row × column)</span></th>
          <th className="n">Stock <span className="mut" style={{ fontWeight: 400 }}>vs target</span></th>
          <th className="n hide-sm">Suggested order</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          {items.map(r => {
            const [lab, cls] = STATUS[r.stock_status] ?? ['Unknown', 'b-mute']; const f = fill(r);
            return (
              <tr key={r.variant_id} style={{ cursor: 'pointer' }} onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) router.push(`/inventory/${r.variant_id}`); }}>
                <td>
                  <Link className="lens-link" href={`/inventory/${r.variant_id}`}><Lens row={r.row_label_source} col={r.col_label_source} /></Link>
                  {!r.is_active && <> <Badge tone="bad">Archived</Badge></>}
                  {r.row_occurrence > 0 && <> <Badge tone="warn" title="Duplicate row label in the source grid">Duplicate #{r.row_occurrence + 1}</Badge></>}
                  <span className="sub where" title={r.path}>
                    {r.workbook} › <Link href={`/blocks/${r.block_node_id}`} title="Open as power matrix" style={{ color: 'inherit' }}>{r.block}</Link>
                  </span>
                </td>
                <td className="n">
                  <span className="stockcell">
                    <span className="nums">
                      <b>{num(r.available_quantity)}</b>
                      {r.target_state === 'invalid'
                        ? <span className="b-bad" title="The source value is not a valid quantity"> · invalid target</span>
                        : <span className="of"> / {num(r.target_quantity)}</span>}
                    </span>
                    {f && <span className={'meter ' + f.tone} role="img" aria-label={`${f.pct}% of target`}><i style={{ width: f.pct + '%' }} /></span>}
                  </span>
                </td>
                <td className="n hide-sm">
                  {r.suggested_order !== null
                    ? (r.suggested_order > 0 ? <b>{r.suggested_order}</b> : <span className="mut">0</span>)
                    : r.available_state !== 'recorded'
                      ? <Badge tone="info" title="Stock is not verified. A suggested order is calculated only after a physical count is approved.">Needs count</Badge>
                      : <span className="mut" title="No valid target is set, so no suggestion is calculated.">No target</span>}
                </td>
                <td>
                  <Badge tone={cls.replace('b-', '') as any}>{lab}</Badge>
                  <span className="sub" title={r.last_movement ? new Date(r.last_movement).toLocaleString() : ''}>{r.last_movement ? `Last moved ${ago(r.last_movement)}` : 'No movements yet'}</span>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && <tr><td colSpan={4} className="mut">No matching records.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
