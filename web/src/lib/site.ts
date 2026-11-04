/** Single source of truth for public business details used by SEO metadata, JSON-LD, robots and sitemap.
 *  All values below were taken from the landing page's own Visit section. Verify them against the Google Business Profile. */
export const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://royalopticalsatp.com').replace(/\/+$/, '');

export const BUSINESS = {
  name: 'Royal Opticals',
  phoneDisplay: '077991 18511',
  phoneE164: '+917799118511',
  email: 'contact@royalopticalsatp.com',
  address: {
    street: 'Arts College, Shop No09 Police Complex, Road',
    locality: 'Anantapur',
    region: 'Andhra Pradesh',
    postalCode: '515001',
    country: 'IN',
  },
  // Displayed on the site as "Everyday 10 am–9:30 pm".
  hours: { opens: '10:00', closes: '21:30' },
  // Not verified yet — add only once confirmed (omit rather than guess). Leave [] until the real profile URLs exist.
  sameAs: [] as string[],
} as const;

export const ADDRESS_LINE = `${BUSINESS.address.street}, ${BUSINESS.address.locality}, ${BUSINESS.address.region} ${BUSINESS.address.postalCode}`;