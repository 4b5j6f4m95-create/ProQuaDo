import type { Prisma } from '@prisma/client';

/**
 * Abnahmeszenario C, verbatim from docs/06:
 *
 *   T1 the worker goes offline with Rev.04 cached, T2 the project lead
 *   releases Rev.05, T3 the worker finishes offline against Rev.04, T4 the
 *   device syncs.
 *
 * What must happen at T4 — and what this module answers — is only the
 * detection: is what the device worked from still the binding revision? The
 * consequences are deliberately elsewhere (sync-commands.ts blocks the step,
 * decide-conflict.ts carries out the decision), because the one thing that
 * must never happen is rewriting history to Rev.05. The execution stays
 * documented as "performed against Rev.04" forever.
 */

export interface RevisionMismatch {
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  usedRevisionId: string;
  usedRevisionNumber: string;
  usedRevisionStatus: string;
  currentRevisionId: string | null;
  currentRevisionNumber: string | null;
  currentRevisionReleasedAt: string | null;
  changeReason: string | null;
}

export interface RevisionConflictCheck {
  hasConflict: boolean;
  /** Bound revisions that are no longer the released ones — the actual
   *  Abnahmeszenario C signal. Detected regardless of what the client
   *  claimed, because it is a fact about the server's own data. */
  mismatches: RevisionMismatch[];
  /** Bound revisions the client did NOT list among the ones it displayed.
   *  Only evaluated when the client made a claim at all: an empty list means
   *  "no statement", and absence of a claim is not evidence of absence. */
  missingBindings: Array<{ documentNumber: string; revisionNumber: string; revisionId: string }>;
}

/**
 * @param usedDocumentRevisionIds what the device says it displayed while the
 * work was performed (`CompletionSubmission.usedDocumentRevisionIds`). May be
 * empty — see `missingBindings`.
 */
export async function checkRevisionConflict(
  tx: Prisma.TransactionClient,
  params: {
    workStepInstanceId: string;
    usedDocumentRevisionIds: readonly string[];
  },
): Promise<RevisionConflictCheck> {
  const instance = await tx.workStepInstance.findFirst({
    where: { id: params.workStepInstanceId },
    select: {
      planStep: {
        select: {
          documentBindings: {
            select: {
              documentRevisionId: true,
              documentRevision: {
                select: {
                  id: true,
                  revisionNumber: true,
                  status: true,
                  documentId: true,
                  document: { select: { id: true, documentNumber: true, title: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!instance) return { hasConflict: false, mismatches: [], missingBindings: [] };

  const bindings = instance.planStep.documentBindings;
  if (bindings.length === 0) {
    return { hasConflict: false, mismatches: [], missingBindings: [] };
  }

  const used = new Set(params.usedDocumentRevisionIds);
  const clientDeclaredItsDocumentSet = used.size > 0;
  const mismatches: RevisionMismatch[] = [];
  const missingBindings: RevisionConflictCheck['missingBindings'] = [];

  for (const binding of bindings) {
    const revision = binding.documentRevision;

    // A binding always points at ONE specific revision, never at "latest"
    // (Geschäftsgrundsatz 6). So the question is not "did the binding move"
    // but "is the revision this binding names still the released one for its
    // document" — that is what a supersede changes.
    if (revision.status === 'RELEASED') {
      if (clientDeclaredItsDocumentSet && !used.has(revision.id)) {
        missingBindings.push({
          documentNumber: revision.document.documentNumber,
          revisionNumber: revision.revisionNumber,
          revisionId: revision.id,
        });
      }
      continue;
    }

    const current = await tx.documentRevision.findFirst({
      where: { documentId: revision.documentId, status: 'RELEASED' },
      orderBy: { releasedAt: 'desc' },
      select: { id: true, revisionNumber: true, releasedAt: true, changeReason: true },
    });

    mismatches.push({
      documentId: revision.document.id,
      documentNumber: revision.document.documentNumber,
      documentTitle: revision.document.title,
      usedRevisionId: revision.id,
      usedRevisionNumber: revision.revisionNumber,
      usedRevisionStatus: revision.status,
      currentRevisionId: current?.id ?? null,
      currentRevisionNumber: current?.revisionNumber ?? null,
      currentRevisionReleasedAt: current?.releasedAt?.toISOString() ?? null,
      changeReason: current?.changeReason ?? null,
    });
  }

  return {
    hasConflict: mismatches.length > 0 || missingBindings.length > 0,
    mismatches,
    missingBindings,
  };
}

/** One sentence a project lead can act on, in the wording of docs/07 A8. */
export function describeRevisionConflict(check: RevisionConflictCheck): string {
  const parts: string[] = [];
  for (const mismatch of check.mismatches) {
    parts.push(
      `${mismatch.documentNumber} wurde von Rev. ${mismatch.usedRevisionNumber} auf ` +
        `Rev. ${mismatch.currentRevisionNumber ?? '—'} aktualisiert, während offline gearbeitet wurde.`,
    );
  }
  for (const missing of check.missingBindings) {
    parts.push(
      `Für ${missing.documentNumber} Rev. ${missing.revisionNumber} wurde nicht belegt, ` +
        `dass die verbindliche Unterlage bei der Ausführung vorlag.`,
    );
  }
  return parts.join(' ');
}
