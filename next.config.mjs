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

  // Der IFC-Import nimmt eine ganze Modelldatei entgegen; das Beispielmodul
  // eines einzigen Raummoduls misst 23 MB. Die Vorgabe von Next 16 liegt bei
  // 10 MB, und sie **schneidet ab, statt abzulehnen**: im Protokoll steht
  // „Only the first 10MB will be available", die Route bekommt einen
  // verstümmelten Körper.
  //
  // Das ist die gefährlichere Hälfte der Vorgabe. Eine gekappte IFC-Datei hat
  // weiterhin einen gültigen Kopf und gültige Bauteile — sie hätte klaglos
  // einen unvollständigen Fertigungsplan erzeugt, dem die späteren
  // Arbeitsschritte fehlen. Gegen genau das prüft `parseIfc` zusätzlich auf
  // den Schlussmarker `END-ISO-10303-21;`; diese Grenze hier sorgt dafür,
  // dass es gar nicht erst dazu kommt.
  //
  // Gefunden beim Hochladen im Browser. Weder Unit- noch Integrationstests
  // konnten es sehen: sie rufen den Domänendienst direkt auf, ohne HTTP.
  //
  // Der Schlüssel heißt `proxyClientMaxBodySize`, nicht
  // `middlewareClientMaxBodySize` — Next 16 hat `middleware` in `proxy`
  // umbenannt (dieses Projekt hat `src/proxy.ts`), und die beiden Namen
  // zugleich zu setzen lehnt der Start ausdrücklich ab. Die Fehlermeldung im
  // Protokoll nennt allerdings weiterhin den alten Namen; wer ihr folgt,
  // bekommt „Unrecognized key".
  //
  // Der Wert liegt über der 128-MB-Grenze aus `import-ifc-plan.ts`, damit
  // eine zu große Datei die dortige, verständliche Meldung bekommt statt
  // wortlos gekappt zu werden.
  experimental: {
    proxyClientMaxBodySize: '160mb',
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
