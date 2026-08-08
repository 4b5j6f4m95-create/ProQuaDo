'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { exportProductionDossier, type ExportFormat } from '@/domain/dossier/export-dossier';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/domain/notifications/notification-queries';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export interface ExportFormState {
  error: string | null;
  downloadUrl: string | null;
  summary: string | null;
}

/**
 * Generates the export and hands back a signed download URL. Returns errors
 * instead of throwing: an export refused for exceeding the size limit
 * (ADR-007) is a normal outcome with a next action, not an error page.
 */
export async function exportDossierAction(
  _prevState: ExportFormState,
  formData: FormData,
): Promise<ExportFormState> {
  const productionOrderId = String(formData.get('productionOrderId'));
  try {
    const actor = await requireAuthContext();
    const result = await exportProductionDossier({
      actor,
      productionOrderId,
      format: String(formData.get('format')) as ExportFormat,
    });

    const manifest = result.manifest;
    const summary = manifest
      ? `${manifest.summary.total} Einträge · ${manifest.summary.verified} per Hash bestätigt` +
        (manifest.summary.mismatched > 0 ? ` · ${manifest.summary.mismatched} abweichend` : '') +
        (manifest.summary.missing > 0 ? ` · ${manifest.summary.missing} fehlend` : '')
      : `PDF erzeugt · SHA-256 ${result.fileHashSha256.slice(0, 16)}…`;

    revalidatePath(`/production-orders/${productionOrderId}/dossier`);
    return { error: null, downloadUrl: result.downloadUrl, summary };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message, downloadUrl: null, summary: null };
    }
    throw error;
  }
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  await markNotificationRead(actor, String(formData.get('notificationId')));
  revalidatePath('/notifications');
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const actor = await requireAuthContext();
  await markAllNotificationsRead(actor);
  revalidatePath('/notifications');
}
