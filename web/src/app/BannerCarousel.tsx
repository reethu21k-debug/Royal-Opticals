'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './landing.module.css';

/* Banners are imported (not served from /public), so Next bundles them and serves them
   from /_next/static/media — they can't be blocked by middleware or path typos.
   The 5 PNGs live in web/public/banners (this file is web/src/app). Each is 2172 × 724. */
import b1 from '../../public/banners/Royal_Opticals_1.png';
import b2 from '../../public/banners/Royal_Opticals_2.png';
import b3 from '../../public/banners/Royal_Opticals_3.png';
import b4 from '../../public/banners/Royal_Opticals_4.png';
import b5 from '../../public/banners/Royal_Opticals_5.png';

const BANNERS = [b1, b2, b3, b4, b5].map((img, k) => ({ img, alt: `Royal Opticals banner ${k + 1}` }));
const INTERVAL = 5000; // ms between automatic transitions

export default function BannerCarousel() {
  const n = BANNERS.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);     // mouse hover or keyboard focus inside
  const [hidden, setHidden] = useState(false); // browser tab not visible
  const startX = useRef<number | null>(null);

  const go = useCallback((to: number) => setI(((to % n) + n) % n), [n]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!playing || held || hidden) return;
    const t = setTimeout(() => setI(c => (c + 1) % n), INTERVAL);
    return () => clearTimeout(t);
  }, [i, playing, held, hidden, n]);

  return (
    <section
      className={styles.banner}
      aria-roledescription="carousel"
      aria-label="Royal Opticals featured banners"
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHeld(true); }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHeld(false); }}
      onFocus={e => { if (e.target.matches(':focus-visible')) setHeld(true); }}
      onBlur={() => setHeld(false)}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') go(i - 1);
        if (e.key === 'ArrowRight') go(i + 1);
      }}
    >
      <div
        className={styles.bannerView}
        onTouchStart={e => { startX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (startX.current === null) return;
          const dx = e.changedTouches[0].clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1);
        }}
      >
        <div className={styles.bannerTrack} style={{ transform: `translate3d(-${i * 100}%,0,0)` }} aria-live={playing && !held ? 'off' : 'polite'}>
          {BANNERS.map((b, k) => (
            <div
              key={b.alt}
              className={styles.bannerSlide}
              role="group"
              aria-roledescription="slide"
              aria-label={`${k + 1} of ${n}`}
              aria-hidden={k !== i}
            >
              <Image src={b.img} alt={b.alt} sizes="(min-width: 1920px) 1920px, 100vw" unoptimized priority={k === 0} />
            </div>
          ))}
        </div>

        <button type="button" className={styles.arrow + ' ' + styles.arrowL} aria-label="Previous banner" onClick={() => go(i - 1)}>
          <svg viewBox="0 0 24 24" className={styles.ic} aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button type="button" className={styles.arrow + ' ' + styles.arrowR} aria-label="Next banner" onClick={() => go(i + 1)}>
          <svg viewBox="0 0 24 24" className={styles.ic} aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div className={styles.bannerBar}>
        <div className={styles.dots}>
          {BANNERS.map((b, k) => (
            <button
              key={b.alt}
              type="button"
              className={styles.dot + (k === i ? ' ' + styles.dotOn : '')}
              aria-label={`Show banner ${k + 1}`}
              aria-current={k === i}
              onClick={() => go(k)}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.pp}
          aria-label={playing ? 'Pause automatic rotation' : 'Start automatic rotation'}
          onClick={() => setPlaying(p => !p)}
        >
          <svg viewBox="0 0 24 24" className={styles.ic} aria-hidden="true">
            {playing ? <path d="M9 6v12M15 6v12" /> : <path d="M8 5.5v13l11-6.5z" />}
          </svg>
        </button>
      </div>
    </section>
  );
}