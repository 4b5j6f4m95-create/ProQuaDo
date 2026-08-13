import type { Prisma } from '@prisma/client';

import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { isPlanStructureEditable, type PlanRevisionStatus } from './plan-revision-status';

/**
 * Offene Zeichnungsverweise erneut nachschlagen.
 *
 * Beim Import wird jede im Modell genannte Zeichnung einmal gesucht. Findet
 * sich kein freigegebenes Dokument dieser Nummer im Projekt, bleibt der
 * Verweis offen stehen — und blieb es bisher **für immer**, auch wenn die
 * Zeichnung eine Woche später hochgeladen und freigegeben wurde. Die
 * Oberfläche versprach dabei das Gegenteil.
 *
 * **Zwei Vorgänge, die hier auseinandergehalten werden**, und das ist die
 * eigentliche Entscheidung:
 *
 *  - **Auflösen** heißt: festhalten, dass die im Modell genannte Zeichnung
 *    inzwischen als Dokument im System liegt. Das ist eine Feststellung über
 *    die Wirklichkeit, keine Anweisung — der Verweis ist ein Fund aus der
 *    Datei, nicht etwas, das der Plan anordnet. Deshalb jederzeit zulässig,
 *    unabhängig vom Status der Planrevision.
 *  - **Binden** heißt: die Revision wird für diesen Schritt verbindlich. Das
 *    ist eine Planänderung, geht in den `documentSetHash` der Schrittfreigabe
 *    ein — und ist deshalb nur im Status DRAFT zulässig, genau wie bei
 *    `bindDocumentToPlanStep`.
 *
 * An einer freigegebenen Planrevision wird also aufgelöst und **nicht**
 * gebunden. Der Verweis steht danach im Arbeitsschritt als „inzwischen im
 * System, aber nicht Teil der freigegebenen Unterlagen" — nachlesbar, ohne zu
 * behaupten, es sei angeordnet. Wer ihn für einen laufenden Auftrag in die
 * Akte holen will, reicht ihn nach (`work-step-supplements.ts`); wer ihn
 * verbindlich machen will, braucht eine neue Planrevision. Beides ist eine
 * Entscheidung, die ein Mensch trifft, und keine, die ein Nachschlagen
 * nebenbei fällt.
 */

/** Was `findDocumentForDrawing` zum Suchen braucht — aus der IFC-Datei wie
 *  aus einer bereits gespeicherten Verweiszeile. */
export interface DrawingLookupKey {
  identification?: string | null;
  name?: string | null;
}

/**
 * Sucht das Dokument zu einem Zeichnungsverweis.
 *
 * **Diese Funktion ist mit Absicht die einzige Stelle**, an der die
 * Zuordnungsregel steht. Import und Nachschlagen müssen dieselbe Zeichnung
 * finden, sonst hinge das Ergebnis davon ab, wann jemand geklickt hat.
 *
 * Zuerst über die Zeichnungsnummer (`Identification`), die im Modell wie im
 * Dokumentenverzeichnis der Schlüssel ist; nur wenn die fehlt, ersatzweise
 * über den Titel als exakter Vergleich. Groß- und Kleinschreibung spielt
 * keine Rolle — Modell und Verzeichnis werden von verschiedenen Leuten
 * gepflegt.
 */
export async function findDocumentForDrawing(
  tx: Prisma.TransactionClient,
  projectId: string,
  drawing: DrawingLookupKey,
): Promise<{ documentId: string; revisionId: string; revisionNumber: string } | null> {
  const where = drawing.identification
    ? {
        projectId,
        documentNumber: { equals: drawing.identification, mode: 'insensitive' as const },
      }
    : drawing.name
      ? { projectId, title: { equals: drawing.name, mode: 'insensitive' as const } }
      : null;
  if (!where) return null;

  const document = await tx.document.findFirst({
    where,
    select: {
      id: true,
      revisions: {
        where: { status: 'RELEASED' },
        // Die zuletzt freigegebene Fassung — `validFrom` ist der Zeitpunkt,
        // ab dem sie gilt, und damit die Reihenfolge, in der die Halle sie
        // kennt.
        orderBy: [{ validFrom: 'desc' }, { revisionNumber: 'desc' }],
        take: 1,
        select: { id: true, revisionNumber: true },
      },
    },
  });

  const revision = document?.revisions[0];
  if (!document || !revision) return null;
  return {
    documentId: document.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
  };
}

export interface ResolveDrawingReferencesResult {
  /** Offene Verweise, die geprüft wurden. */
  checked: number;
  /** Davon einem freigegebenen Dokument zugeordnet. */
  resolved: number;
  /** Davon zusätzlich verbindlich gebunden — nur im Status DRAFT möglich. */
  bound: number;
  /** Verweise, zu denen weiterhin kein freigegebenes Dokument existiert. */
  stillOpen: number;
  /**
   * Wahr, wenn etwas gefunden wurde, aber nicht gebunden werden konnte, weil
   * die Planrevision den Entwurfsstatus verlassen hat. Die Oberfläche muss
   * das sagen können — „gefunden, aber nicht verbindlich" ist ein anderes
   * Ergebnis als „gefunden".
   */
  bindingBlocked: boolean;
}

