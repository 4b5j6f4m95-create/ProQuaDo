import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guards the one thing a user-supplied outbound URL is dangerous for:
 * making this server issue requests on somebody's behalf into places they
 * cannot reach themselves (SSRF).
 *
 * A webhook endpoint is configured by an administrator, so this is not a
 * defence against a stranger. It is a defence against the administrator
 * account being the most useful thing an attacker can take: with an
 * unchecked URL, "register a webhook" becomes "read the cloud metadata
 * service" or "POST into the internal network", and the payload lands
 * wherever they say.
 *
 * The check resolves the host and inspects the ADDRESS, not the name.
 * Rejecting "localhost" by string is theatre — `127.0.0.1.nip.io` and a
 * thousand other names resolve to loopback.
 *
 * ## What this deliberately does not solve
 *
 * DNS can answer differently between this check and the request that
 * follows (DNS rebinding). Closing that needs the connection pinned to the
 * address that was checked, which Node's fetch does not offer without a
 * custom agent. Recorded in ADR-008 rather than papered over: the window is
 * narrow, the configuration is administrative, and the alternative is a
 * hand-rolled HTTP client in an integration path.
 */

export type UrlRejection =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'INSECURE_SCHEME_IN_PRODUCTION'
  | 'UNRESOLVABLE_HOST'
  | 'PRIVATE_ADDRESS';

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
  detail?: string;
}

/**
 * True for addresses that must never be reachable through a configured
 * webhook: loopback, link-local (which is where cloud metadata services
 * live), private ranges, and the unspecified address.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number, number, number];
    if (a === 0 || a === 127) return true; // unspecified, loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local — cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    // IPv4-mapped (::ffff:10.0.0.1) hides a v4 address inside a v6 literal.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    if (normalized.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(normalized)) return true; // unique local
    return false;
  }

  // Not an address at all — the caller resolved something odd; refuse.
  return true;
}

export async function checkWebhookUrl(
  rawUrl: string,
  options: { requireHttps?: boolean } = {},
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'INVALID_URL', detail: 'Die URL ist nicht lesbar.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'UNSUPPORTED_SCHEME',
      detail: `Nur http und https sind zulässig (angegeben: ${url.protocol}).`,
    };
  }

  const requireHttps = options.requireHttps ?? process.env.NODE_ENV === 'production';
  if (requireHttps && url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'INSECURE_SCHEME_IN_PRODUCTION',
      detail:
        'In Produktion sind nur https-Endpunkte zulässig — die Nutzlast trägt Auftrags- und Prüfdaten.',
    };
  }

  // A literal address needs no resolution; a name does, and what matters is
  // where it points, not how it is spelled.
  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : await resolveAll(url.hostname).catch(() => null);

  if (!addresses || addresses.length === 0) {
    return {
      ok: false,
      reason: 'UNRESOLVABLE_HOST',
      detail: `Der Host ${url.hostname} ist nicht auflösbar.`,
    };
  }

  // ALL answers must be acceptable. A name that returns one public and one
  // loopback address is exactly the trick this exists to stop.
  const offending = addresses.find((address) => isPrivateAddress(address));
  if (offending && !allowsPrivateTargets()) {
    return {
      ok: false,
      reason: 'PRIVATE_ADDRESS',
      detail: `${url.hostname} zeigt auf eine interne Adresse (${offending}).`,
    };
  }

  return { ok: true };
}

async function resolveAll(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((entry) => entry.address);
}

/**
 * Development affordance: a webhook receiver running on the developer's own
 * machine is on loopback, which is exactly what the check above refuses.
 *
 * Ignored in production, unconditionally. A switch that turns off an SSRF
 * defence is worth having only if it cannot be turned on where it matters —
 * otherwise it is a documented way to defeat the control, and someone will
 * eventually copy it into the wrong `.env`.
 */
function allowsPrivateTargets(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS === 'true';
}
