'use client';
import { useEffect, useState } from 'react';
import { api } from '@/components/api';
import { PageHeader, Badge, Loading } from '@/components/ui';

const ROLES: [string, string, string][] = [
  ['administrator', 'Administrator', 'Everything, including users and settings'],
  ['inventory_manager', 'Inventory manager', 'Approves counts and imports, sets targets'],
  ['inventory_staff', 'Inventory staff', 'Receives, issues and counts stock'],
  ['read_only', 'Read only', 'Can look, cannot change anything'],
];
const roleLabel = (r: string) => ROLES.find(x => x[0] === r)?.[1] ?? r;

export default function Users() {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const load = () => api('/api/users').then(r => setItems(r.items)).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  const [nu, setNu] = useState({ email: '', fullName: '', password: '', role: 'inventory_staff' }); const [msg, setMsg] = useState('');
  async function create() { setErr(''); setMsg(''); try { await api('/api/users', { method: 'POST', body: JSON.stringify(nu) }); setMsg('User created. Share the initial password securely; they should change it.'); setNu({ ...nu, email: '', fullName: '', password: '' }); load(); } catch (e: any) { setErr(e.message); } }
  async function patch(id: string, body: object) { setErr(''); try { await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); load(); } catch (e: any) { setErr(e.message); } }
  const pwShort = nu.password.length > 0 && nu.password.length < 12;
  return (<>
    <PageHeader title="Users and roles" sub="Only administrators can change roles. Every change is written to the audit log." />
    <section className="card" aria-label="New user">
      <h2 className="card-title">Add a user</h2>
      <p className="card-sub">They sign in with this email and the initial password you set.</p>
      <div className="form-grid">
        <label className="field"><span>Full name</span><input aria-label="Full name" value={nu.fullName} onChange={e => setNu({ ...nu, fullName: e.target.value })} /></label>
        <label className="field"><span>Email</span><input aria-label="Email" type="email" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} /></label>
        <label className="field"><span>Initial password</span><input aria-label="Initial password" type="password" autoComplete="new-password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} aria-describedby="pw-hint" />
          <span id="pw-hint" className={'hint' + (pwShort ? ' err' : '')}>At least 12 characters{nu.password ? ` (${nu.password.length} so far)` : ''}.</span></label>
        <label className="field"><span>Role</span><select aria-label="New user role" value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>{ROLES.map(r => <option key={r[0]} value={r[0]}>{r[1]}</option>)}</select>
          <span className="hint">{ROLES.find(r => r[0] === nu.role)?.[2]}</span></label>
      </div>
      <div style={{ marginTop: 14 }}><button className="p" disabled={!nu.email || !nu.fullName || nu.password.length < 12} onClick={create}>Create user</button></div>
    </section>
    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="okmsg" role="status">{msg}</div>}
    <div className="section-title"><h2>Everyone with access</h2>{items && <span className="mut small">{items.length} {items.length === 1 ? 'person' : 'people'}</span>}</div>
    {!items && !err && <Loading rows={4} />}
    {items && <div className="wrap" tabIndex={0} role="region" aria-label="Users"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
      {items.map(u => <tr key={u.id}>
        <td><b>{u.full_name}</b></td>
        <td><select aria-label={`Role for ${u.full_name}`} value={u.role} onChange={e => patch(u.id, { role: e.target.value })}>{ROLES.map(r => <option key={r[0]} value={r[0]}>{r[1]}</option>)}{!ROLES.some(r => r[0] === u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}</select></td>
        <td>{u.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Inactive</Badge>}</td>
        <td className="n"><button className={'sm' + (u.is_active ? ' danger' : '')} onClick={() => patch(u.id, { isActive: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}
    </tbody></table></div>}
  </>);
}
