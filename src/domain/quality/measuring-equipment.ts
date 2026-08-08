import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import {
  EquipmentCalibrationExpiredError,
  NotFoundError,
  ValidationError,
} from '@/lib/domain-errors';
import { parseDecimalInput } from '@/lib/decimal-input';
import type { Actor } from '@/domain/shared/actor';

/**
 * Prüfmittelverwaltung (docs/07 C3) and the calibration gate from
 * MASTERPROMPT.md Kap. 8: "Bei konfigurierter Pflicht verhindert ein zum
 * Ausführungszeitpunkt gesperrtes oder überfälliges Prüfmittel die
 * Freigabe."
 *
 * The gate asks about the moment of measurement, not "now": a measurement
 * taken while the equipment was calibrated stays valid after the
 * certificate expires. That is why resolveUsableCalibration() takes an
 * explicit timestamp instead of reading the clock.
 */

const USABLE_EQUIPMENT_STATUS = 'ACTIVE';

export interface CalibrationCheck {
  usable: boolean;
  reason?: string;
  calibrationId?: string;
  nextCalibrationDueAt?: Date;
}

/**
 * The calibration that was valid for this equipment at the given time, or
 * why there is none. Returned rather than thrown so callers can present it
 * (C3's traffic lights) as well as enforce it.
 */
export async function resolveUsableCalibration(
  tx: Prisma.TransactionClient,
  measuringEquipmentId: string,
  atTimestamp: Date,
): Promise<CalibrationCheck> {
  const equipment = await tx.measuringEquipment.findFirst({
    where: { id: measuringEquipmentId },
    select: { id: true, status: true, equipmentNumber: true },
  });
  if (!equipment) return { usable: false, reason: 'Prüfmittel nicht gefunden' };
  if (equipment.status !== USABLE_EQUIPMENT_STATUS) {
    return { usable: false, reason: `Status ${equipment.status}` };
  }

  const calibration = await tx.calibration.findFirst({
    where: {
      measuringEquipmentId,
      status: 'VALID',
      calibratedAt: { lte: atTimestamp },
      nextCalibrationDueAt: { gt: atTimestamp },
    },
    orderBy: { calibratedAt: 'desc' },
    select: { id: true, nextCalibrationDueAt: true },
  });
  if (!calibration) {
    return { usable: false, reason: 'keine zum Messzeitpunkt gültige Kalibrierung' };
  }

  return {
    usable: true,
    calibrationId: calibration.id,
    nextCalibrationDueAt: calibration.nextCalibrationDueAt,
  };
}

/** Enforcing variant used by measurement capture (Negativtest #11). */
export async function assertEquipmentUsable(
  tx: Prisma.TransactionClient,
  measuringEquipmentId: string,
  atTimestamp: Date,
): Promise<string> {
  const equipment = await tx.measuringEquipment.findFirst({
    where: { id: measuringEquipmentId },
    select: { equipmentNumber: true, name: true },
  });
  if (!equipment) throw new NotFoundError('Prüfmittel');

  const check = await resolveUsableCalibration(tx, measuringEquipmentId, atTimestamp);
  if (!check.usable || !check.calibrationId) {
    throw new EquipmentCalibrationExpiredError(
      `${equipment.equipmentNumber} (${equipment.name})`,
      check.reason ?? 'nicht einsatzbereit',
    );
  }
  return check.calibrationId;
}

export interface CreateMeasuringEquipmentCommand {
  actor: Actor;
  equipmentNumber: string;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  measurementRangeMin?: string;
  measurementRangeMax?: string;
  measurementUnit?: string;
  location?: string;
}

export async function createMeasuringEquipment(command: CreateMeasuringEquipmentCommand) {
  await assertPermission(command.actor, 'equipment.manage');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const equipment = await tx.measuringEquipment.create({
      data: {
        organizationId: command.actor.organizationId,
        equipmentNumber: command.equipmentNumber,
        name: command.name,
        manufacturer: command.manufacturer,
        model: command.model,
        serialNumber: command.serialNumber,
        measurementRangeMin: command.measurementRangeMin
          ? parseDecimalInput(command.measurementRangeMin, 'Messbereich (min)')
          : undefined,
        measurementRangeMax: command.measurementRangeMax
          ? parseDecimalInput(command.measurementRangeMax, 'Messbereich (max)')
          : undefined,
        measurementUnit: command.measurementUnit,
        location: command.location,
        status: 'ACTIVE',
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'measuring_equipment.created',
      resourceType: 'measuring_equipment',
      resourceId: equipment.id,
      actorId: command.actor.userId,
      newValues: { equipmentNumber: equipment.equipmentNumber, name: equipment.name },
      source: 'web',
    });

    return equipment;
  });
}

export interface SetEquipmentStatusCommand {
  actor: Actor;
  measuringEquipmentId: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'RETIRED';
  reason?: string;
}

