import type { NextAuthConfig } from 'next-auth';
import { resolveLogin } from './resolve-login';
import { logger } from '@/lib/logger';

// ADR-001: generic OIDC provider, not bound to a specific IdP. `type: "oidc"`
// makes Auth.js discover endpoints via `${issuer}/.well-known/openid-configuration`,
// so swapping Keycloak for Auth0/Okta/Azure AD in production is a config
// change, not a code change.
export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: 'oidc',
      name: 'ProQuaDo SSO',
      type: 'oidc',
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
    },
  ],
  session: {
    // JWT strategy: access tokens stay short-lived (ADR-001) and the server
    // never needs a session-store round trip to authorize a request. Server-
    // side revocation (role changes, device revocation) is enforced by the
    // RBAC layer re-checking the database on every request, not by trusting
    // stale claims in the token — see src/lib/authz (task #16).
    strategy: 'jwt',
    /**
     * Eight hours: one shift.
     *
     * This is the SESSION lifetime, which is not the same thing as ADR-001's
     * 15-minute access token — the two were conflated here until Phase 7, and
     * the consequence showed up the first time the offline flow was played
     * through: a tablet that works a shift without connectivity came back to
     * an expired session and could not deliver what it had captured until
     * somebody logged in again. The work survives (encrypted IndexedDB), but
     * a worker being asked to authenticate before their evidence can leave
     * the device is exactly the friction that gets a system worked around.
     *
     * What makes a long session acceptable is that session age buys almost
     * nothing on its own: every act with consequences — completing a step,
     * the four-eyes decision, a conflict decision, the product release —
     * demands PIN re-authentication regardless of how old the session is
     * (docs/04 "Re-Authentifizierung für kritische Aktionen", ADR-005). And
     * since Phase 7 there is a sign-out, so a shared tablet can be handed on
     * deliberately rather than by waiting.
     *
     * Recorded as an amendment in ADR-001 — the number lives there, not here.
     */
    maxAge: 8 * 60 * 60,
  },
  callbacks: {
    async signIn({ user, profile }) {
      const externalId = profile?.sub;
      const email = user.email ?? profile?.email;
      if (!externalId || typeof externalId !== 'string' || !email) {
        logger.warn('Login denied: OIDC profile missing sub or email claim');
        return false;
      }
      const resolved = await resolveLogin(externalId, email, isEmailVerified(profile));
      return resolved !== null;
    },
    async jwt({ token, profile }) {
      const externalId = profile?.sub as string | undefined;
      const email = (profile?.email as string | undefined) ?? token.email;
      if (externalId && email) {
        const resolved = await resolveLogin(externalId, email, isEmailVerified(profile));
        if (resolved) {
          token.userId = resolved.userId;
          token.organizationId = resolved.organizationId;
          token.displayName = resolved.displayName;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && token.organizationId) {
        session.user.id = token.userId as string;
        session.user.organizationId = token.organizationId as string;
        session.user.displayName = (token.displayName as string | null) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};

/**
 * Hat der Anbieter die E-Mail-Adresse als bestätigt gemeldet?
 *
 * Der Claim heißt `email_verified` und ist in OpenID Connect als **Boolean**
 * festgelegt — manche Anbieter senden ihn aber als Zeichenkette `"true"`.
 * Beides wird angenommen; alles andere, auch ein fehlender Claim, gilt als
 * **nicht** bestätigt. Fail closed: wo die Anwendung es nicht weiß, darf sie
 * es nicht unterstellen.
 *
 * Wirksam wird die Angabe nur auf dem Einladungspfad — siehe `resolveLogin`.
 */
function isEmailVerified(profile: unknown): boolean {
  if (typeof profile !== 'object' || profile === null) return false;
  const claim = (profile as { email_verified?: unknown }).email_verified;
  return claim === true || claim === 'true';
}
