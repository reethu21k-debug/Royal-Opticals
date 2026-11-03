import Link from 'next/link';
import { REPORTS } from '@/lib/reports';
import { PageHeader } from '@/components/ui';
export default function Reports() {
  return (<>
    <PageHeader title="Reports" sub="All reports use the same definitions as the dashboard. “Not recorded” is never mixed with “zero”." />
    <div className="report-grid">
      {Object.entries(REPORTS).map(([k, r]) => (
        <Link key={k} href={`/reports/${k}`} className="card report"><b>{r.title}</b>{r.note && <span>{r.note}</span>}</Link>
      ))}
    </div>
  </>);
}