/**
 * Der Kern, auf einer bestehenden Transaktion.
 *
 * Getrennt vom öffentlichen Dienst, weil `submitProductionPlanForReview` ihn
 * innerhalb seiner eigenen Transaktion aufruft — dort ist der letzte
 * Zeitpunkt, zu dem eine Bindung überhaupt noch entstehen kann.
 */
export async function resolveDrawingReferencesWithin(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; actorId: string; productionPlanRevisionId: string },
): Promise<ResolveDrawingReferencesResult> {
  const revision = await tx.productionPlanRevision.findFirst({
    where: { id: input.productionPlanRevisionId },
    select: {
      id: true,
      status: true,
      productionPlan: { select: { projectId: true } },
    },
  });
  if (!revision) throw new NotFoundError('Fertigungsplan-Revision');

  const mayBind = isPlanStructureEditable(revision.status as PlanRevisionStatus);
  const projectId = revision.productionPlan.projectId;

  const open = await tx.ifcDrawingReference.findMany({
    where: {
      documentRevisionId: null,
      planStep: { productionPlanRevisionId: revision.id },
    },
    orderBy: [{ identification: 'asc' }, { name: 'asc' }],
    select: { id: true, planStepId: true, identification: true, name: true },
  });

  const result: ResolveDrawingReferencesResult = {
    checked: open.length,
    resolved: 0,
    bound: 0,
    stillOpen: 0,
    bindingBlocked: false,
  };
  const found: Array<{ identification: string | null; revisionNumber: string; bound: boolean }> =
    [];

  for (const reference of open) {
    const match = await findDocumentForDrawing(tx, projectId, reference);
    if (!match) {
      result.stillOpen += 1;
      continue;
    }

    await tx.ifcDrawingReference.update({
      where: { id: reference.id },
      data: { documentId: match.documentId, documentRevisionId: match.revisionId },
    });
    result.resolved += 1;

    let bound = false;
    if (mayBind) {
      // `upsert` wie beim Import: zwei Verweise auf dieselbe Zeichnung an
      // demselben Schritt sind dieselbe Aussage, kein Fehler.
      await tx.stepDocumentBinding.upsert({
        where: {
          planStepId_documentRevisionId: {
            planStepId: reference.planStepId,
            documentRevisionId: match.revisionId,
          },
        },
        create: {
          organizationId: input.organizationId,
          planStepId: reference.planStepId,
          documentId: match.documentId,
          documentRevisionId: match.revisionId,
          markerLabel: 'Aus IFC-Modell',
        },
        update: {},
      });
      result.bound += 1;
      bound = true;
    }

    found.push({
      identification: reference.identification,
      revisionNumber: match.revisionNumber,
      bound,
    });
  }

  result.bindingBlocked = result.resolved > 0 && !mayBind;

  // Nur schreiben, wenn sich etwas geändert hat. Ein Audit-Eintrag für jeden
  // ergebnislosen Knopfdruck macht den Trail länger und nicht aussagekräftiger.
  if (result.resolved > 0) {
    await writeAuditEvent(tx, {
      organizationId: input.organizationId,
      eventType: 'ifc_drawing_reference.resolved',
      resourceType: 'production_plan_revision',
      resourceId: revision.id,
      actorId: input.actorId,
      newValues: {
        checked: result.checked,
        resolved: result.resolved,
        bound: result.bound,
        stillOpen: result.stillOpen,
        planRevisionStatus: revision.status,
        drawings: found,
      },
      source: 'web',
    });
  }

  return result;
}

export interface ResolveDrawingReferencesCommand {
  actor: Actor;
  productionPlanRevisionId: string;
}

export async function resolveDrawingReferences(
  command: ResolveDrawingReferencesCommand,
): Promise<ResolveDrawingReferencesResult> {
  // Dasselbe Atom, das `bindDocumentToPlanStep` verlangt — und aus demselben
  // Grund: an einer Entwurfsrevision entstehen hier Bindungen. Kein eigenes
  // Atom, weil das Nachschlagen keine eigene Befugnis ist, sondern die
  // maschinelle Ausführung dessen, was jemand mit diesem Recht sonst von Hand
  // täte. Dass an einer freigegebenen Revision nur aufgelöst wird, macht die
  // Anforderung dort strenger als nötig; eine vom Planstatus abhängige
  // Berechtigung wäre schwerer zu prüfen als sie wert ist.
  await assertPermission(command.actor, 'work_step_definition.update');

  return withOrgContext(command.actor.organizationId, async (tx) =>
    resolveDrawingReferencesWithin(tx, {
      organizationId: command.actor.organizationId,
      actorId: command.actor.userId,
      productionPlanRevisionId: command.productionPlanRevisionId,
    }),
  );
}
