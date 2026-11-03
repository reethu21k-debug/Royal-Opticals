'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/api';
import { PageHeader, Badge, Loading, EmptyState } from '@/components/ui';
import GroupPicker from './GroupPicker';

const BLANK = { supplierName: '', supplierCode: '', contactPerson: '', phone: '', email: '', address: '', notes: '' };
const FIELDS: [keyof typeof BLANK, string, string?][] = [['supplierName', 'Supplier name *'], ['supplierCode', 'Code'], ['contactPerson', 'Contact person'], ['phone', 'Phone'], ['email', 'Email']];

export default function Suppliers() {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [f, setF] = useState<any>(BLANK);
  const [supplierId, setSupplierId] = useState('');
  const assignRef = useRef<HTMLDivElement>(null);
  const load = () => api('/api/suppliers').then(r => setItems(r.items)).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  async function add() { setErr(''); const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')); try { const r = await api('/api/suppliers', { method: 'POST', body: JSON.stringify(body) }); setF(BLANK); if (r?.supplier?.id) setSupplierId(r.supplier.id); load(); } catch (e: any) { setErr(e.message); } }
  async function toggle(s: any) { try { await api(`/api/suppliers/${s.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !s.is_active }) }); if (s.is_active && s.id === supplierId) setSupplierId(''); load(); } catch (e: any) { setErr(e.message); } }
  function assign(s: any) { setSupplierId(s.id); assignRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  return (<>
    <PageHeader title="Suppliers" sub="No supplier data exists in the original files, so only suppliers you add here appear." />
    <section className="card" aria-label="Add a supplier">
      <h2 className="card-title">Add a supplier</h2>
      <div className="form-grid" style={{ marginTop: 10 }}>
        {FIELDS.map(([k, l]) => <label key={k} className="field"><span>{l}</span><input aria-label={l.replace(' *', '')} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
      </div>
      <div style={{ marginTop: 14 }}><button className="p" disabled={!f.supplierName.trim()} onClick={add}>Add supplier</button></div>
    </section>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="section-title"><h2>Your suppliers</h2>{items && <span className="mut small">{items.filter(s => s.is_active).length} active</span>}</div>
    {!items && !err && <Loading rows={3} />}
    {items && (items.length === 0 ? <EmptyState icon="box" title="No suppliers yet">Add your first supplier above to start creating purchase orders.</EmptyState>
      : <div className="wrap" tabIndex={0} role="region" aria-label="Suppliers"><table><thead><tr><th>Name</th><th>Code</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th /></tr></thead><tbody>
        {items.map(s => <tr key={s.id}><td><b>{s.supplier_name}</b></td><td>{s.supplier_code}</td><td>{s.contact_person}</td><td>{s.phone}</td><td>{s.email}</td>
          <td>{s.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="mute">Inactive</Badge>}</td>
          <td className="n"><div style={{ display: 'inline-flex', gap: 8 }}>
            {s.is_active && <button className="sm" onClick={() => assign(s)} aria-label={`Assign groups to ${s.supplier_name}`}>Assign groups</button>}
            <button className="sm" onClick={() => toggle(s)}>{s.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}
      </tbody></table></div>)}

    <div ref={assignRef} className="section-title" style={{ marginTop: 36, scrollMarginTop: 16 }}><h2>Assign suppliers to groups</h2></div>
    <p className="mut" style={{ maxWidth: '75ch' }}>Pick a supplier, then search or open the list and tick every folder, workbook or grid it supplies. A link on a folder applies to everything inside it, unless a nearer folder or a single lens overrides it. The preferred supplier is pre-selected on Suggested orders.</p>
    <GroupPicker suppliers={items ?? []} supplierId={supplierId} onSupplierChange={setSupplierId} />
  </>);
}