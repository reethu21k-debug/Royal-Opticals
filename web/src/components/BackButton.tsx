'use client';
import { useRouter } from 'next/navigation';

/**
 * "← Back" for pages that sit one level deeper (a count, a lens, a power matrix, a bill, a customer's bills).
 * It goes back ONE step in the browser history, i.e. to the exact screen you came from (the folder you were in, the customer you had open …).
 * Only when there is nothing of this app behind it (page opened directly, or the previous entry is the login page) does it go to `fallback`, the level above.
 */
export default function BackButton({ fallback, label = 'Back' }: { fallback: string; label?: string }) {
  const router = useRouter();
  function go() {
    let can = window.history.length > 1;
    try {
      const nav = (window as any).navigation;   // Chromium: look at the real previous entry
      if (nav && typeof nav.entries === 'function') {
        const i = nav.currentEntry?.index ?? -1; const prev = i > 0 ? nav.entries()[i - 1] : null;
        const u = prev ? new URL(prev.url) : null;
        can = !!u && u.origin === window.location.origin && !u.pathname.startsWith('/login');
      }
    } catch { /* keep the history.length answer */ }
    if (can) router.back(); else router.push(fallback);
  }
  return <button type="button" className="sm" onClick={go} style={{ marginBottom: 8 }}>← {label}</button>;
}