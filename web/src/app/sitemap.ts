import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Only the public landing page is indexable today. Add new public pages (e.g. guides) here when they are created.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 }];
}