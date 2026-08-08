import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import type { Actor } from '@/domain/shared/actor';

export interface AssignProjectMemberCommand {
  actor: Actor;
  projectId: string;
  userId: string;
  role?: string;
}

// Gated behind `project.update` (not a dedicated permission atom, since
// docs/04_ROLES_PERMISSIONS_MATRIX.md doesn't define one) — membership
// management is part of "Projekt bearbeiten" for the roles that hold it.
export async function assignProjectMember(command: AssignProjectMemberCommand) {
  await assertPermission(command.actor, 'project.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const member = await tx.projectMember.upsert({
      where: {
        organizationId_projectId_userId: {
          organizationId: command.actor.organizationId,
          projectId: command.projectId,
          userId: command.userId,
        },
      },
      update: { role: command.role },
      create: {
        organizationId: command.actor.organizationId,
        projectId: command.projectId,
        userId: command.userId,
        role: command.role,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'project.member_assigned',
      resourceType: 'project',
      resourceId: command.projectId,
      actorId: command.actor.userId,
      newValues: { userId: command.userId, role: command.role },
      source: 'web',
    });

    return member;
  });
}
