'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { decideSyncConflict } from '@/domain/sync/decide-conflict';
import { revokeDevice } from '@/domain/sync/device-registry';
import type { ConflictDecisionType } from '@/domain/sync/conflict-types';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export interface ConflictDecisionFormState {
  error: string | null;
  resultingAction: string | null;
}

/**
 * Konfliktcenter-Entscheidung (docs/07 B4). Returns its error instead of
 * throwing: "diese Entscheidung ist für diesen Konflikttyp nicht zulässig"
 * and a wrong PIN both belong next to the form, with the reason the person
 * typed still in the field.
 */
export async function decideConflictAction(
  _prevState: ConflictDecisionFormState,
  formData: FormData,
): Promise<ConflictDecisionFormState> {
  const conflictId = String(formData.get('conflictId'));
  try {
    const actor = await requireAuthContext();
    const result = await decideSyncConflict({
      actor,
      conflictId,
      decision: String(formData.get('decision')) as ConflictDecisionType,
      reason: String(formData.get('reason')),
      pin: String(formData.get('pin')),
    });
    revalidatePath('/sync/conflicts');
    revalidatePath(`/sync/conflicts/${conflictId}`);
    return { error: null, resultingAction: result.resultingAction };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message, resultingAction: null };
    }
    throw error;
  }
}

export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  await revokeDevice({
    actor,
    deviceId: String(formData.get('deviceId')),
    reason: String(formData.get('reason')),
  });
  revalidatePath('/sync/devices');
}
