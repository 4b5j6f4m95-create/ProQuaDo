'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createDocument, createDocumentRevision } from '@/domain/documents/create-document';
import {
  submitDocumentRevisionForReview,
  approveDocumentRevision,
  rejectDocumentRevision,
  releaseDocumentRevision,
  withdrawDocumentRevision,
} from '@/domain/documents/document-review-workflow';

export async function createDocumentAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const { document } = await createDocument({
    actor,
    projectId: String(formData.get('projectId')),
    documentNumber: String(formData.get('documentNumber')),
    title: String(formData.get('title')),
    category: formData.get('category') ? String(formData.get('category')) : undefined,
    firstRevision: { title: String(formData.get('title')) },
  });
  redirect(`/documents/${document.id}`);
}

export async function createDocumentRevisionAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const documentId = String(formData.get('documentId'));
  await createDocumentRevision({
    actor,
    documentId,
    title: String(formData.get('title')),
    changeReason: String(formData.get('changeReason')),
  });
  revalidatePath(`/documents/${documentId}`);
}

async function runWorkflowAction(
  formData: FormData,
  fn: (args: {
    actor: Awaited<ReturnType<typeof requireAuthContext>>;
    documentRevisionId: string;
    reason?: string;
  }) => Promise<unknown>,
): Promise<void> {
  const actor = await requireAuthContext();
  const documentRevisionId = String(formData.get('documentRevisionId'));
  const documentId = String(formData.get('documentId'));
  const reason = formData.get('reason') ? String(formData.get('reason')) : undefined;
  await fn({ actor, documentRevisionId, reason });
  revalidatePath(`/documents/${documentId}`);
}

export async function submitForReviewAction(formData: FormData): Promise<void> {
  await runWorkflowAction(formData, ({ actor, documentRevisionId }) =>
    submitDocumentRevisionForReview({ actor, documentRevisionId }),
  );
}

export async function approveAction(formData: FormData): Promise<void> {
  await runWorkflowAction(formData, ({ actor, documentRevisionId, reason }) =>
    approveDocumentRevision({ actor, documentRevisionId, reason }),
  );
}

export async function rejectAction(formData: FormData): Promise<void> {
  await runWorkflowAction(formData, ({ actor, documentRevisionId, reason }) =>
    rejectDocumentRevision({ actor, documentRevisionId, reason: reason ?? 'Kein Grund angegeben' }),
  );
}

export async function releaseAction(formData: FormData): Promise<void> {
  await runWorkflowAction(formData, ({ actor, documentRevisionId }) =>
    releaseDocumentRevision({ actor, documentRevisionId }),
  );
}

export async function withdrawAction(formData: FormData): Promise<void> {
  await runWorkflowAction(formData, ({ actor, documentRevisionId, reason }) =>
    withdrawDocumentRevision({
      actor,
      documentRevisionId,
      reason: reason ?? 'Kein Grund angegeben',
    }),
  );
}
