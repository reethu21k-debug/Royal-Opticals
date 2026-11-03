'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import styles from './login.module.css';
import logo from '../../../public/Logo.png'; // web/public/Logo.png (1444 × 418)

// Portrait artwork in web/public/login/ (login1 1086×1448, login2 1025×1534, login3 941×1672).
// Each image is scaled to fill the panel and anchored to the TOP, so the "Royal Opticals" logo is never cut — only a sliver of the bottom (login2/3) or the far right edge (login1) can be trimmed.
const SLIDES = [
  { src: '/login/login1.png', pos: 'topLeft' },
  { src: '/login/login2.png', pos: 'top' },
  { src: '/login/login3.png', pos: 'top' },
];
export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [slide, setSlide] = useState(0); const [show, setShow] = useState(false); const [caps, setCaps] = useState(false); const [hello, setHello] = useState('');
  const nextUrl = () => { const n = new URLSearchParams(window.location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') && n !== '/' ? n : '/dashboard'; };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('e')) {   // the server rejected our session: clear it and stay here (no auto-redirect => no loop)
      fetch('/api/session', { method: 'DELETE' }).catch(() => undefined); setErr('Your session was rejected by the server. Please sign in again. If this keeps happening, check SUPABASE_URL / SUPABASE_JWT_SECRET in the server settings.'); return;
    }
    fetch('/api/session', { method: 'PUT' }).then(r => { if (r.ok) window.location.href = nextUrl(); }).catch(() => undefined);   // silent re-login via refresh cookie
  }, []);
  useEffect(() => { const h = new Date().getHours(); setHello(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'); }, []);   // greeting is set after mount so server and browser markup always match
  useEffect(() => {   // gentle cross-fade between the artwork; stays on the first image for people who prefer reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setSlide(i => (i + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (r.ok) window.location.href = nextUrl(); else { setErr((await r.json().catch(() => ({}))).error || 'login failed'); setBusy(false); }
  }

  return (<div className={styles.page}><div className={styles.shell}>
    {/* ───── artwork (decorative) ───── */}
    <aside className={styles.art} aria-hidden="true">
      <div className={styles.stage}>
        {SLIDES.map(({ src, pos }, i) => (
          <div key={src} className={styles.slide + (i === slide ? ' ' + styles.on : '')}>
            <div className={styles.bg} style={{ backgroundImage: `url(${src})` }} />
            <div className={styles.fg}><Image src={src} alt="" fill priority sizes="(max-width: 760px) 100vw, 50vw" className={styles[pos]} /></div>
          </div>
        ))}
      </div>
      <div className={styles.cap}>
        <div><b>Royal Opticals</b><p>Stock, orders and reports — all in one place.</p></div>
        <div className={styles.dots}>{SLIDES.map((_, i) => <span key={i} className={i === slide ? styles.on : ''} />)}</div>
      </div>
    </aside>

    {/* ───── sign-in ───── */}
    <section className={styles.formSide}><div className={styles.formIn}>
      <div className={styles.top}>
        <div className={styles.logo}>
          <Image src={logo} alt="Royal Opticals — lens inventory" priority unoptimized style={{ height: 44, width: 'auto' }} />
        </div>
        <span className={styles.pill}><i aria-hidden="true" />Staff portal</span>
      </div>
      <p className={styles.eyebrow}>{hello || 'Staff sign-in'}</p>
      <h1 className={styles.h1}>Welcome <em>back</em></h1>
      <p className={styles.sub}>Sign in with the email and password your administrator gave you.</p>

      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="email">Email address</label>
          <div className={styles.inputWrap}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
            <input id="email" type="email" autoComplete="username" required autoFocus placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <div className={styles.inputWrap}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={password}
              onChange={e => setPassword(e.target.value)} onKeyUp={e => setCaps(e.getModifierState('CapsLock'))} onKeyDown={e => setCaps(e.getModifierState('CapsLock'))} onBlur={() => setCaps(false)} />
            <button type="button" className={styles.eye} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(v => !v)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{show
                ? <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.5A17 17 0 0 0 2 12s3.6 6 10 6a9.6 9.6 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
                : <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}</svg>
            </button>
          </div>
          {caps && <p className={styles.hint} role="status">Caps Lock is on</p>}
        </div>

        {err && <div className={styles.err} role="alert"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16h.01" /></svg><span>{err}</span></div>}

        <button className={styles.submit} disabled={busy}>
          {busy
            ? <><span className={styles.spin} aria-hidden="true" />Signing in…</>
            : <>Sign in<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}
        </button>
      </form>

      <p className={styles.note}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>Forgot your password? Ask your administrator to reset it.</p>
      <div className={styles.foot}>
        <a href="/" className={styles.back}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Back to website</a>
        <span className={styles.secure}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Secure sign-in</span>
      </div>
    </div></section>
  </div></div>);
}