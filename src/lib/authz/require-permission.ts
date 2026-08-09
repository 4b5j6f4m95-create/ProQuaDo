import { auth } from '@/lib/auth';
import { assertWithinRateLimit } from '@/lib/api/rate-limit';
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
 *
 * It is also where the docs/05 baseline limit (`STANDARD_API`, 100 req/min
 * per user) is enforced. Phase 7 added the limit table but only wired up the
 * four special categories, which left the general ceiling in the contract and
 * nowhere else — including on the unauthenticated-expensive end of the sync
 * API: `GET /sync/bundle` mints a fresh release token and writes an audit
 * event for every READY step of every assigned order, and nothing bounded how
 * often it could be asked for.
 *
 * Counting here rather than per route is what makes the limit complete: every
 * authenticated entry point in the application resolves its actor through this
 * function, so none of them can be forgotten. The specific categories are
 * counted in addition, in their own routes, and are stricter.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new AuthzError('UNAUTHENTICATED', 'Bitte melden Sie sich an.');
  }
  await assertWithinRateLimit('STANDARD_API', { userId: session.user.id });
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
