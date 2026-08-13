import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { isValidPlanRevisionTransition, type PlanRevisionStatus } from './plan-revision-status';
import { validatePlanGraph, type PlanGraphValidationResult } from './plan-graph';
import { resolveDrawingReferencesWithin } from './resolve-drawing-references';

async function loadRevisionOrThrow(tx: Prisma.TransactionClient, revisionId: string) {
  const revision = await tx.productionPlanRevision.findFirst({ where: { id: revisionId } });
  if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
  return revision;
}

function assertTransition(from: string, to: PlanRevisionStatus): void {
  if (!isValidPlanRevisionTransition(from as PlanRevisionStatus, to)) {
    throw new InvalidStateTransitionError('Fertigungsplan-Revision', from, to);
  }
}

/** DB-backed wrapper around the pure src/domain/production-plans/plan-graph.ts
 * algorithm — loads the actual steps/dependencies for a revision. Exposed
 * standalone to match the `POST .../validate-graph` endpoint in
 * docs/05_API_CONTRACTS.md, and used internally as a release gate below. */
export async function validateProductionPlanGraph(
  actor: Actor,
  productionPlanRevisionId: string,
): Promise<PlanGraphValidationResult> {
  await assertPermission(actor, 'production_plan.review');

  return withOrgContext(actor.organizationId, async (tx) => {
    const steps = await tx.planStep.findMany({
      where: { productionPlanRevisionId },
      select: { id: true },
    });
    const dependencies = await tx.planStepDependency.findMany({
      where: { dependentStep: { productionPlanRevisionId } },
      select: { dependentStepId: true, predecessorStepId: true },
    });

    return validatePlanGraph(
      steps.map((s) => s.id),
      dependencies,
    );
  });
}

export interface SubmitPlanForReviewCommand {
  actor: Actor;
  productionPlanRevisionId: string;
}

/**
 * DRAFT → IN_REVIEW. Negativtest #15 ("Plan mit Zyklus freigeben:
 * Validierungsfehler"): a cyclic dependency graph is rejected HERE, before
 * the plan can even enter review — not caught later at release time.
 */
export async function submitProductionPlanForReview(command: SubmitPlanForReviewCommand) {
  await assertPermission(command.actor, 'production_plan.update');

  const graphResult = await withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.productionPlanRevisionId);
    assertTransition(revision.status, 'IN_REVIEW');

    const steps = await tx.planStep.findMany({
      where: { productionPlanRevisionId: revision.id },
      select: { id: true },
    });
    if (steps.length === 0) {
      throw new ValidationError(
        'Ein Fertigungsplan ohne Arbeitsschritte kann nicht zur Prüfung eingereicht werden.',
      );
    }
    const dependencies = await tx.planStepDependency.findMany({
      where: { dependentStep: { productionPlanRevisionId: revision.id } },
      select: { dependentStepId: true, predecessorStepId: true },
    });

    return {
      revision,
      graph: validatePlanGraph(
        steps.map((s) => s.id),
        dependencies,
      ),
    };
  });

  if (!graphResult.graph.valid) {
    throw new ValidationError(
      `Plan enthält eine zyklische Abhängigkeit (betroffene Schritte: ${graphResult.graph.cycleStepIds?.join(' → ')}). Freigabe nicht möglich.`,
    );
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.productionPlanRevisionId);

    // Letzter Moment, zu dem eine Bindung noch entstehen kann: gleich danach
    // verlässt die Revision den Entwurfsstatus, und ab dann ist eine im
    // Modell genannte Zeichnung nur noch nachschlagbar, nicht mehr
    // verbindlich zu machen. Ein Plan aus einem Gebäudemodell soll nicht
    // deshalb mit offenen Verweisen zur Prüfung gehen, weil zwischen Import
    // und Einreichen niemand auf einen Knopf gedrückt hat — die Zeichnungen
    // treffen typischerweise genau in diesem Zeitraum ein.
    //
    // Ohne Wirkung, wenn der Plan nicht aus einem Import stammt: dann gibt es
    // keine Verweise, und die Abfrage findet nichts.
    await resolveDrawingReferencesWithin(tx, {
      organizationId: command.actor.organizationId,
      actorId: command.actor.userId,
      productionPlanRevisionId: revision.id,
    });

    const updated = await tx.productionPlanRevision.update({
      where: { id: revision.id },
      data: { status: 'IN_REVIEW' },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan_revision.submitted_for_review',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      source: 'web',
    });

    return updated;
  });
}

export interface ApprovePlanCommand {
  actor: Actor;
  productionPlanRevisionId: string;
}

export async function approveProductionPlan(command: ApprovePlanCommand) {
  await assertPermission(command.actor, 'production_plan.approve');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.productionPlanRevisionId);
    assertTransition(revision.status, 'APPROVED');

    const updated = await tx.productionPlanRevision.update({
      where: { id: revision.id },
      data: { status: 'APPROVED' },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan_revision.approved',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      source: 'web',
    });

    return updated;
  });
}

export interface RejectPlanCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  reason: string;
}

export async function rejectProductionPlan(command: RejectPlanCommand) {
  await assertPermission(command.actor, 'production_plan.review');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.productionPlanRevisionId);
    assertTransition(revision.status, 'DRAFT');

    const updated = await tx.productionPlanRevision.update({
      where: { id: revision.id },
      data: { status: 'DRAFT' },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan_revision.rejected',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}

export interface ReleasePlanCommand {
  actor: Actor;
  productionPlanRevisionId: string;
}

/** APPROVED → RELEASED, auto-superseding any previously RELEASED revision
 * of the same plan — same invariant as document releases, see
 * src/domain/documents/document-review-workflow.ts. */
export async function releaseProductionPlan(command: ReleasePlanCommand) {
  await assertPermission(command.actor, 'production_plan.release');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.productionPlanRevisionId);
    assertTransition(revision.status, 'RELEASED');

    const previouslyReleased = await tx.productionPlanRevision.findFirst({
      where: { productionPlanId: revision.productionPlanId, status: 'RELEASED' },
    });

    if (previouslyReleased) {
      await tx.productionPlanRevision.update({
        where: { id: previouslyReleased.id },
        data: { status: 'SUPERSEDED' },
      });
      await writeAuditEvent(tx, {
        organizationId: command.actor.organizationId,
        eventType: 'production_plan_revision.superseded',
        resourceType: 'production_plan_revision',
        resourceId: previouslyReleased.id,
        actorId: command.actor.userId,
        previousValues: { status: 'RELEASED' },
        newValues: { status: 'SUPERSEDED', supersededByRevisionId: revision.id },
        source: 'web',
      });
    }

    const updated = await tx.productionPlanRevision.update({
      where: { id: revision.id },
      data: { status: 'RELEASED', releasedById: command.actor.userId, releasedAt: new Date() },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'production_plan_revision.released',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'production_plan_revision',
      aggregateId: revision.id,
      eventType: 'production_plan_revision.released',
      payload: {
        productionPlanId: revision.productionPlanId,
        revisionNumber: revision.revisionNumber,
      },
    });

    return updated;
  });
}
