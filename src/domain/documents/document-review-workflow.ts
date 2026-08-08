import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { writeOutboxEvent } from '@/lib/audit/write-outbox-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { isValidDocumentRevisionTransition, type DocumentRevisionStatus } from './document-status';

async function loadRevisionOrThrow(tx: Prisma.TransactionClient, revisionId: string) {
  const revision = await tx.documentRevision.findFirst({ where: { id: revisionId } });
  if (!revision) throw new NotFoundError('Dokumentrevision');
  return revision;
}

function assertTransition(
  from: string,
  to: DocumentRevisionStatus,
  entity = 'Dokumentrevision',
): void {
  if (!isValidDocumentRevisionTransition(from as DocumentRevisionStatus, to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

export interface SubmitForReviewCommand {
  actor: Actor;
  documentRevisionId: string;
}

export async function submitDocumentRevisionForReview(command: SubmitForReviewCommand) {
  await assertPermission(command.actor, 'document.revise');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.documentRevisionId);
    assertTransition(revision.status, 'IN_REVIEW');

    // Guard from docs/03: "Datei vollständig hochgeladen, SHA-256
    // verifiziert, Malware-Scan OK" — enforced here, not just in the UI.
    if (!revision.fileHashSha256 || !revision.storageKey) {
      throw new ValidationError(
        'Datei muss vollständig hochgeladen sein, bevor zur Prüfung eingereicht wird.',
      );
    }
    if (revision.malwareScanStatus !== 'CLEAN') {
      throw new ValidationError('Datei muss den Malware-Scan bestanden haben (Status: CLEAN).');
    }

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: { status: 'IN_REVIEW' },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.submitted_for_review',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      source: 'web',
    });

    return updated;
  });
}

export interface ApproveRevisionCommand {
  actor: Actor;
  documentRevisionId: string;
  reason?: string;
}

export async function approveDocumentRevision(command: ApproveRevisionCommand) {
  await assertPermission(command.actor, 'document.approve');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.documentRevisionId);
    assertTransition(revision.status, 'APPROVED');

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: { status: 'APPROVED' },
    });

    await tx.documentApproval.create({
      data: {
        organizationId: command.actor.organizationId,
        documentRevisionId: revision.id,
        approverId: command.actor.userId,
        approvalStatus: 'APPROVED',
        reason: command.reason,
        approvedAt: new Date(),
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.approved',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}

export interface RejectRevisionCommand {
  actor: Actor;
  documentRevisionId: string;
  reason: string;
}

export async function rejectDocumentRevision(command: RejectRevisionCommand) {
  await assertPermission(command.actor, 'document.review');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.documentRevisionId);
    assertTransition(revision.status, 'DRAFT');

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: { status: 'DRAFT' },
    });

    await tx.documentApproval.create({
      data: {
        organizationId: command.actor.organizationId,
        documentRevisionId: revision.id,
        approverId: command.actor.userId,
        approvalStatus: 'REJECTED',
        reason: command.reason,
        approvedAt: new Date(),
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.rejected',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}

export interface ReleaseRevisionCommand {
  actor: Actor;
  documentRevisionId: string;
}

/**
 * APPROVED → RELEASED. If a previous revision of the same document is
 * currently RELEASED, it is atomically moved to SUPERSEDED in the same
 * transaction — there is never a window where two revisions of one
 * document are simultaneously RELEASED (Geschäftsgrundsatz 5/6: only the
 * current released revision is binding for new executions; the old one
 * stays readable, never silently rewritten).
 */
export async function releaseDocumentRevision(command: ReleaseRevisionCommand) {
  await assertPermission(command.actor, 'document.release');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.documentRevisionId);
    assertTransition(revision.status, 'RELEASED');

    const previouslyReleased = await tx.documentRevision.findFirst({
      where: { documentId: revision.documentId, status: 'RELEASED' },
    });

    if (previouslyReleased) {
      await tx.documentRevision.update({
        where: { id: previouslyReleased.id },
        data: { status: 'SUPERSEDED' },
      });
      await writeAuditEvent(tx, {
        organizationId: command.actor.organizationId,
        eventType: 'document_revision.superseded',
        resourceType: 'document_revision',
        resourceId: previouslyReleased.id,
        actorId: command.actor.userId,
        previousValues: { status: 'RELEASED' },
        newValues: { status: 'SUPERSEDED', supersededByRevisionId: revision.id },
        source: 'web',
      });
    }

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: { status: 'RELEASED', releasedById: command.actor.userId, releasedAt: new Date() },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.released',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      source: 'web',
    });

    await writeOutboxEvent(tx, {
      organizationId: command.actor.organizationId,
      aggregateType: 'document_revision',
      aggregateId: revision.id,
      eventType: 'document_revision.released',
      payload: { documentId: revision.documentId, revisionNumber: revision.revisionNumber },
    });

    return updated;
  });
}

export interface WithdrawRevisionCommand {
  actor: Actor;
  documentRevisionId: string;
  reason: string;
}

export async function withdrawDocumentRevision(command: WithdrawRevisionCommand) {
  await assertPermission(command.actor, 'document.withdraw');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const revision = await loadRevisionOrThrow(tx, command.documentRevisionId);
    assertTransition(revision.status, 'WITHDRAWN');

    const updated = await tx.documentRevision.update({
      where: { id: revision.id },
      data: { status: 'WITHDRAWN' },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.withdrawn',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      previousValues: { status: revision.status },
      newValues: { status: updated.status },
      reason: command.reason,
      source: 'web',
    });

    return updated;
  });
}
