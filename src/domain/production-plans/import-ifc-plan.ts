import { createHash } from 'node:crypto';

import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { AlreadyExistsError, NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';
import { parseIfc, IfcParseError, type IfcDrawing, type IfcParseResult } from '@/lib/ifc/parse-ifc';
import type { Prisma } from '@prisma/client';

/**
 * Erzeugt aus einem Gebäudemodell (IFC) einen Fertigungsplan im Entwurf.
 *
 * **Was der Import nicht tut: er gibt nichts frei.** Das Ergebnis ist eine
 * Revision im Status DRAFT und geht denselben Weg wie ein von Hand
 * geschriebener Plan — einreichen, QM genehmigt, PL gibt frei. Eine Datei aus
 * einem Planungsprogramm ist eine Behauptung über die Fertigung, keine
 * geprüfte Anweisung, und die Genehmigung ist genau die Stelle, an der aus
 * dem einen das andere wird. Ein Import, der freigegebene Schritte erzeugt,
 * hätte die Prüfung nicht beschleunigt, sondern abgeschafft.
 *
 * **Jeder erzeugte Schritt verlangt eine Bestätigung.** `signatureRequired`
 * steht auf `true` — nicht als Vorgabe übernommen, sondern hier ausdrücklich
 * gesetzt, weil das die Zusicherung ist, um derentwillen die Schritte
 * überhaupt in dieses System kommen.
 *
 * **Die Reihenfolge kommt aus der Datei.** Die Zahl vor dem Doppelpunkt in
 * `Arbeitsvorgang` ist die Position in der Fertigungsstraße; daraus wird eine
 * `FINISH_TO_START`-Kette, die den Werker daran hindert, Schritt 130 vor
 * Schritt 20 zu beginnen. Lücken in der Nummerierung (4, 5, … 11, 20, 30)
 * sind der Normalfall und bleiben erhalten: sie sind die Nummern, unter denen
 * die Halle diese Vorgänge kennt.
 */
export interface ImportIfcPlanCommand {
  actor: Actor;
  projectId: string;
  productId: string;
  planNumber: string;
  name: string;
  description?: string;
  fileName: string;
  /** Der unveränderte Dateiinhalt. */
  content: Buffer;
  /** Schlüssel im Objektspeicher, unter dem die Datei liegt. */
  storageKey: string;
}

export interface ImportIfcPlanResult {
  planId: string;
  revisionId: string;
  importId: string;
  stepCount: number;
  componentCount: number;
  /** Zeilen in `ifc_drawing_references` — Verweis × Schritt. */
  drawingCount: number;
  /** Davon an ein freigegebenes Dokument gebunden. */
  boundDrawingCount: number;
  warnings: string[];
}

/**
 * Grenze für die Dateigröße. Die Beispieldatei eines Moduls misst 23 MB;
 * 128 MB lassen Raum für größere Module, ohne dass ein versehentlich
 * hochgeladenes Gesamtmodell den Prozessspeicher füllt — der Parser liest
 * die Datei am Stück.
 */
const MAX_IFC_BYTES = 128 * 1024 * 1024;

export async function importIfcPlan(command: ImportIfcPlanCommand): Promise<ImportIfcPlanResult> {
  await assertPermission(command.actor, 'ifc_import.execute');

  if (command.content.byteLength === 0) {
    throw new ValidationError('Die Datei ist leer.');
  }
  if (command.content.byteLength > MAX_IFC_BYTES) {
    throw new ValidationError(
      `Die Datei ist größer als ${MAX_IFC_BYTES / 1024 / 1024} MB und wird nicht verarbeitet.`,
    );
  }

  // IFC im STEP-Format ist per Norm ISO-8859-1 kodiert; Sonderzeichen stehen
  // als \X\-Fluchtfolgen darin und werden vom Parser aufgelöst. Als UTF-8 zu
  // lesen wäre die naheliegende und falsche Wahl — ein Byte 0xFC ist dort
  // ungültig und würde zu einem Ersatzzeichen.
  let parsed: IfcParseResult;
  try {
    parsed = parseIfc(command.content.toString('latin1'));
  } catch (error) {
    if (error instanceof IfcParseError) throw new ValidationError(error.message);
    throw error;
  }

  const fileHash = createHash('sha256').update(command.content).digest('hex');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const product = await tx.product.findFirst({ where: { id: command.productId } });
    if (!product) throw new NotFoundError('Produkt');
    if (product.projectId !== command.projectId) {
      throw new ValidationError('Das Produkt gehört nicht zu diesem Projekt.');
    }

    // Dieselbe Datei zweimal zu importieren erzeugt zwei Pläne mit
    // identischem Inhalt und ist fast immer ein Versehen — ein doppelter
    // Klick oder ein zweiter Anlauf nach einer abgebrochenen Antwort.
    // Abgewiesen mit Verweis auf den vorhandenen Plan, statt ihn stumm zu
    // verdoppeln.
    const duplicate = await tx.ifcImport.findFirst({
      where: { fileHash },
      select: { id: true, fileName: true, importedAt: true },
    });
    if (duplicate) {
      throw new ValidationError(
        `Diese Datei wurde bereits importiert (${duplicate.fileName}, ` +
          `${duplicate.importedAt.toISOString().slice(0, 10)}). ` +
          'Für eine geänderte Fassung eine neue Revision des Plans anlegen.',
      );
    }

    // Je Datei ein eigener Plan heißt: Plannummern werden im Dutzend
    // vergeben, und eine doppelte ist eine Frage der Zeit. Dieselbe Prüfung
    // wie in createProductionPlan, aus demselben Grund — die Zusicherung
    // trägt der Unique-Index, die Meldung dieser Blick.
    const taken = await tx.productionPlan.findFirst({
      where: { planNumber: command.planNumber },
      select: { id: true, name: true },
    });
    if (taken) {
      throw new AlreadyExistsError(
        `Die Plannummer „${command.planNumber}" ist bereits vergeben („${taken.name}"). ` +
          'Bitte eine andere wählen.',
      );
    }

    const plan = await tx.productionPlan.create({
      data: {
        organizationId: command.actor.organizationId,
        projectId: command.projectId,
        productId: command.productId,
        planNumber: command.planNumber,
        name: command.name,
        description: command.description,
      },
    });

    const revision = await tx.productionPlanRevision.create({
      data: {
        organizationId: command.actor.organizationId,
        productionPlanId: plan.id,
        revisionNumber: '01',
        status: 'DRAFT',
        description: `Aus IFC-Modell „${command.fileName}" erzeugt.`,
        createdById: command.actor.userId,
      },
    });

    const stepIdByNumber = new Map<number, string>();
    for (const step of parsed.steps) {
      const created = await tx.planStep.create({
        data: {
          organizationId: command.actor.organizationId,
          productionPlanRevisionId: revision.id,
          stepNumber: step.stepNumber,
          title: step.title,
          description: `${step.componentCount} Bauteil(e) aus dem Modell.`,
          // Der Grund, aus dem der Import überhaupt existiert.
          signatureRequired: true,
          photoRequired: false,
          fourEyesRequired: false,
        },
        select: { id: true },
      });
      stepIdByNumber.set(step.stepNumber, created.id);
    }

    // Die Straße ist eine Kette: jeder Schritt hängt an seinem Vorgänger in
    // der Nummernfolge. Keine Verzweigungen — die Datei kennt keine, und eine
    // zu erfinden hieße, Fertigungswissen zu behaupten, das nicht da ist.
    for (let i = 1; i < parsed.steps.length; i += 1) {
      const current = parsed.steps[i];
      const previous = parsed.steps[i - 1];
      if (!current || !previous) continue;
      const dependentStepId = stepIdByNumber.get(current.stepNumber);
      const predecessorStepId = stepIdByNumber.get(previous.stepNumber);
      if (!dependentStepId || !predecessorStepId) continue;

      await tx.planStepDependency.create({
        data: {
          organizationId: command.actor.organizationId,
          dependentStepId,
          predecessorStepId,
          dependencyType: 'FINISH_TO_START',
        },
      });
    }

    const ifcImport = await tx.ifcImport.create({
      data: {
        organizationId: command.actor.organizationId,
        projectId: command.projectId,
        productId: command.productId,
        productionPlanRevisionId: revision.id,
        fileName: command.fileName,
        fileSizeBytes: command.content.byteLength,
        fileHash,
        storageKey: command.storageKey,
        ifcSchema: parsed.schema,
        sourceApplication: parsed.sourceApplication,
        moduleNumbers: parsed.moduleNumbers,
        stepCount: parsed.steps.length,
        componentCount: parsed.components.length,
        warnings: parsed.warnings,
        importedById: command.actor.userId,
      },
      select: { id: true },
    });

    // `flatMap` statt `map`: ein Bauteil ohne zugehörigen Schritt kann es
    // nach dem Parsen nicht geben — aber es hier still zu einer `undefined`
    // Fremdschlüsselreferenz werden zu lassen wäre die schlechtere Art, sich
    // darauf zu verlassen.
    const componentRows = parsed.components.flatMap((component) => {
      const planStepId = stepIdByNumber.get(component.stepNumber);
      if (!planStepId) return [];
      return [
        {
          organizationId: command.actor.organizationId,
          ifcImportId: ifcImport.id,
          planStepId,
          globalId: component.globalId,
          ifcType: component.ifcType,
          componentNumber: component.componentNumber,
          objectName: component.objectName,
          material: component.material,
          trade: component.trade,
        },
      ];
    });

    if (componentRows.length > 0) {
      await tx.ifcComponent.createMany({ data: componentRows });
    }

    const drawings = await linkDrawings({
      tx,
      organizationId: command.actor.organizationId,
      projectId: command.projectId,
      ifcImportId: ifcImport.id,
      stepIdByNumber,
      parsed,
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'ifc_import.executed',
      resourceType: 'production_plan',
      resourceId: plan.id,
      actorId: command.actor.userId,
      newValues: {
        planNumber: plan.planNumber,
        fileName: command.fileName,
        fileHash,
        ifcSchema: parsed.schema,
        moduleNumbers: parsed.moduleNumbers,
        stepCount: parsed.steps.length,
        componentCount: parsed.components.length,
        drawingCount: drawings.referenceCount,
        boundDrawingCount: drawings.boundCount,
        // Die Warnungen gehören in den Audit-Trail und nicht nur in die
        // Antwort: „importiert" und „vollständig importiert" sind zwei
        // verschiedene Aussagen, und später ist nur nachlesbar, was
        // geschrieben wurde.
        warnings: parsed.warnings,
      },
      source: 'web',
    });

    return {
      planId: plan.id,
      revisionId: revision.id,
      importId: ifcImport.id,
      stepCount: parsed.steps.length,
      componentCount: parsed.components.length,
      drawingCount: drawings.referenceCount,
      boundDrawingCount: drawings.boundCount,
      warnings: parsed.warnings,
    };
  });
}

