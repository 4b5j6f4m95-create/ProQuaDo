import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * Unterlagen, die einem Arbeitsschritt **nachträglich** beigelegt werden.
 *
 * Der Anlass ist eine Aussage aus der Fertigung: „Detailzeichnungen oder
 * Zulassungen werden nachträglich zugeordnet." Bis hierher ging das nicht —
 * `bindDocumentToPlanStep` verlangt eine Planrevision im Status DRAFT, und
 * nach dem Einreichen ist der Plan zu.
 *
 * **Der Zuschnitt ist die eigentliche Entscheidung, und er ist eng.** Eine
 * Beilage hängt an der *Schrittinstanz*, nicht am Planschritt:
 *
 *   - Sie ändert den Plan nicht. Ein zweiter Auftrag gegen dieselbe Revision
 *     bekommt sie nicht automatisch — sie gehört zu diesem Vorgang.
 *   - Sie geht **nicht** in den `documentSetHash` der Schrittfreigabe ein und
 *     löst deshalb keinen Revisionskonflikt aus. Ein Werker, der gerade
 *     arbeitet, wird nicht unterbrochen.
 *   - Sie ist deshalb auch an einem laufenden oder bereits abgeschlossenen
 *     Schritt zulässig. Genau dafür gibt es sie: die Zulassung trifft ein,
 *     wenn das Modul längst fertig ist.
 *
 * **Wofür sie ausdrücklich nicht gedacht ist:** eine Zeichnung, die die
 * Arbeit ändert. Die ist eine Planänderung und braucht eine neue
 * Planrevision. Diese Unterscheidung ist nicht technisch erzwingbar — sie
 * steht in der Oberfläche, im Namen („nachgereicht") und in der Akte, die
 * beides getrennt ausweist.
 */

export interface AddWorkStepSupplementCommand {
  actor: Actor;
  workStepInstanceId: string;
  documentRevisionId: string;
  /** Warum die Unterlage erst jetzt dazukommt. Pflicht. */
  reason: string;
}

const MIN_REASON_LENGTH = 3;

export async function addWorkStepSupplement(command: AddWorkStepSupplementCommand) {
  await assertPermission(command.actor, 'work_step_supplement.manage');

  const reason = command.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ValidationError(
      'Bitte begründen, warum die Unterlage nachgereicht wird — sie steht später ohne ' +
        'Zusammenhang in der Produktionsakte.',
    );
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const instance = await tx.workStepInstance.findFirst({
      where: { id: command.workStepInstanceId },
      select: {
        id: true,
        stepNumber: true,
        productionOrderId: true,
        productionOrder: { select: { status: true, projectId: true, orderNumber: true } },
      },
    });
    if (!instance) throw new NotFoundError('Arbeitsschritt');

    // Ein stornierter Auftrag wird nicht mehr ergänzt. Seine Akte ist das
    // Protokoll eines Abbruchs; etwas nachzureichen hieße, sie nachträglich
    // zu einem Vorgang zu machen, den es nicht gab.
    if (instance.productionOrder.status === 'CANCELLED') {
      throw new ValidationError(
        'Der Produktionsauftrag ist storniert. An einen stornierten Auftrag wird nichts ' +
          'mehr nachgereicht.',
      );
    }

    const revision = await tx.documentRevision.findFirst({
      where: { id: command.documentRevisionId },
      select: {
        id: true,
        status: true,
        revisionNumber: true,
        document: { select: { id: true, documentNumber: true, title: true, projectId: true } },
      },
    });
    if (!revision) throw new NotFoundError('Dokumentrevision');

    // Dieselbe Bedingung wie bei einer verbindlichen Bindung: nur eine
    // freigegebene Revision darf in einen Fertigungsvorgang. Eine Beilage ist
    // schwächer als eine Bindung, aber kein Schlupfloch für Entwürfe.
    if (revision.status !== 'RELEASED') {
      throw new ValidationError(
        `Nur eine freigegebene Dokumentrevision kann nachgereicht werden (Status ist ` +
          `${revision.status}).`,
      );
    }

    // Über Projektgrenzen hinweg beilegen wäre der einzige Weg, ein fremdes
    // Dokument in eine Akte zu bekommen. RLS trennt Mandanten, nicht Projekte.
    if (revision.document.projectId !== instance.productionOrder.projectId) {
      throw new ValidationError('Das Dokument gehört nicht zum Projekt dieses Auftrags.');
    }

    const existing = await tx.workStepSupplement.findFirst({
      where: {
        workStepInstanceId: instance.id,
        documentRevisionId: revision.id,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError(
        `${revision.document.documentNumber} Rev. ${revision.revisionNumber} liegt diesem ` +
          'Schritt bereits bei.',
      );
    }

    const supplement = await tx.workStepSupplement.create({
      data: {
        organizationId: command.actor.organizationId,
        workStepInstanceId: instance.id,
        documentRevisionId: revision.id,
        reason,
        addedById: command.actor.userId,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.supplement_added',
      resourceType: 'work_step_instance',
      resourceId: instance.id,
      actorId: command.actor.userId,
      newValues: {
        supplementId: supplement.id,
        documentNumber: revision.document.documentNumber,
        revisionNumber: revision.revisionNumber,
        // Die Begründung gehört in den Audit-Trail und nicht nur in die
        // Zeile: verschwindet die Beilage später wieder, bleibt nachlesbar,
        // womit sie begründet worden war.
        reason,
        stepNumber: instance.stepNumber,
        orderNumber: instance.productionOrder.orderNumber,
      },
      source: 'web',
    });

    return supplement;
  });
}

export interface RemoveWorkStepSupplementCommand {
  actor: Actor;
  supplementId: string;
  /** Warum die Beilage wieder entfernt wird. Pflicht. */
  reason: string;
}

/**
 * Entfernt eine Beilage wieder — etwa weil die falsche Revision beigelegt
 * wurde.
 *
 * **Die Zeile geht, der Vorgang bleibt.** Beide Ereignisse stehen im
 * append-only Audit-Trail, mit beiden Begründungen. Eine Akte, die eine
 * Beilage nicht mehr zeigt, ist damit nicht eine Akte, in der nie eine war.
 */
export async function removeWorkStepSupplement(command: RemoveWorkStepSupplementCommand) {
  await assertPermission(command.actor, 'work_step_supplement.manage');

  const reason = command.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ValidationError('Bitte begründen, warum die Beilage wieder entfernt wird.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const supplement = await tx.workStepSupplement.findFirst({
      where: { id: command.supplementId },
      select: {
        id: true,
        reason: true,
        workStepInstanceId: true,
        documentRevision: {
          select: {
            revisionNumber: true,
            document: { select: { documentNumber: true } },
          },
        },
      },
    });
    if (!supplement) throw new NotFoundError('Nachgereichte Unterlage');

    await tx.workStepSupplement.delete({ where: { id: supplement.id } });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_step.supplement_removed',
      resourceType: 'work_step_instance',
      resourceId: supplement.workStepInstanceId,
      actorId: command.actor.userId,
      previousValues: {
        documentNumber: supplement.documentRevision.document.documentNumber,
        revisionNumber: supplement.documentRevision.revisionNumber,
        addedReason: supplement.reason,
      },
      newValues: { removedReason: reason },
      source: 'web',
    });

    return { id: supplement.id };
  });
}
