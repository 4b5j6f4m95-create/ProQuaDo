import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import {
  EntityVersionConflictError,
  InvalidStateTransitionError,
  NotFoundError,
} from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { isValidProjectTransition, type ProjectStatus } from './project-status';

export interface UpdateProjectDetailsCommand {
  actor: Actor;
  projectId: string;
  expectedVersion: number;
  name?: string;
  description?: string;
  customerOrderNumber?: string;
  priority?: number;
  plannedStartDate?: Date;
  plannedEndDate?: Date;
}

export async function updateProjectDetails(command: UpdateProjectDetailsCommand) {
  await assertPermission(command.actor, 'project.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id: command.projectId } });
    if (!project) throw new NotFoundError('Projekt');
    if (project.version !== command.expectedVersion) {
      throw new EntityVersionConflictError('Projekt', command.expectedVersion, project.version);
    }

    const updated = await tx.project.update({
      where: { id: command.projectId },
      data: {
        name: command.name,
        description: command.description,
        customerOrderNumber: command.customerOrderNumber,
        priority: command.priority,
        plannedStartDate: command.plannedStartDate,
        plannedEndDate: command.plannedEndDate,
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'project.updated',
      resourceType: 'project',
      resourceId: project.id,
      actorId: command.actor.userId,
      previousValues: { name: project.name, priority: project.priority },
      newValues: { name: updated.name, priority: updated.priority },
      source: 'web',
    });

    return updated;
  });
}

export interface TransitionProjectStatusCommand {
  actor: Actor;
  projectId: string;
  toStatus: ProjectStatus;
  expectedVersion: number;
  reason?: string;
}

export async function transitionProjectStatus(command: TransitionProjectStatusCommand) {
  await assertPermission(command.actor, 'project.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id: command.projectId } });
    if (!project) throw new NotFoundError('Projekt');
    if (project.version !== command.expectedVersion) {
      throw new EntityVersionConflictError('Projekt', command.expectedVersion, project.version);
    }

    const fromStatus = project.status as ProjectStatus;
    if (!isValidProjectTransition(fromStatus, command.toStatus)) {
      throw new InvalidStateTransitionError('Projekt', fromStatus, command.toStatus);
    }

    const updated = await tx.project.update({
      where: { id: command.projectId },
      data: { status: command.toStatus, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'project.status_changed',
      resourceType: 'project',
      resourceId: project.id,
      actorId: command.actor.userId,
      previousValues: { status: fromStatus },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}
