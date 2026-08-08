import type { Actor } from '@/domain/shared/actor';
import { can } from './can';
import { AuthzError } from './errors';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';

/**
 * The self-defense check every domain service opens with — see
 * MASTERPROMPT.md Kap. 14 "Schichtenregeln" and docs/01_SYSTEM_CONTEXT.md
 * "Schichtenarchitektur": the API layer resolves and validates syntax/authN, but
 * authorization is a domain-layer responsibility so that no future caller
 * (another service, a script, a test) can accidentally bypass it by calling
 * the service directly. Throws AuthzError (mapped to the right HTTP status
 * by src/lib/api/error-response.ts) rather than returning a Decision, since
 * services want to abort immediately, not thread a Decision through every
 * call site.
 */
export async function assertPermission(
  actor: Actor,
  action: PermissionCode,
  opts?: { requiredQualification?: string; atTimestamp?: Date },
): Promise<void> {
  const decision = await can({
    userId: actor.userId,
    organizationId: actor.organizationId,
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
}
