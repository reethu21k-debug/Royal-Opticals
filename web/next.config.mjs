// Development needs 'unsafe-eval' (React Fast Refresh / webpack) and a websocket for hot reload; production stays strict.
const dev = process.env.NODE_ENV !== 'production';
const csp = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`, "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true, poweredByHeader: false, images: { formats: ['image/avif', 'image/webp'] }, experimental: { serverComponentsExternalPackages: ['pg', 'exceljs', 'pdfkit'] },
  async headers() { return [
    { source: '/:section(login|dashboard|inventory|blocks|stock|counts|movements|suggested-orders|purchase-orders|suppliers|billing|catalog|reports|imports|review|users|settings)/:rest*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    { source: '/:path*', headers: [
    { key: 'Content-Security-Policy', value: csp }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] }]; },
};
