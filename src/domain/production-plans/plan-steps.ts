import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { isPlanStructureEditable, type PlanRevisionStatus } from './plan-revision-status';

export interface AddPlanStepCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  stepNumber: number;
  title: string;
  description?: string;
  instruction?: string;
  departmentId?: string;
  workCenterId?: string;
  requiredRole?: string;
  estimatedDurationMinutes?: number;
  photoRequired?: boolean;
  signatureRequired?: boolean;
  fourEyesRequired?: boolean;
  fourEyesScope?: string;
}

export async function addPlanStep(command: AddPlanStepCommand) {
  await assertPermission(command.actor, 'work_step_definition.create');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await tx.productionPlanRevision.findFirst({
      where: { id: command.productionPlanRevisionId },
    });
    if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
    if (!isPlanStructureEditable(revision.status as PlanRevisionStatus)) {
      throw new ValidationError('Plan-Struktur ist nur im Status DRAFT bearbeitbar.');
    }

    const step = await tx.planStep.create({
      data: {
        organizationId: command.actor.organizationId,
        productionPlanRevisionId: revision.id,
        stepNumber: command.stepNumber,
        title: command.title,
        description: command.description,
        instruction: command.instruction,
        departmentId: command.departmentId,
        workCenterId: command.workCenterId,
        requiredRole: command.requiredRole,
        estimatedDurationMinutes: command.estimatedDurationMinutes,
        photoRequired: command.photoRequired ?? false,
        signatureRequired: command.signatureRequired ?? true,
        fourEyesRequired: command.fourEyesRequired ?? false,
        fourEyesScope: command.fourEyesScope,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'plan_step.created',
      resourceType: 'plan_step',
      resourceId: step.id,
      actorId: command.actor.userId,
      newValues: { stepNumber: step.stepNumber, title: step.title },
      source: 'web',
    });

    return step;
  });
}

export interface AddPlanStepDependencyCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  dependentStepId: string;
  predecessorStepId: string;
  dependencyType?: string;
  lagMinutes?: number;
}

/** Records a dependency edge. Does NOT validate acyclicity here — that
 * happens once, explicitly, over the whole graph at review-submission time
 * (src/domain/production-plans/plan-review-workflow.ts), matching the
 * dedicated `POST .../validate-graph` endpoint in docs/05_API_CONTRACTS.md
 * rather than re-walking the graph on every single edge insert. */
export async function addPlanStepDependency(command: AddPlanStepDependencyCommand) {
  await assertPermission(command.actor, 'work_step_definition.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await tx.productionPlanRevision.findFirst({
      where: { id: command.productionPlanRevisionId },
    });
    if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
    if (!isPlanStructureEditable(revision.status as PlanRevisionStatus)) {
      throw new ValidationError('Plan-Struktur ist nur im Status DRAFT bearbeitbar.');
    }
    if (command.dependentStepId === command.predecessorStepId) {
      throw new ValidationError('Ein Arbeitsschritt kann nicht von sich selbst abhängen.');
    }

    const dependency = await tx.planStepDependency.create({
      data: {
        organizationId: command.actor.organizationId,
        dependentStepId: command.dependentStepId,
        predecessorStepId: command.predecessorStepId,
        dependencyType: command.dependencyType ?? 'FINISH_TO_START',
        lagMinutes: command.lagMinutes ?? 0,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'plan_step_dependency.created',
      resourceType: 'plan_step_dependency',
      resourceId: dependency.id,
      actorId: command.actor.userId,
      newValues: {
        dependentStepId: command.dependentStepId,
        predecessorStepId: command.predecessorStepId,
      },
      source: 'web',
    });

    return dependency;
  });
}
