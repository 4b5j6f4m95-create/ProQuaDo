import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { logger } from '@/lib/logger';

export interface ResolvedLogin {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string | null;
}

interface OrgMatch {
  organization_id: string;
  matched_by: 'external_id' | 'pending_invite';
}

/**
 * Resolves an OIDC callback (external_id + email) to an internal user +
 * organization, without ever running an RLS-bypassing full-table query.
 * See prisma/migrations/20260808151400_login_resolution_function and
 * src/lib/db/tenant-context.ts for why this two-step shape is necessary.
 *
 * Returns null if the person has no corresponding `users` row (unknown to
 * this system) or their account has been deactivated — callers MUST treat
 * both cases identically (deny login) to avoid leaking which case applies.
 */
export async function resolveLogin(
  externalId: string,
  email: string,
): Promise<ResolvedLogin | null> {
  const matches = await prisma.$queryRaw<OrgMatch[]>`
    SELECT * FROM resolve_org_for_login(${externalId}, ${email})
  `;
  const match = matches[0];
  if (!match) {
    logger.warn(
      { externalIdHash: hashForLog(externalId) },
      'Login denied: no matching user record',
    );
    return null;
  }

  return withOrgContext(match.organization_id, async (tx) => {
    if (match.matched_by === 'pending_invite') {
      const linked = await tx.user.update({
        where: {
          organizationId_externalId: {
            organizationId: match.organization_id,
            externalId: `pending:${email}`,
          },
        },
        data: { externalId },
      });

      await writeAuditEvent(tx, {
        organizationId: match.organization_id,
        eventType: 'user.invite_accepted',
        resourceType: 'user',
        resourceId: linked.id,
        actorId: linked.id,
        newValues: { externalId: '[REDACTED]' },
        source: 'web',
        result: 'SUCCESS',
      });

      return toResolvedLogin(linked);
    }

    const user = await tx.user.findFirst({ where: { externalId } });
    if (!user || !user.isActive) return null;
    return toResolvedLogin(user);
  });
}

function toResolvedLogin(user: {
  id: string;
  organizationId: string;
  email: string;
  displayName: string | null;
}): ResolvedLogin {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName,
  };
}

// Never log raw external IDs (OIDC subject identifiers are PII-adjacent);
// a short hash is enough to correlate repeated failures in log analysis.
function hashForLog(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}
