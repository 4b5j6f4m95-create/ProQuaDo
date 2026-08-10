/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfkit reads its standard-font metrics (Helvetica.afm and friends) from
  // disk at runtime. Next.js' server bundling rewrites the module but does
  // not carry those data files along, so the first export died with
  // `ENOENT ... .next/server/vendor-chunks/data/Helvetica.afm`. Leaving the
  // package external makes it resolve from node_modules, where its data
  // sits next to it.
  //
  // Not caught by typecheck, by the integration tests (Jest resolves from
  // node_modules and never bundles) or by `next build` (it is a runtime
  // file read, not a compile step). Only opening the page finds it — the
  // same shape of problem as the pino-pretty entry in notes.md.
  //
  // In Next 15 heißt der Schlüssel `serverExternalPackages` und steht nicht
  // mehr unter `experimental` — die Funktion ist dieselbe, sie gilt jetzt als
  // stabil.
  serverExternalPackages: ['pdfkit', 'archiver'],

  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // The Content-Security-Policy is NOT set here. It needs a per-request
  // nonce so that Next.js' own inline scripts (the RSC payload, the
  // hydration bootstrap) are allowed while injected ones are not, and a
  // static header cannot carry one — see src/proxy.ts, which also records
  // what the previous static `script-src 'self'` did to the production
  // build.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
