import './globals.css';
import AppShell from '@/components/AppShell';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Royal Opticals — Lens Inventory', template: '%s | Royal Opticals' },
  applicationName: 'Royal Opticals',
};
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en-IN"><body><AppShell>{children}</AppShell></body></html>);
}