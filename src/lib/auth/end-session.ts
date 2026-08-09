import { logger } from '@/lib/logger';

/**
 * RP-initiated logout — OpenID Connect RP-Initiated Logout 1.0.
 *
 * Clearing the application's own session is only half of signing out. The
 * identity provider keeps its own SSO session, so the next "Mit SSO anmelden"
 * silently re-authenticates the same person without ever showing a password
 * prompt. On a shared tablet in a hall that is not a nuisance, it is a
 * misattribution: the next worker acts under the previous one's name and the
 * audit trail records it that way. In a system whose whole purpose is
 * attributability, the identity provider's session has to end too.
 *
 * The endpoint is DISCOVERED, not constructed. ADR-001 binds this application
 * to generic OIDC rather than to Keycloak, and
 * `/protocol/openid-connect/logout` is a Keycloak path — hard-coding it would
 * quietly undo the decision the ADR made.
 */

interface DiscoveryDocument {
  end_session_endpoint?: string;
}

let cache: { endpoint: string | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function discoverEndSessionEndpoint(): Promise<string | null> {
  const issuer = process.env.OIDC_ISSUER?.replace(/\/$/, '');
  if (!issuer) return null;

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.endpoint;

  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`discovery responded ${response.status}`);
    const document = (await response.json()) as DiscoveryDocument;
    cache = { endpoint: document.end_session_endpoint ?? null, fetchedAt: Date.now() };
    return cache.endpoint;
  } catch (error) {
    // Not fatal: the local session is cleared either way, so the worst case
    // is an IdP session that outlives it — which is exactly the situation
    // before this existed, not a regression.
    logger.warn({ err: error }, 'OIDC discovery for end_session_endpoint failed');
    cache = { endpoint: null, fetchedAt: Date.now() };
    return null;
  }
}

/**
 * Where to send the browser after the local session is gone, or null when the
 * provider advertises no logout endpoint.
 *
 * Deliberately without `id_token_hint`: the hint would mean carrying the ID
 * token somewhere it is otherwise not needed, and the spec allows
 * `client_id` + `post_logout_redirect_uri` instead. The cost is that the
 * provider asks for confirmation — on a shared device, being asked "really
 * sign out?" is not a cost worth removing.
 */
export async function buildEndSessionUrl(returnTo: string): Promise<string | null> {
  const endpoint = await discoverEndSessionEndpoint();
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set('post_logout_redirect_uri', returnTo);
  if (process.env.OIDC_CLIENT_ID) {
    url.searchParams.set('client_id', process.env.OIDC_CLIENT_ID);
  }
  return url.toString();
}
