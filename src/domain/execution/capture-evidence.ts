import { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import { parseDecimalInput } from '@/lib/decimal-input';
import type { Actor } from '@/domain/shared/actor';
import { loadInstanceForEvidence } from './execution-guards';

const ALLOWED_RESPONSES = ['OK', 'NOK', 'N/A'] as const;
export type ChecklistResponseValue = (typeof ALLOWED_RESPONSES)[number];

export interface RecordChecklistResponseCommand {
  actor: Actor;
  workStepInstanceId: string;
  checklistItemId: string;
  response: ChecklistResponseValue;
  comment?: string;
  deviceId?: string;
  clientTimestamp?: Date;
}

/**
 * Records (or corrects) one checklist answer — docs/07 A2. Corrections
 * overwrite the row; the previous value is preserved in the audit event, so
 * "answer was changed from OK to NOK at 14:32 by M. Klein" remains
 * reconstructible without a second history table.
 */
export async function recordChecklistResponse(command: RecordChecklistResponseCommand) {
  await assertPermission(command.actor, 'work_step.execute');

  if (!ALLOWED_RESPONSES.includes(command.response)) {
    throw new ValidationError(`Ungültige Checklisten-Antwort: "${command.response}".`);
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await loadInstanceForEvidence(tx, command.actor, command.workStepInstanceId);

    const item = await tx.checklistItem.findFirst({ where: { id: command.checklistItemId } });
    if (!item) throw new NotFoundError('Checklistenpunkt');
    if (item.planStepId !== instance.planStepId) {
      throw new ValidationError('Der Checklistenpunkt gehört nicht zu diesem Arbeitsschritt.');
    }

    const existing = await tx.checklistResponse.findFirst({
      where: { workStepInstanceId: instance.id, checklistItemId: item.id },
    });

    const respondedAt = command.clientTimestamp ?? new Date();
    const saved = existing
      ? await tx.checklistResponse.update({
          where: { id: existing.id },
          data: {
            response: command.response,
            comment: command.comment,
            respondedById: command.actor.userId,
            respondedAt,
            version: { increment: 1 },
          },
        })
      : await tx.checklistResponse.create({
          data: {
            organizationId: command.actor.organizationId,
            workStepInstanceId: instance.id,
            checklistItemId: item.id,
            response: command.response,
            comment: command.comment,
            respondedById: command.actor.userId,
            respondedAt,
          },
        });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.checklist_response_recorded',
      resourceType: 'checklist_response',
      resourceId: saved.id,
      actorId: command.actor.userId,
      previousValues: existing
        ? { response: existing.response, comment: existing.comment }
        : undefined,
      newValues: {
        workStepInstanceId: instance.id,
        checklistItemId: item.id,
        response: saved.response,
        comment: saved.comment,
      },
      deviceId: command.deviceId,
      clientTimestamp: command.clientTimestamp,
      source: command.deviceId ? 'mobile' : 'web',
    });

    return saved;
  });
}

export interface RecordMeasurementCommand {
  actor: Actor;
  workStepInstanceId: string;
  inspectionCharacteristicId: string;
  /** Accepted as a string to avoid binary floating point ever touching a
   *  measured value on its way from the tablet into a NUMERIC column. */
  measuredValue: string;
  measuringEquipmentRef?: string;
  deviceId?: string;
  clientTimestamp?: Date;
}

/**
 * Records a measurement and its tolerance verdict — docs/07 A4. Two things
 * are deliberate here:
 *
 *  - the tolerance limits are COPIED from the characteristic onto the
 *    result, so the verdict stays reproducible even if a later plan
 *    revision widens or narrows the band;
 *  - the verdict is computed from those copied limits, and the database
 *    re-checks that computation (CHECK constraint, see the Phase 3
 *    constraints migration), so an out-of-tolerance value cannot be stored
 *    as "in tolerance" by any code path (Negativtest #8).
 */
export async function recordMeasurementResult(command: RecordMeasurementCommand) {
  await assertPermission(command.actor, 'work_step.execute');

  const measuredValue = parseDecimalInput(command.measuredValue, 'Messwert');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await loadInstanceForEvidence(tx, command.actor, command.workStepInstanceId);

    const characteristic = await tx.inspectionCharacteristic.findFirst({
      where: { id: command.inspectionCharacteristicId },
    });
    if (!characteristic) throw new NotFoundError('Prüfmerkmal');
    if (characteristic.planStepId !== instance.planStepId) {
      throw new ValidationError('Das Prüfmerkmal gehört nicht zu diesem Arbeitsschritt.');
    }
    if (characteristic.requiresMeasuringEquipment && !command.measuringEquipmentRef) {
      throw new ValidationError(
        'Für dieses Prüfmerkmal muss das verwendete Prüfmittel angegeben werden.',
      );
    }

    const isWithinTolerance = isWithinLimits(
      measuredValue,
      characteristic.lowerLimit,
      characteristic.upperLimit,
    );

    const existing = await tx.measurementResult.findFirst({
      where: {
        workStepInstanceId: instance.id,
        inspectionCharacteristicId: characteristic.id,
      },
    });

    const data = {
      measuredValue,
      measuredUnit: characteristic.unit,
      lowerLimit: characteristic.lowerLimit,
      upperLimit: characteristic.upperLimit,
      isWithinTolerance,
      measuringEquipmentRef: command.measuringEquipmentRef,
      measuredById: command.actor.userId,
      measuredAt: command.clientTimestamp ?? new Date(),
    };

    const saved = existing
      ? await tx.measurementResult.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.measurementResult.create({
          data: {
            organizationId: command.actor.organizationId,
            workStepInstanceId: instance.id,
            inspectionCharacteristicId: characteristic.id,
            ...data,
          },
        });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.measurement_recorded',
      resourceType: 'measurement_result',
      resourceId: saved.id,
      actorId: command.actor.userId,
      previousValues: existing
        ? {
            measuredValue: existing.measuredValue.toString(),
            isWithinTolerance: existing.isWithinTolerance,
          }
        : undefined,
      newValues: {
        workStepInstanceId: instance.id,
        inspectionCharacteristicId: characteristic.id,
        measuredValue: saved.measuredValue.toString(),
        lowerLimit: saved.lowerLimit?.toString() ?? null,
        upperLimit: saved.upperLimit?.toString() ?? null,
        isWithinTolerance: saved.isWithinTolerance,
        measuringEquipmentRef: saved.measuringEquipmentRef,
      },
      deviceId: command.deviceId,
      clientTimestamp: command.clientTimestamp,
      source: command.deviceId ? 'mobile' : 'web',
    });

    return saved;
  });
}

/** Mirrors the SQL CHECK in the Phase 3 constraints migration exactly —
 *  a missing limit means "unbounded on that side", not "fails". */
function isWithinLimits(
  value: Prisma.Decimal,
  lowerLimit: Prisma.Decimal | null,
  upperLimit: Prisma.Decimal | null,
): boolean {
  const aboveLower = lowerLimit === null || value.greaterThanOrEqualTo(lowerLimit);
  const belowUpper = upperLimit === null || value.lessThanOrEqualTo(upperLimit);
  return aboveLower && belowUpper;
}
