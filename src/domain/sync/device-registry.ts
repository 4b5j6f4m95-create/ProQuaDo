import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { DeviceRevokedError, NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * Device registration and revocation — docs/06 "Geräteverlust und
 * Sicherheit".
 *
 * The device id is issued by the SERVER, not proposed by the client. A
 * client-chosen id would let one tablet adopt another's identity and, with
 * it, its sync cursor and its command history; both are used for
 * idempotency, so the consequence is not cosmetic.
 *
 * Revocation is the remote-wipe lever: `assertDeviceActive` runs at the
 * start of every sync operation, so a revoked device can neither push its
 * outbox nor pull changes from the next attempt onward.
 */

export interface RegisterDeviceCommand {
  actor: Actor;
  deviceLabel?: string;
}

export interface RegisteredDevice {
  deviceId: string;
  deviceLabel: string | null;
  registeredAt: Date;
}

export async function registerDevice(command: RegisterDeviceCommand): Promise<RegisteredDevice> {
  return withOrgContext(command.actor.organizationId, async (tx) => {
    const device = await tx.device.create({
      data: {
        organizationId: command.actor.organizationId,
        userId: command.actor.userId,
        deviceLabel: command.deviceLabel,
        lastSeenAt: new Date(),
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'device.registered',
      resourceType: 'device',
      resourceId: device.id,
      actorId: command.actor.userId,
      newValues: { deviceLabel: device.deviceLabel },
      deviceId: device.id,
      source: 'mobile',
    });

    return {
      deviceId: device.id,
      deviceLabel: device.deviceLabel,
      registeredAt: device.createdAt,
    };
  });
}

export interface RevokeDeviceCommand {
  actor: Actor;
  deviceId: string;
  reason: string;
}

/**
 * Admin action. Deliberately does NOT delete the device row: its sync
 * commands and audit events reference it, and a wiped tablet whose history
 * disappeared with it would be exactly the gap an audit asks about.
 */
export async function revokeDevice(command: RevokeDeviceCommand): Promise<void> {
  await assertPermission(command.actor, 'device.manage');

  await withOrgContext(command.actor.organizationId, async (tx) => {
    const device = await tx.device.findFirst({ where: { id: command.deviceId } });
    if (!device) throw new NotFoundError('Gerät');
    if (device.isRevoked) return;

    await tx.device.update({
      where: { id: device.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedById: command.actor.userId,
        revokedReason: command.reason,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'device.revoked',
      resourceType: 'device',
      resourceId: device.id,
      actorId: command.actor.userId,
      previousValues: { isRevoked: false },
      newValues: { isRevoked: true },
      reason: command.reason,
      source: 'web',
    });
  });
}

export type ActiveDevice = { id: string; userId: string; deviceLabel: string | null };

/**
 * The gate every sync entry point opens with. Also enforces that the device
 * belongs to the calling user: a stolen device id from another account must
 * not become a usable sync identity just because the thief can authenticate
 * as somebody else in the same organization.
 */
export async function assertDeviceActive(
  tx: Prisma.TransactionClient,
  actor: Actor,
  deviceId: string,
): Promise<ActiveDevice> {
  const device = await tx.device.findFirst({
    where: { id: deviceId },
    select: { id: true, userId: true, deviceLabel: true, isRevoked: true, revokedReason: true },
  });
  // Not-found and wrong-owner give the same answer, for the same reason
  // cross-tenant access returns 404: an error that distinguishes them is a
  // membership oracle.
  if (!device || device.userId !== actor.userId) throw new NotFoundError('Gerät');
  if (device.isRevoked) {
    throw new DeviceRevokedError(device.revokedReason ?? undefined);
  }
  return { id: device.id, userId: device.userId, deviceLabel: device.deviceLabel };
}

export async function touchDevice(
  tx: Prisma.TransactionClient,
  deviceId: string,
  synced: boolean,
): Promise<void> {
  const now = new Date();
  await tx.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: now, ...(synced ? { lastSyncAt: now } : {}) },
  });
}

export async function listDevicesOfActor(actor: Actor) {
  return withOrgContext(actor.organizationId, (tx) =>
    tx.device.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        isRevoked: true,
        lastSeenAt: true,
        lastSyncAt: true,
        createdAt: true,
      },
    }),
  );
}
