'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/components/api';
import { Ico, Badge } from '@/components/ui';
import css from './suppliers.module.css';

/**
 * Suppliers → "Assign suppliers to groups".
 * The whole hierarchy loads once, so there is no drilling folder by folder:
 *   • search by name or path, filter by type or link status
 *   • or open folders inline in a tree (instant, no loading)
 *   • tick as many groups as you like, then link them to the chosen supplier in one go
 * A link on a folder covers everything inside it, so ticking a folder replaces ticks on anything inside it.
 */

type GNode = { id: string; parentId: string | null; kind: string; name: string; lenses: number };
type GLink = { id: string; node_id: string; supplier_id: string; supplier_name: string; is_preferred: boolean; supplier_product_code: string | null };
type Supplier = { id: string; supplier_name: string; is_active: boolean };

const KIND: Record<string, [string, string]> = { family: ['Category', 'folder'], folder: ['Folder', 'folder'], workbook: ['Workbook', 'book'], block: ['Grid', 'grid'] };
const KIND_PLURAL: Record<string, string> = { family: 'Categories', folder: 'Folders', workbook: 'Workbooks', block: 'Grids' };
const KIND_ORDER = ['family', 'folder', 'workbook', 'block'];
const FLAT_LIMIT = 300;
const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export default function GroupPicker({ suppliers, supplierId, onSupplierChange }: { suppliers: Supplier[]; supplierId: string; onSupplierChange: (id: string) => void }) {
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''); const [kindFilter, setKindFilter] = useState('all'); const [show, setShow] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string[]>([]);
  const [preferred, setPreferred] = useState(true); const [code, setCode] = useState('');

  const load = useCallback(() => api<{ nodes: GNode[]; links: GLink[] }>('/api/supplier-groups').then(setData).catch(e => setErr(e.message || 'Could not load groups')), []);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => suppliers.filter(s => s.is_active), [suppliers]);
  useEffect(() => { if (!supplierId && active.length === 1) onSupplierChange(active[0].id); }, [active, supplierId, onSupplierChange]);
  useEffect(() => { setMsg(''); }, [supplierId]);
  const supplier = active.find(s => s.id === supplierId);

  /* ── lookups ── */
  const model = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const byId = new Map<string, GNode>(nodes.map(n => [n.id, n]));
    const kids = new Map<string | null, GNode[]>();
    for (const n of nodes) { const p = n.parentId && byId.has(n.parentId) ? n.parentId : null; const a = kids.get(p); if (a) a.push(n); else kids.set(p, [n]); }
    const ancestors = (id: string) => { const out: GNode[] = []; let p = byId.get(id)?.parentId; let g = 0; while (p && byId.has(p) && g++ < 64) { const n = byId.get(p)!; out.push(n); p = n.parentId; } return out; };
    const descendants = (id: string) => { const out: string[] = []; const stack = [id]; while (stack.length) { for (const k of kids.get(stack.pop()!) ?? []) { out.push(k.id); stack.push(k.id); } } return out; };
    const path = new Map<string, string>(); for (const n of nodes) path.set(n.id, ancestors(n.id).reverse().map(a => a.name).join(' › '));
    const linksByNode = new Map<string, GLink[]>(); for (const l of data?.links ?? []) { const a = linksByNode.get(l.node_id); if (a) a.push(l); else linksByNode.set(l.node_id, [l]); }
    const expandable = nodes.filter(n => (kids.get(n.id)?.length ?? 0) > 0).map(n => n.id);
    const kindsPresent = KIND_ORDER.filter(k => nodes.some(n => n.kind === k));
    return { nodes, byId, kids, ancestors, descendants, path, linksByNode, expandable, kindsPresent };
  }, [data]);

  const selSet = useMemo(() => new Set(sel), [sel]);
  const coveredBy = (id: string) => model.ancestors(id).find(a => selSet.has(a.id));
  const ownLink = (id: string) => supplierId ? (model.linksByNode.get(id) ?? []).find(l => l.supplier_id === supplierId) : undefined;
  const viaNode = (id: string) => supplierId ? model.ancestors(id).find(a => (model.linksByNode.get(a.id) ?? []).some(l => l.supplier_id === supplierId)) : undefined;

  /* ── selection ── */
  const prune = (ids: string[]) => { const s = new Set(ids); return ids.filter(id => !model.ancestors(id).some(a => s.has(a.id))); };   // a ticked folder already covers what is inside it
  function toggle(id: string) { setMsg(''); setSel(cur => cur.includes(id) ? cur.filter(x => x !== id) : prune([...cur.filter(x => !model.descendants(id).includes(x)), id])); }
  function drop(id: string) { setSel(cur => cur.filter(x => x !== id)); }

  /* ── what to show ── */
  const q = query.trim().toLowerCase();
  const flat = q !== '' || kindFilter !== 'all' || show !== 'all';
  const flatRows = useMemo(() => {
    if (!flat) return [];
    const words = q.split(/\s+/).filter(Boolean);
    return model.nodes.filter(n => {
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (show !== 'all') { const linked = !!ownLink(n.id) || !!viaNode(n.id); if ((show === 'linked') !== linked) return false; }
      if (!words.length) return true;
      const hay = (n.name + ' ' + (model.path.get(n.id) ?? '')).toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }, [flat, q, kindFilter, show, model, supplierId, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const flatShown = flatRows.slice(0, FLAT_LIMIT);

  const treeRows = useMemo(() => {
    if (flat) return [];
    const out: { n: GNode; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => { for (const n of model.kids.get(parent) ?? []) { out.push({ n, depth }); if (open.has(n.id)) walk(n.id, depth + 1); } };
    walk(null, 0); return out;
  }, [flat, model, open]);

  const selectableShown = flatShown.filter(n => !coveredBy(n.id));
  const allShownSelected = selectableShown.length > 0 && selectableShown.every(n => selSet.has(n.id));
  function toggleAllShown() {
    setMsg('');
    if (allShownSelected) { const drop = new Set(selectableShown.map(n => n.id)); setSel(cur => cur.filter(id => !drop.has(id))); }
    else setSel(cur => { const next = [...cur]; for (const n of selectableShown) if (!next.includes(n.id)) next.push(n.id); return prune(next); });
  }

  /* ── actions ── */
  async function link() {
    if (!supplier || !sel.length) return; setBusy(true); setErr(''); setMsg('');
    try {
      await api('/api/supplier-assign', { method: 'POST', body: JSON.stringify({ supplierId, nodeIds: sel, preferred, supplierProductCode: code.trim() || undefined }) });
      setMsg(`Linked ${plural(sel.length, 'group', 'groups')} to ${supplier.supplier_name}${preferred ? ' as the preferred supplier' : ''}.`);
      setSel([]); setCode(''); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function unlink(l: GLink) {
    setErr(''); setMsg('');
    try { await api('/api/supplier-assign', { method: 'DELETE', body: JSON.stringify({ linkIds: [l.id] }) }); setMsg(`Removed ${l.supplier_name} from ${model.byId.get(l.node_id)?.name ?? 'the group'}.`); await load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function setPref(l: GLink, value: boolean) {
    setErr(''); setMsg('');
    try { await api('/api/supplier-assign', { method: 'POST', body: JSON.stringify({ supplierId: l.supplier_id, nodeIds: [l.node_id], preferred: value, supplierProductCode: l.supplier_product_code || undefined }) }); await load(); }
    catch (e: any) { setErr(e.message); }
  }

  const myLinks = useMemo(() => (data?.links ?? []).filter(l => l.supplier_id === supplierId).sort((a, b) => (model.path.get(a.node_id) + ' › ' + model.byId.get(a.node_id)?.name).localeCompare(model.path.get(b.node_id) + ' › ' + model.byId.get(b.node_id)?.name)), [data, supplierId, model]);
  const countFor = (sid: string) => (data?.links ?? []).filter(l => l.supplier_id === sid).length;

  /* ── rendering ── */
  function renderRow(n: GNode, depth: number) {
    const [kindLabel, icon] = KIND[n.kind] ?? [n.kind, 'folder'];
    const hasKids = (model.kids.get(n.id)?.length ?? 0) > 0;
    const cover = coveredBy(n.id); const checked = selSet.has(n.id) || !!cover;
    const own = ownLink(n.id); const via = !own ? viaNode(n.id) : undefined;
    const prefOther = (model.linksByNode.get(n.id) ?? []).find(l => l.is_preferred && l.supplier_id !== supplierId);
    const where = flat ? model.path.get(n.id) : '';
    return (
      <li key={n.id}>
        <div className={`${css.row} ${checked ? (cover ? css.covered : css.on) : ''}`} style={{ ['--d' as any]: flat ? 0 : depth }}>
          {!flat && hasKids
            ? <button type="button" className={css.exp} aria-expanded={open.has(n.id)} aria-label={`${open.has(n.id) ? 'Close' : 'Open'} ${n.name}`} onClick={() => setOpen(o => { const x = new Set(o); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })}><Ico n="chevron" className={css.chev} /></button>
            : <span className={css.expSpace} />}
          <label className={css.pick} title={cover ? `Included through ${cover.name}` : undefined}>
            <input type="checkbox" checked={checked} disabled={!!cover} onChange={() => toggle(n.id)} />
            <Ico n={icon} className={css.kind} />
            <span className={css.txt}>
              <span className={css.name}>{n.name}</span>
              <span className={css.meta}>{kindLabel} · {n.lenses > 0 ? plural(n.lenses, 'lens', 'lenses') : 'no lenses'}{where ? ` · in ${where}` : ''}</span>
            </span>
          </label>
          <span className={css.tags}>
            {cover && <span className={css.note}>Inside selected {cover.name}</span>}
            {own && (own.is_preferred ? <Badge tone="ok">Preferred</Badge> : <Badge tone="info">Linked</Badge>)}
            {via && <span className={css.note} title={`This supplier is linked on ${via.name}, which covers this group.`}>Covered by {via.name}</span>}
            {prefOther && <span className={css.note} title={`Preferred supplier for this group`}>Preferred: {prefOther.supplier_name}</span>}
          </span>
        </div>
      </li>
    );
  }

  const noSuppliers = active.length === 0;
  return (
    <div className={css.ws}>
      <section className={`card ${css.picker}`} aria-label="Choose groups">
        <div className={css.supplierBar}>
          <label className="field"><span>Supplier</span>
            <select value={supplierId} onChange={e => onSupplierChange(e.target.value)} disabled={noSuppliers} aria-label="Supplier to link">
              <option value="">{noSuppliers ? 'Add a supplier first' : 'Choose a supplier…'}</option>
              {active.map(s => <option key={s.id} value={s.id}>{s.supplier_name}{data ? ` — ${plural(countFor(s.id), 'group', 'groups')}` : ''}</option>)}
            </select>
          </label>
        </div>

        <div className={css.tools}>
          <div className={css.searchRow}>
            <input type="search" className={css.search} aria-label="Search groups" placeholder="Search folders, workbooks and grids by name…" value={query} onChange={e => setQuery(e.target.value)} />
            {!flat && model.expandable.length > 0 && <>
              <button type="button" className="sm" onClick={() => setOpen(new Set(model.expandable))}>Expand all</button>
              <button type="button" className="sm" onClick={() => setOpen(new Set())} disabled={open.size === 0}>Collapse all</button>
            </>}
          </div>
          <div className={css.filters}>
            {model.kindsPresent.length > 1 && <div className={css.filterGroup}><span className={css.filterLabel}>Type</span>
              <div className="pills" role="group" aria-label="Filter by type">
                <button type="button" aria-pressed={kindFilter === 'all'} onClick={() => setKindFilter('all')}>All</button>
                {model.kindsPresent.map(k => <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>{KIND_PLURAL[k] ?? k}</button>)}
              </div></div>}
            {supplier && <div className={css.filterGroup}><span className={css.filterLabel}>Status</span>
              <div className="pills" role="group" aria-label="Filter by link status">
                <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All</button>
                <button type="button" aria-pressed={show === 'linked'} onClick={() => setShow('linked')}>Linked</button>
                <button type="button" aria-pressed={show === 'unlinked'} onClick={() => setShow('unlinked')}>Not linked</button>
              </div></div>}
            {flat && <button type="button" className="link" onClick={() => { setQuery(''); setKindFilter('all'); setShow('all'); }}>Clear filters</button>}
          </div>
        </div>

        <div className={css.bar} aria-live="polite">
          {flat
            ? <label className={css.tick}><input type="checkbox" checked={allShownSelected} disabled={selectableShown.length === 0} onChange={toggleAllShown} /> Select all {fmt(selectableShown.length)} shown</label>
            : <span className={css.count}>{data ? <><b>{fmt(model.nodes.length)}</b> groups. Tick a folder to cover everything inside it.</> : ''}</span>}
          <span className={css.count}>{flat ? `${fmt(flatRows.length)} ${flatRows.length === 1 ? 'match' : 'matches'}` : ''}</span>
        </div>

        <div className={css.list} tabIndex={0} role="region" aria-label="Groups">
          {err && !data && <div className="err small" role="alert" style={{ margin: 12 }}>{err} <button type="button" className="link" onClick={() => { setErr(''); load(); }}>Retry</button></div>}
          {!data && !err && <div className="skel-rows" role="status" aria-label="Loading groups">{[0, 1, 2, 3, 4].map(i => <i key={i} className="skeleton" style={{ opacity: 1 - i * 0.14 }} />)}</div>}
          {data && model.nodes.length === 0 && <div className={css.none}>No groups yet. Import a workbook to create them.</div>}
          {data && flat && flatRows.length === 0 && model.nodes.length > 0 && <div className={css.none}>No group matches. Try fewer words or clear the filters.</div>}
          {data && (flat ? flatShown.length > 0 : treeRows.length > 0) && (
            <ul className={css.ul}>
              {flat ? flatShown.map(n => renderRow(n, 0)) : treeRows.map(r => renderRow(r.n, r.depth))}
            </ul>
          )}
          {flat && flatRows.length > FLAT_LIMIT && <div className={css.none}>Showing the first {FLAT_LIMIT} of {fmt(flatRows.length)}. Type more of the name to narrow it down.</div>}
        </div>
      </section>

      <aside className={`card ${css.side}`} aria-label="Selection and actions">
        {!supplier ? (
          <p className={css.empty}>{noSuppliers ? 'Add a supplier above, then come back to link it to groups.' : 'Choose a supplier on the left to start linking groups.'}</p>
        ) : (<>
          <div>
            <div className={css.sideHead}>
              <h3>{sel.length ? `${plural(sel.length, 'group', 'groups')} selected` : 'Nothing selected yet'}</h3>
              {sel.length > 0 && <button type="button" className="link" onClick={() => setSel([])}>Clear</button>}
            </div>
            {sel.length === 0
              ? <p className={css.help} style={{ marginTop: 6 }}>Tick folders, workbooks or grids in the list. Search to jump straight to one.</p>
              : <ul className={css.chips} style={{ marginTop: 8 }} aria-label="Selected groups">
                {sel.map(id => { const n = model.byId.get(id); if (!n) return null; return (
                  <li key={id} className={css.chip} title={[model.path.get(id), n.name].filter(Boolean).join(' › ')}><span>{n.name}</span>
                    <button type="button" className={css.chipX} aria-label={`Remove ${n.name} from selection`} onClick={() => drop(id)}><Ico n="x" className={css.xi} /></button></li>); })}
              </ul>}
          </div>

          <div className={css.form}>
            <label className="check"><input type="checkbox" checked={preferred} onChange={e => setPreferred(e.target.checked)} /> <span>Make {supplier.supplier_name} the preferred supplier</span></label>
            {preferred && <p className={css.help}>Preferred suppliers are pre-selected on Suggested orders. This replaces any other preferred supplier on the selected groups.</p>}
            <label className="field"><span>Supplier’s product code <span className="mut">(optional, applied to all selected)</span></span><input value={code} maxLength={60} onChange={e => setCode(e.target.value)} /></label>
            <button type="button" className="p" disabled={!sel.length || busy} onClick={link}>{busy ? 'Linking…' : sel.length ? `Link ${plural(sel.length, 'group', 'groups')} to ${supplier.supplier_name}` : 'Select groups to link'}</button>
            {msg && <div className="okmsg msg" role="status">{msg}</div>}
            {err && data && <div className="err msg" role="alert">{err}</div>}
          </div>

          <hr className={css.sep} />
          <div className={css.linked}>
            <div className={css.sideHead}><h3>Linked to {supplier.supplier_name}</h3><span className="mut small">{fmt(myLinks.length)}</span></div>
            {myLinks.length === 0
              ? <p className={css.empty}>No groups linked yet.</p>
              : <ul className={css.linkedList}>
                {myLinks.map(l => { const n = model.byId.get(l.node_id); return (
                  <li key={l.id}>
                    <div className={css.linkedTop}><b>{n?.name ?? 'Unknown group'}</b>{l.is_preferred ? <Badge tone="ok">Preferred</Badge> : <Badge tone="info">Linked</Badge>}{l.supplier_product_code && <span className="mut small">Code {l.supplier_product_code}</span>}</div>
                    {n && model.path.get(n.id) && <span className={css.meta}>in {model.path.get(n.id)}</span>}
                    <div className={css.linkedActions}>
                      <button type="button" className="sm" onClick={() => setPref(l, !l.is_preferred)}>{l.is_preferred ? 'Make not preferred' : 'Make preferred'}</button>
                      <button type="button" className="sm danger" onClick={() => unlink(l)}>Remove</button>
                    </div>
                  </li>); })}
              </ul>}
          </div>
        </>)}
      </aside>
    </div>
  );
}