import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // Staff-only inventory system: nothing here should be crawled. /login is deliberately NOT listed: it carries a noindex header,
      // which crawlers can only see if they are allowed to fetch it.
      disallow: ['/api/', '/dashboard', '/inventory', '/blocks', '/stock', '/counts', '/movements', '/suggested-orders',
        '/purchase-orders', '/suppliers', '/billing', '/catalog', '/reports', '/imports', '/review', '/users', '/settings'],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}