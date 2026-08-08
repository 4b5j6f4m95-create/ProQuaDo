import { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import { parseDecimalInput } from '@/lib/decimal-input';
import type { Actor } from '@/domain/shared/actor';
import { isPlanStructureEditable, type PlanRevisionStatus } from './plan-revision-status';

/**
 * Requirement definition on a plan step — the planning-side counterpart of
 * what a worker later has to fulfil (docs/07 B3: "📷 Foto Pflicht (min 2,
 * max 5) · 📏 Messwert: Spaltmaß"). These belong to the plan revision, so
 * they are frozen at release and pinned into every order that uses it: the
 * obligations that applied to an execution are always reconstructible.
 *
 * All three services share the same gate — the plan revision must still be
 * DRAFT. Once a plan is in review or released, changing what a step demands
 * requires a new revision, like any other structural change.
 */

async function loadEditableStep(
  tx: Prisma.TransactionClient,
  planStepId: string,
  productionPlanRevisionId: string,
) {
  const step = await tx.planStep.findFirst({ where: { id: planStepId } });
  if (!step) throw new NotFoundError('Arbeitsschritt');
  if (step.productionPlanRevisionId !== productionPlanRevisionId) {
    throw new ValidationError('Der Arbeitsschritt gehört nicht zu dieser Planrevision.');
  }

  const revision = await tx.productionPlanRevision.findFirst({
    where: { id: step.productionPlanRevisionId },
  });
  if (!revision) throw new NotFoundError('Fertigungsplan-Revision');
  if (!isPlanStructureEditable(revision.status as PlanRevisionStatus)) {
    throw new ValidationError('Plan-Struktur ist nur im Status DRAFT bearbeitbar.');
  }

  return step;
}

export interface AddChecklistItemCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  planStepId: string;
  itemNumber: number;
  text: string;
  isRequired?: boolean;
}

export async function addChecklistItem(command: AddChecklistItemCommand) {
  await assertPermission(command.actor, 'work_step_definition.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const step = await loadEditableStep(tx, command.planStepId, command.productionPlanRevisionId);

    const item = await tx.checklistItem.create({
      data: {
        organizationId: command.actor.organizationId,
        planStepId: step.id,
        itemNumber: command.itemNumber,
        text: command.text,
        isRequired: command.isRequired ?? true,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'checklist_item.created',
      resourceType: 'checklist_item',
      resourceId: item.id,
      actorId: command.actor.userId,
      newValues: { planStepId: step.id, itemNumber: item.itemNumber, text: item.text },
      source: 'web',
    });

    return item;
  });
}

export interface AddPhotoRequirementCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  planStepId: string;
  category: string;
  description?: string;
  minCount?: number;
  maxCount?: number;
}

export async function addPhotoRequirement(command: AddPhotoRequirementCommand) {
  await assertPermission(command.actor, 'work_step_definition.update');

  const minCount = command.minCount ?? 1;
  if (minCount < 1) {
    throw new ValidationError('Eine Fotoanforderung muss mindestens ein Foto verlangen.');
  }
  if (command.maxCount !== undefined && command.maxCount < minCount) {
    throw new ValidationError('Die Höchstzahl an Fotos darf nicht unter der Mindestzahl liegen.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const step = await loadEditableStep(tx, command.planStepId, command.productionPlanRevisionId);

    const requirement = await tx.photoRequirement.create({
      data: {
        organizationId: command.actor.organizationId,
        planStepId: step.id,
        category: command.category,
        description: command.description,
        minCount,
        maxCount: command.maxCount,
      },
    });

    // Keep the coarse flag in sync so a step with explicit photo
    // requirements is never displayed as "no photo needed".
    await tx.planStep.update({ where: { id: step.id }, data: { photoRequired: true } });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'photo_requirement.created',
      resourceType: 'photo_requirement',
      resourceId: requirement.id,
      actorId: command.actor.userId,
      newValues: {
        planStepId: step.id,
        category: requirement.category,
        minCount: requirement.minCount,
        maxCount: requirement.maxCount,
      },
      source: 'web',
    });

    return requirement;
  });
}

export interface AddInspectionCharacteristicCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  planStepId: string;
  characteristicNumber: number;
  name: string;
  /** Decimal strings, not numbers — tolerances must survive the trip
   *  without binary floating point rounding. */
  nominalValue?: string;
  lowerLimit?: string;
  upperLimit?: string;
  unit?: string;
  isRequired?: boolean;
  requiresMeasuringEquipment?: boolean;
}

export async function addInspectionCharacteristic(command: AddInspectionCharacteristicCommand) {
  await assertPermission(command.actor, 'work_step_definition.update');

  const lower = toDecimal(command.lowerLimit, 'Untere Toleranzgrenze');
  const upper = toDecimal(command.upperLimit, 'Obere Toleranzgrenze');
  if (lower && upper && lower.greaterThan(upper)) {
    throw new ValidationError('Die untere Toleranzgrenze liegt über der oberen.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const step = await loadEditableStep(tx, command.planStepId, command.productionPlanRevisionId);

    const characteristic = await tx.inspectionCharacteristic.create({
      data: {
        organizationId: command.actor.organizationId,
        planStepId: step.id,
        characteristicNumber: command.characteristicNumber,
        name: command.name,
        nominalValue: toDecimal(command.nominalValue, 'Sollwert'),
        lowerLimit: lower,
        upperLimit: upper,
        unit: command.unit,
        isRequired: command.isRequired ?? true,
        requiresMeasuringEquipment: command.requiresMeasuringEquipment ?? false,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'inspection_characteristic.created',
      resourceType: 'inspection_characteristic',
      resourceId: characteristic.id,
      actorId: command.actor.userId,
      newValues: {
        planStepId: step.id,
        name: characteristic.name,
        lowerLimit: characteristic.lowerLimit?.toString() ?? null,
        upperLimit: characteristic.upperLimit?.toString() ?? null,
        unit: characteristic.unit,
      },
      source: 'web',
    });

    return characteristic;
  });
}

function toDecimal(value: string | undefined, label: string): Prisma.Decimal | undefined {
  if (value === undefined || value === '') return undefined;
  return parseDecimalInput(value, label);
}

export interface BindDocumentToStepCommand {
  actor: Actor;
  productionPlanRevisionId: string;
  planStepId: string;
  /** Always a specific revision, never a document. Geschäftsgrundsatz 6:
   *  "verbindlich ist genau die freigegebene Revision", not "the newest". */
  documentRevisionId: string;
  pageNumber?: number;
  markerLabel?: string;
}

/**
 * `step_document_bindings` — which released document revision is binding for
 * a plan step (docs/10 Phase 2 "Schritt-Dokumentbindung"). The table existed
 * from Phase 2; the service arrived with Phase 5, because the offline
 * revision conflict (Abnahmeszenario C) is defined entirely in terms of these
 * bindings and could not otherwise be produced by the application at all.
 *
 * Only a RELEASED revision may be bound: binding a draft would make an
 * unreviewed drawing binding for production, which is the failure mode
 * Geschäftsgrundsatz 6 exists to prevent.
 */
export async function bindDocumentToPlanStep(command: BindDocumentToStepCommand) {
  await assertPermission(command.actor, 'work_step_definition.update');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const step = await loadEditableStep(tx, command.planStepId, command.productionPlanRevisionId);

    const revision = await tx.documentRevision.findFirst({
      where: { id: command.documentRevisionId },
      select: { id: true, documentId: true, status: true, revisionNumber: true },
    });
    if (!revision) throw new NotFoundError('Dokumentrevision');
    if (revision.status !== 'RELEASED') {
      throw new ValidationError(
        `Nur eine freigegebene Dokumentrevision darf verbindlich gebunden werden (Status: ${revision.status}).`,
      );
    }

    const binding = await tx.stepDocumentBinding.create({
      data: {
        organizationId: command.actor.organizationId,
        planStepId: step.id,
        documentId: revision.documentId,
        documentRevisionId: revision.id,
        pageNumber: command.pageNumber,
        markerLabel: command.markerLabel,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'step_document_binding.created',
      resourceType: 'step_document_binding',
      resourceId: binding.id,
      actorId: command.actor.userId,
      newValues: {
        planStepId: step.id,
        documentRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
      },
      source: 'web',
    });

    return binding;
  });
}
