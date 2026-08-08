import { auth } from '@/lib/auth';
import { can } from './can';
import { AuthzError } from './errors';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';

export interface AuthContext {
  userId: string;
  organizationId: string;
}

/**
 * Resolves the current session into an AuthContext or throws AuthzError.
 * Every API route handler that touches business data starts with this
 * (or requirePermission below) — organization_id is NEVER taken from a
 * request body or query param, only from the authenticated session, so a
 * client cannot simply pass a different organizationId to escape its tenant
 * (see 08_THREAT_MODEL_PRIVACY.md, Szenario 1).
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new AuthzError('UNAUTHENTICATED', 'Bitte melden Sie sich an.');
  }
  return { userId: session.user.id, organizationId: session.user.organizationId };
}

/**
 * Resolves the session AND checks the given permission. Throws AuthzError
 * (with an HTTP status matching docs/05_API_CONTRACTS.md) on failure —
 * route handlers should let this propagate to a shared error-mapping layer
 * rather than catching it inline.
 */
export async function requirePermission(
  action: PermissionCode,
  opts?: { requiredQualification?: string; atTimestamp?: Date },
): Promise<AuthContext> {
  const ctx = await requireAuthContext();
  const decision = await can({
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    action,
    requiredQualification: opts?.requiredQualification,
    atTimestamp: opts?.atTimestamp,
  });
  if (!decision.allowed) {
    throw new AuthzError(
      decision.reason ?? 'PERMISSION_DENIED',
      decision.message ?? 'Zugriff verweigert.',
    );
  }
  return ctx;
}