export async function setMeasuringEquipmentStatus(command: SetEquipmentStatusCommand) {
  await assertPermission(command.actor, 'equipment.manage');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const equipment = await tx.measuringEquipment.findFirst({
      where: { id: command.measuringEquipmentId },
    });
    if (!equipment) throw new NotFoundError('Prüfmittel');

    const updated = await tx.measuringEquipment.update({
      where: { id: equipment.id },
      data: { status: command.status, version: { increment: 1 } },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'measuring_equipment.status_changed',
      resourceType: 'measuring_equipment',
      resourceId: equipment.id,
      actorId: command.actor.userId,
      previousValues: { status: equipment.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}

export interface RecordCalibrationCommand {
  actor: Actor;
  measuringEquipmentId: string;
  calibratedAt: Date;
  nextCalibrationDueAt: Date;
  calibratedBy?: string;
  calibrationCertificateKey?: string;
}

export async function recordCalibration(command: RecordCalibrationCommand) {
  await assertPermission(command.actor, 'calibration.manage');

  if (command.nextCalibrationDueAt <= command.calibratedAt) {
    throw new ValidationError('Die nächste Kalibrierung muss nach der aktuellen liegen.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const equipment = await tx.measuringEquipment.findFirst({
      where: { id: command.measuringEquipmentId },
    });
    if (!equipment) throw new NotFoundError('Prüfmittel');

    const calibration = await tx.calibration.create({
      data: {
        organizationId: command.actor.organizationId,
        measuringEquipmentId: equipment.id,
        calibratedAt: command.calibratedAt,
        nextCalibrationDueAt: command.nextCalibrationDueAt,
        calibratedBy: command.calibratedBy,
        calibrationCertificateKey: command.calibrationCertificateKey,
        status: 'VALID',
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'calibration.recorded',
      resourceType: 'calibration',
      resourceId: calibration.id,
      actorId: command.actor.userId,
      newValues: {
        measuringEquipmentId: equipment.id,
        calibratedAt: calibration.calibratedAt.toISOString(),
        nextCalibrationDueAt: calibration.nextCalibrationDueAt.toISOString(),
      },
      source: 'web',
    });

    return calibration;
  });
}

export interface InvalidateCalibrationCommand {
  actor: Actor;
  calibrationId: string;
  reason: string;
}

export interface CalibrationImpact {
  calibrationId: string;
  affectedMeasurements: Array<{
    measurementResultId: string;
    workStepInstanceId: string;
    productionOrderId: string;
    orderNumber: string;
    measuredAt: Date;
  }>;
}

/**
 * "Eine spätere Erkenntnis über fehlerhafte Kalibrierung muss eine
 * Auswirkungsanalyse auf betroffene Messungen ermöglichen"
 * (MASTERPROMPT.md Kap. 8). Marking a certificate bad does NOT rewrite the
 * measurements taken under it — it returns exactly which ones are now in
 * question, so QM can decide per case (an NCR, a re-measurement, a hold).
 */
export async function invalidateCalibration(
  command: InvalidateCalibrationCommand,
): Promise<CalibrationImpact> {
  await assertPermission(command.actor, 'calibration.manage');

  if (!command.reason.trim()) {
    throw new ValidationError('Das Verwerfen einer Kalibrierung erfordert eine Begründung.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const calibration = await tx.calibration.findFirst({ where: { id: command.calibrationId } });
    if (!calibration) throw new NotFoundError('Kalibrierung');

    await tx.calibration.update({
      where: { id: calibration.id },
      data: {
        status: 'INVALIDATED',
        invalidatedAt: new Date(),
        invalidatedReason: command.reason,
        version: { increment: 1 },
      },
    });

    const affected = await tx.measurementResult.findMany({
      where: { calibrationId: calibration.id },
      select: {
        id: true,
        workStepInstanceId: true,
        measuredAt: true,
        workStepInstance: {
          select: {
            productionOrderId: true,
            productionOrder: { select: { orderNumber: true } },
          },
        },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'calibration.invalidated',
      resourceType: 'calibration',
      resourceId: calibration.id,
      actorId: command.actor.userId,
      previousValues: { status: calibration.status },
      newValues: { status: 'INVALIDATED', affectedMeasurementCount: affected.length },
      reason: command.reason,
      source: 'web',
    });

    return {
      calibrationId: calibration.id,
      affectedMeasurements: affected.map((m) => ({
        measurementResultId: m.id,
        workStepInstanceId: m.workStepInstanceId,
        productionOrderId: m.workStepInstance.productionOrderId,
        orderNumber: m.workStepInstance.productionOrder.orderNumber,
        measuredAt: m.measuredAt,
      })),
    };
  });
}

export interface EquipmentListEntry {
  id: string;
  equipmentNumber: string;
  name: string;
  status: string;
  location: string | null;
  measurementUnit: string | null;
  nextCalibrationDueAt: Date | null;
  isUsable: boolean;
  blockReason?: string;
}

/** C3's table: number, name, calibration, status — with the usability
 *  verdict computed the same way the capture gate computes it. */
export async function listMeasuringEquipment(
  actor: Actor,
  atTimestamp: Date = new Date(),
): Promise<EquipmentListEntry[]> {
  await assertPermission(actor, 'work_step.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const equipment = await tx.measuringEquipment.findMany({
      orderBy: { equipmentNumber: 'asc' },
    });

    const entries: EquipmentListEntry[] = [];
    for (const item of equipment) {
      const check = await resolveUsableCalibration(tx, item.id, atTimestamp);
      entries.push({
        id: item.id,
        equipmentNumber: item.equipmentNumber,
        name: item.name,
        status: item.status,
        location: item.location,
        measurementUnit: item.measurementUnit,
        nextCalibrationDueAt: check.nextCalibrationDueAt ?? null,
        isUsable: check.usable,
        blockReason: check.reason,
      });
    }
    return entries;
  });
}

export async function getMeasuringEquipment(actor: Actor, measuringEquipmentId: string) {
  await assertPermission(actor, 'work_step.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const equipment = await tx.measuringEquipment.findFirst({
      where: { id: measuringEquipmentId },
      include: { calibrations: { orderBy: { calibratedAt: 'desc' } } },
    });
    if (!equipment) throw new NotFoundError('Prüfmittel');
    return equipment;
  });
}
