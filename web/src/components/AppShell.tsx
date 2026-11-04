'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import SignOut from './SignOut';
import logo from '../../public/Logo.png'; // web/public/Logo.png

const ICONS: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  inventory: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  stock: <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />,
  counts: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v2H9zM9 13l2 2 4-4" /></>,
  movements: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  suggested: <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.8 6.4 20.1l1.4-6.3L3 9.5l6.4-.6z" />,
  po: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  suppliers: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
  billing: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  reports: <path d="M4 20V10M10 20V4M16 20v-7M2 20h20" />,
  folders: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  import: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  review: <><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  export: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.5 3.5 6" /></>,
  settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
};
const Icon = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[n]}</svg>;

type Item = { href: string; label: string; icon: string; download?: boolean; also?: string[] };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  { title: 'Sales', items: [{ href: '/billing', label: 'Billing', icon: 'billing' }] },
  { title: 'Stock', items: [
    { href: '/inventory', label: 'Inventory', icon: 'inventory', also: ['/blocks'] },
    { href: '/stock', label: 'Receive / Issue / Adjust', icon: 'stock' },
    { href: '/counts', label: 'Stock counts', icon: 'counts' },
    { href: '/movements', label: 'Stock movements', icon: 'movements' },
    { href: '/suggested-orders', label: 'Suggested orders', icon: 'suggested' }] },
  { title: 'Purchasing', items: [
    { href: '/purchase-orders', label: 'Purchase orders', icon: 'po' },
    { href: '/suppliers', label: 'Suppliers', icon: 'suppliers' }] },
  { title: 'Data', items: [
    { href: '/imports', label: 'Import Excel', icon: 'import' },
    { href: '/review', label: 'Data review', icon: 'review' },
    { href: '/catalog', label: 'Folders', icon: 'folders' },
    { href: '/reports', label: 'Reports', icon: 'reports' },
    { href: '/api/export/inventory', label: 'Export all (xlsx)', icon: 'export', download: true }] },
  { title: 'Admin', items: [
    { href: '/users', label: 'Users', icon: 'users' },
    { href: '/settings', label: 'Settings', icon: 'settings' }] },
];

const FOOT: { title: string; links: { href: string; label: string }[] }[] = [
  { title: 'Sales', links: [{ href: '/billing', label: 'Billing' }] },
  { title: 'Stock', links: [
    { href: '/inventory', label: 'Inventory' },
    { href: '/stock', label: 'Receive / Issue / Adjust' },
    { href: '/counts', label: 'Stock counts' },
    { href: '/movements', label: 'Stock movements' }] },
  { title: 'Purchasing', links: [
    { href: '/suggested-orders', label: 'Suggested orders' },
    { href: '/purchase-orders', label: 'Purchase orders' },
    { href: '/suppliers', label: 'Suppliers' }] },
  { title: 'Data & admin', links: [
    { href: '/imports', label: 'Import Excel' },
    { href: '/review', label: 'Data review' },
    { href: '/reports', label: 'Reports' },
    { href: '/settings', label: 'Settings' }] },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/'; const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { if (open) { const h = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); } }, [open]);
  if (path === '/' || path.startsWith('/login')) return <div className="bare"><main>{children}</main></div>;
  const on = (i: Item) => [i.href, ...(i.also ?? [])].some(h => path === h || path.startsWith(h + '/'));
  const cur = GROUPS.flatMap(g => g.items.filter(x => !x.download).map(x => ({ group: g.title, item: x }))).find(x => on(x.item));
  const year = new Date().getFullYear();
  return (<div className="shell">
    <a className="skip" href="#main">Skip to content</a>
    <header className="topbar">
      <div className="topbar-in">
        <button type="button" className="menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(o => !o)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        <span className="brand brand-logo m-brand"><Image src={logo} alt="Royal Opticals" unoptimized className="brand-logo-img" /></span>
        <nav className="hcrumbs" aria-label="Breadcrumb">
          {cur
            ? <><span>{cur.group}</span><span className="sep" aria-hidden="true">/</span><b aria-current="page">{cur.item.label}</b></>
            : <b>Royal Opticals</b>}
        </nav>
        <div className="topbar-actions">
          <Link href="/stock" className="btn sm p" aria-label="Receive / Issue"><Icon n="stock" /><span className="lbl">Receive / Issue</span></Link>
          <Link href="/counts" className="btn sm" aria-label="Stock counts"><Icon n="counts" /><span className="lbl">Stock counts</span></Link>
          <span className="signout"><SignOut /></span>
        </div>
      </div>
    </header>
    <nav className={'sidebar' + (open ? ' open' : '')} aria-label="Main">
      <Link href="/dashboard" className="brand brand-logo" aria-label="Royal Opticals — dashboard"><Image src={logo} alt="Royal Opticals" priority unoptimized className="brand-logo-img" /></Link>
      {GROUPS.map(g => <div className="side-group" key={g.title}><div className="side-title">{g.title}</div>
        {g.items.map(i => i.download
          ? <a key={i.href} className="side-link" href={i.href}><Icon n={i.icon} />{i.label}</a>
          : <Link key={i.href} href={i.href} className={'side-link' + (on(i) ? ' active' : '')} aria-current={on(i) ? 'page' : undefined}><Icon n={i.icon} />{i.label}</Link>)}</div>)}
      <div className="side-foot"><SignOut /></div>
    </nav>
    <div className={'scrim' + (open ? ' open' : '')} onClick={() => setOpen(false)} aria-hidden="true" />
    <main id="main" tabIndex={-1}>{children}</main>
    <footer className="site-foot">
      <div className="site-foot-in">
        <div className="foot-grid">
          <div className="foot-brand">
            <span className="brand brand-logo"><Image src={logo} alt="Royal Opticals" unoptimized className="brand-logo-img" /></span>
            <p>Stock, purchasing and reporting for every lens, in one place.</p>
          </div>
          <nav className="foot-nav" aria-label="Footer">
            {FOOT.map(c => <div key={c.title}><div className="foot-title">{c.title}</div>
              <ul>{c.links.map(l => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul></div>)}
          </nav>
        </div>
        <div className="foot-base">
          <span>© {year} Royal Opticals. All rights reserved.</span>
          <a href="#main" className="to-top">Back to top ↑</a>
        </div>
      </div>
    </footer>
  </div>);
}