/**
 * Legt zu jedem Zeichnungsverweis eine Zeile an und bindet ihn an das
 * Dokument, das er nennt — wenn es das im Projekt gibt.
 *
 * **Gebunden wird nur auf eine freigegebene Revision.** Ein Verweis aus einer
 * Planungsdatei darf keinen Entwurf in einen Fertigungsplan holen; RELEASED
 * ist die Zusicherung, um derentwillen die Bindung überhaupt existiert
 * (Geschäftsgrundsatz 6). Findet sich kein Dokument oder keine freigegebene
 * Revision, bleibt die Zeile unerledigt stehen und ist im Schritt sichtbar —
 * das ist der Zustand, den jemand auflösen muss, und keiner, den der Import
 * durch Wegsehen beseitigen darf.
 *
 * **Der Abgleich geht über die Nummer, nicht über den Titel.** Eine
 * Zeichnungsnummer ist eine Kennung, ein Titel ist Prosa: „Grundriss" steht
 * an dreißig Dokumenten. Nur wenn der Verweis keine Nummer trägt, wird der
 * Titel als exakter Vergleich herangezogen.
 */
async function linkDrawings(input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  projectId: string;
  ifcImportId: string;
  stepIdByNumber: Map<number, string>;
  parsed: IfcParseResult;
}): Promise<{ referenceCount: number; boundCount: number }> {
  const { tx, organizationId, projectId, ifcImportId, stepIdByNumber, parsed } = input;

  let referenceCount = 0;
  let boundCount = 0;

  for (const drawing of parsed.drawings) {
    // Ein Verweis ohne Schritt gehört zum ganzen Plan; er steht als Warnung
    // im Import und bekommt hier keine Zeile — sie hinge an keinem Schritt.
    if (drawing.stepNumbers.length === 0) continue;

    const match = await findDocumentForDrawing(tx, projectId, drawing);

    for (const stepNumber of drawing.stepNumbers) {
      const planStepId = stepIdByNumber.get(stepNumber);
      if (!planStepId) continue;

      await tx.ifcDrawingReference.create({
        data: {
          organizationId,
          ifcImportId,
          planStepId,
          name: drawing.name,
          identification: drawing.identification,
          location: drawing.location,
          description: drawing.description,
          documentId: match?.documentId,
          documentRevisionId: match?.revisionId,
        },
      });
      referenceCount += 1;

      if (!match) continue;

      // `upsert` statt `create`: zwei Verweise derselben Datei dürfen auf
      // dasselbe Dokument zeigen. Die Bindung ist je (Schritt, Revision)
      // eindeutig — ein zweiter Anlauf ist kein Fehler, sondern dieselbe
      // Aussage.
      await tx.stepDocumentBinding.upsert({
        where: {
          planStepId_documentRevisionId: {
            planStepId,
            documentRevisionId: match.revisionId,
          },
        },
        create: {
          organizationId,
          planStepId,
          documentId: match.documentId,
          documentRevisionId: match.revisionId,
          markerLabel: 'Aus IFC-Modell',
        },
        update: {},
      });
      boundCount += 1;
    }
  }

  return { referenceCount, boundCount };
}

async function findDocumentForDrawing(
  tx: Prisma.TransactionClient,
  projectId: string,
  drawing: IfcDrawing,
): Promise<{ documentId: string; revisionId: string } | null> {
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
        select: { id: true },
      },
    },
  });

  const revisionId = document?.revisions[0]?.id;
  if (!document || !revisionId) return null;
  return { documentId: document.id, revisionId };
}
