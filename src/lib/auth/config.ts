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
    maxAge: 15 * 60, // 15 minutes, matches ADR-001's short-access-token decision
  },
  callbacks: {
    async signIn({ user, profile }) {
      const externalId = profile?.sub;
      const email = user.email ?? profile?.email;
      if (!externalId || typeof externalId !== 'string' || !email) {
        logger.warn('Login denied: OIDC profile missing sub or email claim');
        return false;
      }
      const resolved = await resolveLogin(externalId, email);
      return resolved !== null;
    },
    async jwt({ token, profile }) {
      const externalId = profile?.sub as string | undefined;
      const email = (profile?.email as string | undefined) ?? token.email;
      if (externalId && email) {
        const resolved = await resolveLogin(externalId, email);
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
