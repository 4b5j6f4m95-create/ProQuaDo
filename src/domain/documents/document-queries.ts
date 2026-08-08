import { withOrgContext } from '@/lib/db/tenant-context';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

export async function getDocument(actor: Actor, documentId: string) {
  await assertPermission(actor, 'document.view');

  return withOrgContext(actor.organizationId, async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: documentId },
      include: { revisions: { orderBy: { revisionNumber: 'desc' } } },
    });
    if (!document) throw new NotFoundError('Dokument');
    return document;
  });
}

/**
 * The one query that matters most for execution correctness: "what is
 * currently binding for this document" — never "latest", always the
 * revision whose status is exactly RELEASED (see Geschäftsgrundsatz 5).
 * Returns null if nothing has ever been released, which callers must
 * treat as "no binding revision available", not as an error.
 */
export async function getReleasedRevision(actor: Actor, documentId: string) {
  await assertPermission(actor, 'document.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.documentRevision.findFirst({ where: { documentId, status: 'RELEASED' } }),
  );
}

export async function listDocuments(actor: Actor, filter?: { projectId?: string }) {
  await assertPermission(actor, 'document.view');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.document.findMany({
      where: filter?.projectId ? { projectId: filter.projectId } : undefined,
      include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}
