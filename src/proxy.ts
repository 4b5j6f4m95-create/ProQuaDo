import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy with a per-request nonce.
 *
 * ## Why this exists at all
 *
 * The CSP used to live in `next.config.mjs` as a plain `script-src 'self'`,
 * applied only in production. It blocked Next.js' OWN inline scripts — the
 * ones carrying the React Server Components payload and the hydration
 * bootstrap — so the production build did not hydrate. Every console load
 * ended in a wall of CSP violations, React error #423 and "Connection
 * closed", and nothing interactive worked: no PIN dialog, no product release,
 * no offline workspace, no service worker registration.
 *
 * The old comment reasoned that inline scripts are a `next dev` problem and
 * CSP is a production concern. Both halves are true; the conclusion was not.
 * Production Next.js is full of inline scripts too, and nothing exercised
 * that — the CSP is off in development, so the entire test chain (typecheck,
 * unit, integration, `next build`) ran without it ever applying. It surfaced
 * the first time somebody ran `pnpm run start`.
 *
 * ## Why a nonce rather than 'unsafe-inline'
 *
 * `'unsafe-inline'` would work in one line and give up most of what a CSP is
 * for — an injected `<script>` would execute like any other. A nonce is the
 * mechanism Next.js supports for exactly this: when the request carries a
 * CSP with a nonce, Next stamps that nonce onto the scripts it emits, so its
 * own bootstrap runs and anything injected later does not.
 *
 * `'strict-dynamic'` lets those nonced scripts load the chunks they need
 * without every chunk URL having to be listed. Modern browsers ignore
 * `'self'` next to it; it is kept for browsers that do not understand
 * `strict-dynamic` and would otherwise fall back to nothing.
 *
 * ## Why it stays off in development
 *
 * `next dev` uses eval-based HMR, which no nonce helps with. The choice from
 * the earlier phase is unchanged and still right — what changes is that
 * production is now actually usable.
 *
 * ## Warum die Datei `proxy.ts` heißt
 *
 * Next 16 hat die `middleware`-Konvention zu `proxy` umbenannt (Dateiname und
 * benannter Export). Die alte Form wird noch verstanden, ist aber deprecated.
 * Inhaltlich ändert sich nichts: dieselbe Funktion, derselbe `matcher`,
 * dieselbe Nonce. Ein Unterschied ist zu beachten — `proxy` läuft
 * ausschließlich in der Node.js-Laufzeit, die `edge`-Laufzeit steht dort nicht
 * zur Verfügung. Für diesen Code ist das folgenlos: er benutzt nur
 * `crypto.getRandomValues`, `btoa` und `URL`.
 */

export function proxy(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  // `form-action` must include the OIDC issuer origin: the login flow
  // navigates the browser to the IdP's authorization endpoint, which is
  // cross-origin by definition (ADR-001 keeps the issuer configurable, so
  // this is derived from config rather than written as a literal domain).
  const issuerOrigin = process.env.OIDC_ISSUER ? new URL(process.env.OIDC_ISSUER).origin : "'self'";

  // `connect-src` muss den Objektspeicher einschließen: Fotos und Dokumente
  // lädt der BROWSER mit einer presignierten URL direkt dorthin, am
  // Anwendungsserver vorbei (ADR-003). Liegt der Speicher auf einer anderen
  // Origin — der Normalfall, und in der Entwicklung ebenso —, blockiert
  // `'self'` allein jeden Upload. Wie die fehlende Nonce war das ein Fehler,
  // den nur ein Production-Lauf zeigt; gefunden hat ihn
  // test/e2e/document-upload.spec.ts.
  const storageOrigins = objectStorageOrigins();

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline styles stay allowed: React sets them for layout, and a style
    // cannot execute. The threat CSP addresses here is script injection.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    ['connect-src', "'self'", ...storageOrigins].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self' ${issuerOrigin}`,
  ].join('; ');

  // Next.js reads the nonce out of the CSP on the REQUEST headers. Setting it
  // only on the response would leave its own scripts unnonced — which is
  // precisely the state this proxy exists to end.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Die Origin(s), an die eine presignierte Upload-URL zeigen kann — abgeleitet
 * aus derselben Konfiguration, aus der `object-storage.ts` seinen Client baut,
 * damit hier keine zweite Wahrheit entsteht.
 *
 * Ohne `S3_ENDPOINT` (echtes AWS) bildet das SDK den Host aus Region und
 * Bucket; beide möglichen Formen werden aufgenommen, weil die Wahl zwischen
 * ihnen an `S3_FORCE_PATH_STYLE` hängt. Eine Origin zu viel in `connect-src`
 * ist harmlos — eine zu wenig heißt: keine Fotos aus der Halle.
 */
function objectStorageOrigins(): string[] {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (endpoint) {
    try {
      return [new URL(endpoint).origin];
    } catch {
      // Unbrauchbarer Endpunkt: nichts hinzufügen. Der Upload scheitert dann
      // sichtbar, statt dass eine kaputte CSP alles andere mitreißt.
      return [];
    }
  }

  const region = process.env.S3_REGION ?? 'us-east-1';
  const bucketName = process.env.S3_BUCKET;
  const origins = [`https://s3.${region}.amazonaws.com`];
  if (bucketName) origins.push(`https://${bucketName}.s3.${region}.amazonaws.com`);
  return origins;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets: they are served straight from disk,
     * carry no inline script, and a per-request nonce on them would only
     * defeat caching.
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js).*)',
  ],
};
