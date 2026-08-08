/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];

    // Next.js dev mode injects inline scripts and uses eval-based HMR that
    // a strict CSP blocks outright (breaks React hydration itself, not
    // just a cosmetic warning) — CSP is a production hardening concern
    // (masterprompt.md Kap. 16), not something to fight in `next dev`.
    if (process.env.NODE_ENV !== 'production') {
      return [{ source: '/:path*', headers: baseHeaders }];
    }

    // `form-action` must include the OIDC issuer origin: the login flow
    // navigates the browser to the IdP's authorization endpoint, which is
    // cross-origin by definition (see ADR-001 — issuer is not hardcoded to
    // one provider, so this is derived from config, not a literal domain).
    const issuerOrigin = process.env.OIDC_ISSUER
      ? new URL(process.env.OIDC_ISSUER).origin
      : "'self'";

    return [
      {
        source: '/:path*',
        headers: [
          ...baseHeaders,
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              `form-action 'self' ${issuerOrigin}`,
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
