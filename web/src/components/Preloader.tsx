'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import logo from '../../public/Logo.png'; // web/public/Logo.png
import s from './preloader.module.css';

// First-visit splash: white screen, centred logo, smooth progress bar. Shown once per browser tab session — never again on refresh or page changes.
// The "seen" flag lives in sessionStorage; layout.tsx reads it in an inline <head> script so a returning page never flashes the splash.
const KEY = 'ro-preloaded';
const MIN_MS = 1800;   // shortest time the splash stays up, so the animation always reads as smooth

export default function Preloader() {
  const [gone, setGone] = useState(false);
  const [out, setOut] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    let seen = false;
    try { seen = !!sessionStorage.getItem(KEY); } catch { /* storage blocked: treat as first visit */ }
    if (seen) { html.classList.add('ro-pre-done'); setGone(true); return; }

    const remember = () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
    window.addEventListener('pagehide', remember);   // a refresh mid-animation also counts as "seen"

    const t0 = performance.now();
    let raf = 0, p = 0, from = 0, finishAt = 0, finishing = false;
    let ready = document.readyState === 'complete';
    const onLoad = () => { ready = true; };
    if (!ready) window.addEventListener('load', onLoad);
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = () => {
      timers.push(setTimeout(() => setOut(true), 180));                  // hold the full bar for a beat
      timers.push(setTimeout(() => { remember(); html.classList.add('ro-pre-done'); setGone(true); }, 950));
    };
    const tick = (now: number) => {
      const t = now - t0;
      if (!finishing && ready && t >= MIN_MS) { finishing = true; finishAt = now; from = p; }
      if (finishing) {
        const k = Math.min(1, (now - finishAt) / 450);
        p = from + (1 - from) * (1 - Math.pow(1 - k, 3));                 // ease-out to 100%
        if (bar.current) bar.current.style.transform = `scaleX(${p})`;
        if (k >= 1) { finish(); return; }
      } else {
        p = Math.max(p, 0.9 * (1 - Math.exp(-t / 650)));                  // eased creep toward ~90% while the page loads
        if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf); timers.forEach(clearTimeout);
      window.removeEventListener('load', onLoad); window.removeEventListener('pagehide', remember);
    };
  }, []);

  if (gone) return null;
  return (
    <div className={`${s.root}${out ? ' ' + s.out : ''}`} role="status" aria-live="polite" aria-label="Loading Royal Opticals">
      <div className={s.mark}>
        <Image src={logo} alt="Royal Opticals" priority sizes="260px" className={s.logo} />
      </div>
      <div className={s.track} aria-hidden="true">
        <div ref={bar} className={s.fill} />
      </div>
    </div>
  );
}