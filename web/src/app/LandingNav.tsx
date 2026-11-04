'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import styles from './landing.module.css';
import logo from '../../public/Logo.png'; // web/public/Logo.png (1444 × 418)

const LINKS = [
  ['#services', 'Services'],
  ['#lenses', 'Lenses'],
  ['#process', 'How it works'],
  ['#faq', 'FAQ'],
  ['#visit', 'Visit us'],
] as const;

export default function LandingNav({ loggedIn }: { loggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const staff = loggedIn ? { href: '/dashboard', label: 'Dashboard' } : { href: '/login', label: 'Staff login' };

  return (
    <header className={styles.nav}>
      <div className={styles.wrap + ' ' + styles.navIn}>
        <a href="#top" className={styles.logo} onClick={close} aria-label="Royal Opticals — back to top">
          <Image src={logo} alt="Royal Opticals logo" priority className={styles.logoImg} />
        </a>

        <nav aria-label="Primary" className={styles.links}>
          {LINKS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>

        <div className={styles.navBtns}>
          <Link href={staff.href} className={styles.navStaff}>{staff.label}</Link>
          <a href="#visit" className={styles.btnP + ' ' + styles.sm}>Book a test</a>
        </div>

        <button
          type="button"
          className={styles.burger}
          aria-expanded={open}
          aria-controls="ro-sheet"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen(o => !o)}
        >
          <svg viewBox="0 0 24 24" className={styles.ic} aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </div>

      <div id="ro-sheet" className={styles.sheet + (open ? ' ' + styles.sheetOpen : '')}>
        {LINKS.map(([href, label]) => <a key={href} href={href} onClick={close}>{label}</a>)}
        <Link href={staff.href} onClick={close}>{staff.label}</Link>
      </div>
    </header>
  );
}