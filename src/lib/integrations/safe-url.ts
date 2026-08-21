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
 *
 * **IPv6 wird zerlegt statt verglichen.** Der erste Anlauf prüfte
 * Zeichenketten: `'::1'`, Präfix `fe80`, und IPv4-mapped nur in punktierter
 * Form. Damit galten `0:0:0:0:0:0:0:1` (dasselbe Loopback, nur ausgeschrieben)
 * und `::ffff:7f00:1` (dasselbe Loopback als IPv4-mapped in Hexschreibweise)
 * als **öffentlich** — ebenso `::ffff:a9fe:a9fe`, der Metadatendienst. Eine
 * Adresse hat viele Schreibweisen; verglichen werden dürfen deshalb die
 * Zahlen, nicht der Text.
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
    const groups = ipv6Groups(address);
    // Nicht zerlegbar, obwohl `isIP` zugestimmt hat: dann lieber ablehnen.
    if (!groups) return true;
    const [erste, , , , , sechste, siebte, achte] = groups;

    // Unspezifiziert (::) und Loopback (::1).
    if (groups.slice(0, 7).every((g) => g === 0) && (achte === 0 || achte === 1)) return true;

    // IPv4-mapped: ::ffff:a.b.c.d — und dieselbe Adresse in Hexschreibweise,
    // ::ffff:7f00:1. Beide sind dieselbe Adresse; nur die erste wurde vorher
    // erkannt, die zweite nicht.
    if (groups.slice(0, 5).every((g) => g === 0) && sechste === 0xffff) {
      const v4 = [siebte >> 8, siebte & 0xff, achte >> 8, achte & 0xff].join('.');
      return isPrivateAddress(v4);
    }

    if ((erste & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((erste & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
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
  //
  // **Die Klammern gehören zur URL, nicht zur Adresse.** `url.hostname` gibt
  // ein IPv6-Literal als `[::1]` zurück; `isIP` erkennt das nicht, die Adresse
  // fiel deshalb in die Namensauflösung und scheiterte dort. Das sah wie ein
  // Schutz aus — jede IPv6-Umgehung endete als UNRESOLVABLE_HOST — war aber
  // keiner: es machte lediglich **jeden** IPv6-Endpunkt unkonfigurierbar, auch
  // den legitimen. Der Schutz liegt jetzt dort, wo er hingehört, nämlich in
  // `isPrivateAddress`.
  const literal = entklammert(url.hostname);
  const addresses = isIP(literal) ? [literal] : await resolveAll(url.hostname).catch(() => null);

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

/**
 * Zerlegt eine IPv6-Adresse in ihre acht 16-Bit-Gruppen.
 *
 * Eigenhändig und nicht über eine Bibliothek, weil es genau eine Stelle gibt,
 * die es braucht, und weil die Regeln kurz sind: `::` steht für eine beliebig
 * lange Folge von Nullgruppen und darf höchstens einmal vorkommen; eine
 * abschließende punktierte IPv4-Adresse besetzt die letzten beiden Gruppen.
 */
type Ipv6Gruppen = [number, number, number, number, number, number, number, number];

function ipv6Groups(address: string): Ipv6Gruppen | null {
  let text = address.toLowerCase();

  // Zonenkennung (fe80::1%eth0) gehört nicht zur Adresse.
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);

  // Abschließende IPv4-Form in zwei Gruppen umrechnen.
  const punktiert = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (punktiert) {
    const [a, b, c, d] = punktiert.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((n) => n > 255)) return null;
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    text = text.slice(0, punktiert.index) + hex;
  }

  const haelften = text.split('::');
  if (haelften.length > 2) return null;

  const zuGruppen = (teil: string): number[] | null => {
    if (teil === '') return [];
    const stuecke = teil.split(':');
    const zahlen: number[] = [];
    for (const stueck of stuecke) {
      if (!/^[0-9a-f]{1,4}$/.test(stueck)) return null;
      zahlen.push(Number.parseInt(stueck, 16));
    }
    return zahlen;
  };

  const links = zuGruppen(haelften[0] ?? '');
  const rechts = haelften.length === 2 ? zuGruppen(haelften[1] ?? '') : [];
  if (!links || !rechts) return null;

  if (haelften.length === 1) return links.length === 8 ? (links as Ipv6Gruppen) : null;

  const fehlend = 8 - links.length - rechts.length;
  if (fehlend < 1) return null;
  const alle = [...links, ...Array<number>(fehlend).fill(0), ...rechts];
  // Die Länge ist durch die Rechnung oben festgelegt; die Prüfung steht hier,
  // damit der Tupeltyp nicht auf einer Zusicherung allein ruht.
  return alle.length === 8 ? (alle as Ipv6Gruppen) : null;
}

/** `[::1]` → `::1`; alles andere unverändert. */
function entklammert(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
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
