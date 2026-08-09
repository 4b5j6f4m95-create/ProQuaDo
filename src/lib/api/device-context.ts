import { z } from 'zod';
import { withOrgContext } from '@/lib/db/tenant-context';
import { ValidationError } from '@/lib/domain-errors';
import { assertDeviceActive } from '@/domain/sync/device-registry';
import type { Actor } from '@/domain/shared/actor';

/**
 * Turns a client-supplied `deviceId` into a **verified** one, or refuses.
 *
 * Until Phase 7 the online endpoints accepted `deviceId` as free text
 * (`z.string().max(255)`) and never looked it up. Three consequences, none of
 * them cosmetic:
 *
 *  1. **The remote lock did not cover the online path.** `assertDeviceActive`
 *     ran only inside `/sync/*`. A revoked tablet whose session cookie was
 *     still valid could keep starting steps, capturing evidence and
 *     submitting completions through the ordinary API — which is precisely
 *     the situation docs/06 "Geräteverlust und Sicherheit" exists to end.
 *  2. **Device attribution in the audit trail was a client claim.** The value
 *     landed verbatim in `audit_events.device_id`, `photo_evidence.device_id`,
 *     `step_confirmations.device_id` and `completion_submissions.device_id`,
 *     none of which carry a foreign key. "Which device confirmed this step"
 *     is an audit question, and its answer must not be free text the client
 *     chose.
 *  3. **Device-scoped rate limits were not limits.** `PHOTO_UPLOAD` is
 *     counted per device; with an unvalidated field the caller simply sends a
 *     fresh random id per request and never meets the ceiling.
 *
 * So: no device id, no device context (an online browser genuinely has none).
 * A device id that is present must be a UUID, must exist, must belong to the
 * calling user, and must not be revoked — the same gate the sync endpoints
 * already opened with, now applied wherever the field is accepted.
 */

const deviceIdSchema = z.string().uuid();

export async function resolveDeviceId(
  actor: Actor,
  deviceId: string | undefined | null,
): Promise<string | undefined> {
  if (deviceId === undefined || deviceId === null || deviceId === '') return undefined;

  const parsed = deviceIdSchema.safeParse(deviceId);
  if (!parsed.success) {
    // Deliberately not NotFoundError: a malformed id is a client bug, not a
    // membership question, and saying so costs nothing — the id was never a
    // secret, it is issued to the client by POST /api/v1/devices.
    throw new ValidationError(
      'deviceId muss die vom Server vergebene Geräte-ID sein (UUID aus POST /api/v1/devices).',
    );
  }

  return withOrgContext(actor.organizationId, async (tx) => {
    // Unknown id and someone else's id give the same NotFoundError, revoked
    // gives DeviceRevokedError — see assertDeviceActive for why the first two
    // must not be distinguishable.
    const device = await assertDeviceActive(tx, actor, parsed.data);
    return device.id;
  });
}
