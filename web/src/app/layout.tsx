import './globals.css';
import AppShell from '@/components/AppShell';
import Preloader from '@/components/Preloader';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Royal Opticals — Lens Inventory', template: '%s | Royal Opticals' },
  applicationName: 'Royal Opticals',
};
// Runs before first paint: if this tab already showed the preloader, hide it immediately so a refresh never flashes it.
const PRELOAD_SEEN = "try{if(sessionStorage.getItem('ro-preloaded'))document.documentElement.classList.add('ro-pre-done')}catch(e){}";
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: PRELOAD_SEEN }} /></head>
      <body><Preloader /><AppShell>{children}</AppShell></body>
    </html>
  );
}