import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import type { Actor } from '@/domain/shared/actor';

export interface CreateProjectCommand {
  actor: Actor;
  siteId: string;
  projectNumber: string;
  name: string;
  customerId: string;
  customerOrderNumber?: string;
  description?: string;
  priority?: number;
  plannedStartDate?: Date;
  plannedEndDate?: Date;
}

export async function createProject(command: CreateProjectCommand) {
  await assertPermission(command.actor, 'project.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const project = await tx.project.create({
      data: {
        organizationId: command.actor.organizationId,
        siteId: command.siteId,
        projectNumber: command.projectNumber,
        name: command.name,
        customerId: command.customerId,
        customerOrderNumber: command.customerOrderNumber,
        description: command.description,
        priority: command.priority ?? 3,
        plannedStartDate: command.plannedStartDate,
        plannedEndDate: command.plannedEndDate,
        createdById: command.actor.userId,
        status: 'DRAFT',
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'project.created',
      resourceType: 'project',
      resourceId: project.id,
      actorId: command.actor.userId,
      newValues: {
        projectNumber: project.projectNumber,
        name: project.name,
        status: project.status,
      },
      source: 'web',
    });

    return project;
  });
}
