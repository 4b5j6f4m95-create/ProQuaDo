import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export interface CreateDocumentCommand {
  actor: Actor;
  projectId: string;
  documentNumber: string;
  title: string;
  category?: string;
  department?: string;
  /** Metadata for the mandatory first revision (DRAFT), no file yet. */
  firstRevision: { title: string; description?: string };
}

/** Creates a document identity AND its first revision (DRAFT) atomically —
 * a document with zero revisions is not a meaningful state to leave behind. */
export async function createDocument(command: CreateDocumentCommand) {
  await assertPermission(command.actor, 'document.upload');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const document = await tx.document.create({
      data: {
        organizationId: command.actor.organizationId,
        projectId: command.projectId,
        documentNumber: command.documentNumber,
        title: command.title,
        category: command.category,
        department: command.department,
      },
    });

    const revision = await tx.documentRevision.create({
      data: {
        organizationId: command.actor.organizationId,
        documentId: document.id,
        revisionNumber: '01',
        status: 'DRAFT',
        title: command.firstRevision.title,
        description: command.firstRevision.description,
        createdById: command.actor.userId,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document.created',
      resourceType: 'document',
      resourceId: document.id,
      actorId: command.actor.userId,
      newValues: { documentNumber: document.documentNumber, title: document.title },
      source: 'web',
    });

    return { document, revision };
  });
}

export interface CreateDocumentRevisionCommand {
  actor: Actor;
  documentId: string;
  title: string;
  description?: string;
  changeReason: string;
}

/** Adds a new DRAFT revision to an existing document, chained to the prior
 * revision for history (Geschäftsgrundsatz 6: tatsächlich verwendete
 * Revisionen bleiben nachvollziehbar). */
export async function createDocumentRevision(command: CreateDocumentRevisionCommand) {
  await assertPermission(command.actor, 'document.revise');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: command.documentId },
      include: { revisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!document) throw new NotFoundError('Dokument');

    const priorRevision = document.revisions[0];
    const nextRevisionNumber = String(
      priorRevision ? parseInt(priorRevision.revisionNumber, 10) + 1 : 1,
    ).padStart(2, '0');

    const revision = await tx.documentRevision.create({
      data: {
        organizationId: command.actor.organizationId,
        documentId: document.id,
        revisionNumber: nextRevisionNumber,
        status: 'DRAFT',
        title: command.title,
        description: command.description,
        changeReason: command.changeReason,
        createdById: command.actor.userId,
        priorRevisionId: priorRevision?.id,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'document_revision.created',
      resourceType: 'document_revision',
      resourceId: revision.id,
      actorId: command.actor.userId,
      newValues: { documentId: document.id, revisionNumber: revision.revisionNumber },
      reason: command.changeReason,
      source: 'web',
    });

    return revision;
  });
}
