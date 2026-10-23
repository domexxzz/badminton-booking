/** @type {import('next').NextConfig} */

// Headers every page and route gets. Deliberately no Content-Security-Policy yet:
// the site loads LINE and Google profile pictures and talks to Supabase Realtime over
// a websocket, so a CSP needs its own change with those origins tested on the live site.
const securityHeaders = [
  // Nobody may frame the site, so a payment page cannot be wrapped by another site.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Never let a browser guess that an uploaded slip is something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A booking id must not leak to another site through the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
