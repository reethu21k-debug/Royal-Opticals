'use client';
export default function SignOut() {
  return <button onClick={async () => { await fetch('/api/session', { method: 'DELETE' }); window.location.href = '/login'; }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9" /></svg>Sign out</button>;
}