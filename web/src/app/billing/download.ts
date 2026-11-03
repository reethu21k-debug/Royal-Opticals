// Browser helper: fetches a file from the API and saves it, so a failure shows a readable message instead of a broken download.
export async function downloadFile(url: string, retried = false): Promise<void> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 401 && !retried && (await fetch('/api/session', { method: 'PUT' }).then(x => x.ok).catch(() => false))) return downloadFile(url, true);   // session expired: refresh once, retry
  if (!r.ok) {
    let msg = `download failed (${r.status})`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const m = /filename="?([^";]+)"?/i.exec(r.headers.get('content-disposition') ?? '');
  const href = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = href; a.download = m ? m[1] : 'bills'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}