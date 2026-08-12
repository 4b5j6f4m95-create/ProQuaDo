import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { AlreadyExistsError, NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export interface CreateProductionPlanCommand {
  actor: Actor;
  projectId: string;
  productId: string;
  planNumber: string;
  name: string;
  description?: string;
}

/** Creates a plan identity AND its first revision (DRAFT) atomically —
 * mirrors src/domain/documents/create-document.ts for the same reason. */
export async function createProductionPlan(command: CreateProductionPlanCommand) {
  await assertPermission(command.actor, 'production_plan.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    // Vorher nachsehen, nur um eine verständliche Meldung geben zu können.
    // Die Zusicherung selbst trägt der Unique-Index — dieser Blick kann sie
    // nicht ersetzen, weil zwischen Lesen und Schreiben ein zweiter Aufruf
    // liegen kann. Ohne ihn kommt beim Anlegenden „Ein unerwarteter Fehler
    // ist aufgetreten" an, denn P2002 nennt mit dem Treiber-Adapter von
    // Prisma 7 nicht einmal das verletzte Feld.
    const taken = await tx.productionPlan.findFirst({
      where: { planNumber: command.planNumber },
      select: { id: true, name: true },
    });
    if (taken) {
      throw new AlreadyExistsError(
        `Die Plannummer „${command.planNumber}" ist bereits vergeben („${taken.name}"). ` +
          'Bitte eine andere wählen.',
      );
    }

    const plan = await tx.productionPlan.create({
      data: {
        organizationId: command.actor.organizationId,
        projectId: command.projectId,
        productId: command.productId,
        planNumber: command.planNumber,
        name: command.name,
        description: command.description,
      },
    });

    const revision = await tx.productionPlanRevision.create({
      data: {
        organizationId: command.actor.organizationId,
        productionPlanId: plan.id,
        revisionNumber: '01',
        status: 'DRAFT',
        createdById: command.actor.userId,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan.created',
      resourceType: 'production_plan',
      resourceId: plan.id,
      actorId: command.actor.userId,
      newValues: { planNumber: plan.planNumber, name: plan.name },
      source: 'web',
    });

    return { plan, revision };
  });
}

export interface CreatePlanRevisionCommand {
  actor: Actor;
  productionPlanId: string;
  changeReason: string;
}

export async function createProductionPlanRevision(command: CreatePlanRevisionCommand) {
  await assertPermission(command.actor, 'production_plan.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const plan = await tx.productionPlan.findFirst({
      where: { id: command.productionPlanId },
      include: { revisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!plan) throw new NotFoundError('Fertigungsplan');

    const priorRevision = plan.revisions[0];
    const nextRevisionNumber = String(
      priorRevision ? parseInt(priorRevision.revisionNumber, 10) + 1 : 1,
    ).padStart(2, '0');

    const revision = await tx.productionPlanRevision.create({
      data: {
        organizationId: command.actor.organizationId,
        productionPlanId: plan.id,
        revisionNumber: nextRevisionNumber,
        status: 'DRAFT',
        changeReason: command.changeReason,
        createdById: command.actor.userId,
        priorRevisionId: priorRevision?.id,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan_revision.created',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      newValues: { productionPlanId: plan.id, revisionNumber: revision.revisionNumber },
      reason: command.changeReason,
      source: 'web',
    });

    return revision;
  });
}
