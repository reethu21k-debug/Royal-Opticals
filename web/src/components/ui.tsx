import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtPower } from '@/lib/power-format';

/* ───────── icons (one stroke style, 24px grid) ───────── */
const PATHS: Record<string, ReactNode> = {
  download: <path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" />,
  upload: <path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  grid: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16zM14 6l4 4" />,
  chevdown: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  box: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v2H9zM9 13l2 2 4-4" /></>,
  file: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  print: <><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="7" y="14" width="10" height="7" rx="1" /></>,
};
export function Ico({ n, className }: { n: keyof typeof PATHS | string; className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? 'ic'}>{PATHS[n]}</svg>;
}

/* ───────── page header: breadcrumbs → title (+ badge) → one-line purpose → actions ───────── */
export type Crumb = { label: string; href?: string };
export function PageHeader({ title, sub, crumbs, actions, badge }: { title: ReactNode; sub?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && <span className="sep" aria-hidden="true">/</span>}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}{badge}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/* ───────── badges ───────── */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute' | 'acc' | '';
export const Badge = ({ tone = '', children, title }: { tone?: Tone; children: ReactNode; title?: string }) =>
  <span className={'badge' + (tone ? ' b-' + tone : '')} title={title}>{children}</span>;

// Friendly labels + tones for the raw status strings the API returns (unknown values fall back to a tidied version of the raw text)
const tidy = (s: string) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const MAPS: Record<string, Record<string, [string, Tone]>> = {
  po: { draft: ['Draft', 'mute'], confirmed: ['Confirmed', 'info'], partially_received: ['Partly received', 'warn'], received: ['Received', 'ok'], closed: ['Closed', 'mute'], cancelled: ['Cancelled', 'bad'] },
  import: { staged: ['Waiting for approval', 'warn'], imported: ['Imported', 'ok'], rolled_back: ['Rolled back', 'mute'], failed: ['Failed', 'bad'], approved: ['Imported', 'ok'] },
  record: { imported: ['Imported', 'ok'], held: ['Held for review', 'warn'], staged: ['Staged', 'mute'], skipped: ['Skipped', 'mute'], rolled_back: ['Rolled back', 'mute'] },
  severity: { HIGH: ['High', 'bad'], MEDIUM: ['Medium', 'warn'], LOW: ['Low', 'mute'], INFO: ['Info', 'info'] },
  review: { open: ['Open', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], needs_info: ['Needs info', 'info'] },
  movement: { opening_count: ['Opening count', 'mute'], receipt: ['Received', 'ok'], issue: ['Issued', 'warn'], adjustment: ['Adjusted', 'info'], reversal: ['Reversal', 'bad'] },
};
export const label = (kind: keyof typeof MAPS, v: string | null | undefined) => (v ? (MAPS[kind][v]?.[0] ?? tidy(v)) : '');
export function StatusPill({ kind, value }: { kind: keyof typeof MAPS; value: string | null | undefined }) {
  if (!value) return null; const [l, t] = MAPS[kind][value] ?? [tidy(value), 'mute' as Tone];
  return <Badge tone={t}>{l}</Badge>;
}
export const MOVEMENT_TYPES = Object.entries(MAPS.movement).map(([k, v]) => [k, v[0]] as const);
export const REVIEW_STATUSES = Object.entries(MAPS.review).map(([k, v]) => [k, v[0]] as const);

/* ───────── states: empty / loading / error ───────── */
export function EmptyState({ icon = 'search', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="card empty"><Ico n={icon} /><b>{title}</b>{children && <span>{children}</span>}{action}</div>;
}
export function Loading({ rows = 5, label = 'Loading' }: { rows?: number; label?: string }) {
  return <div className="card" role="status" aria-live="polite" aria-label={label} style={{ padding: 0 }}><div className="skel-rows">{Array.from({ length: rows }, (_, i) => <i key={i} className="skeleton" style={{ opacity: 1 - i * 0.12 }} />)}</div><span className="sr">{label}…</span></div>;
}
export const ErrorNote = ({ children }: { children: ReactNode }) => <div className="err" role="alert">{children}</div>;
export const Note = ({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'bad' | 'ok' | ''; icon?: string; children: ReactNode }) =>
  <div className={'note' + (tone ? ' ' + tone : '')} role={tone === 'bad' || tone === 'warn' ? 'note' : undefined}>{icon && <Ico n={icon} />}<div>{children}</div></div>;

/* ───────── lens label: "−2.00 × −0.50" ───────── */
export function Lens({ row, col }: { row?: string | null; col?: string | null }) {
  return <span className="lens"><code>{row == null ? '—' : fmtPower(row)}</code>{col ? <><span className="x" aria-hidden="true">×</span><span className="sr"> by </span><code>{fmtPower(col)}</code></> : null}</span>;
}