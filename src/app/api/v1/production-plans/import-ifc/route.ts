import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { importIfcPlan } from '@/domain/production-plans/import-ifc-plan';
import { deleteObjects, putObjectBytes } from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import { DomainError, PayloadTooLargeError, ValidationError } from '@/lib/domain-errors';
import { logger } from '@/lib/logger';

/**
 * `POST /api/v1/production-plans/import-ifc` — ein Gebäudemodell hochladen und
 * daraus einen Fertigungsplan im Entwurf erzeugen.
 *
 * **Warum als Multipart und nicht über eine presignierte URL**, anders als
 * Dokumente und Fotos. Bei denen lädt der Browser unmittelbar in den
 * Objektspeicher und der Server erfährt nur, dass es geschehen ist — er
 * braucht den Inhalt nicht. Hier braucht er ihn: die Arbeitsschritte stehen
 * *in* der Datei, und ohne sie gelesen zu haben gibt es nichts anzulegen. Den
 * Umweg über eine presignierte URL zu nehmen und die Datei anschließend
 * zurückzuholen wäre derselbe Transfer zweimal.
 *
 * **Der Virenscan bleibt trotzdem.** Er läuft hier vor dem Parsen, gegen das
 * abgelegte Objekt, mit demselben Scanner wie jeder andere Upload — eine
 * IFC-Datei ist eine fremde Datei wie jede andere, und `MALWARE_SCANNER=stub`
 * ist in Produktion ohnehin abgelehnt.
 */

const metadataSchema = z.object({
  projectId: z.string().uuid(),
  productId: z.string().uuid(),
  planNumber: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();

    // Ein zu großer Körper wird von Next **gekappt, nicht abgelehnt** — die
    // Multipart-Grenze fehlt dann am Ende und `formData()` wirft
    // „expected boundary after body". Ohne diese Übersetzung liest der
    // Hochladende „Ein unerwarteter Fehler ist aufgetreten" und der Betrieb
    // sucht nach einem Fehler, den es nicht gibt. Die Grenze selbst steht in
    // `next.config.mjs` (`experimental.proxyClientMaxBodySize`).
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new PayloadTooLargeError(
        'Die Datei ist zu groß für die Übertragung und kam unvollständig an. ' +
          'Sie wurde nicht verarbeitet.',
      );
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ValidationError('Es wurde keine Datei übermittelt.');
    }
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      throw new ValidationError('Es werden nur Dateien mit der Endung .ifc verarbeitet.');
    }

    const metadata = metadataSchema.parse({
      projectId: form.get('projectId'),
      productId: form.get('productId'),
      planNumber: form.get('planNumber'),
      name: form.get('name'),
      description: form.get('description') ?? undefined,
    });

    const content = Buffer.from(await file.arrayBuffer());

    // Erst ablegen, dann scannen, dann lesen. Die Reihenfolge ist nicht
    // beliebig: der Scanner arbeitet auf dem Objektspeicher, nicht auf einem
    // Puffer, und eine Datei, die er nicht freigegeben hat, wird gar nicht
    // erst geparst.
    const storageKey = `ifc/${actor.organizationId}/${randomUUID()}.ifc`;
    await putObjectBytes({ storageKey, body: content, mimeType: 'application/x-step' });

    // Ab hier liegt eine Datei im Speicher, auf die noch nichts zeigt. Jeder
    // Ausgang außer dem erfolgreichen muss sie wieder wegräumen — sonst
    // bleibt sie für immer liegen, und zwar nicht selten: abgewiesen wird
    // regelmäßig (dieselbe Datei ein zweites Mal, eine belegte Plannummer,
    // eine unvollständige Übertragung). Gemessen waren es in der Entwicklung
    // 11 Objekte zu einer einzigen Zeile in `ifc_imports`, 156 MB.
    try {
      const status = await getMalwareScanner().scan(storageKey);
      if (status !== 'CLEAN') {
        throw new ValidationError(
          status === 'INFECTED'
            ? 'Die Datei wurde vom Virenscanner abgelehnt.'
            : 'Die Datei konnte nicht auf Schadsoftware geprüft werden und wird deshalb nicht verarbeitet.',
        );
      }

      const result = await importIfcPlan({
        actor,
        ...metadata,
        fileName: file.name,
        content,
        storageKey,
      });

      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      await discardUpload(storageKey, file.name, actor.organizationId, error);
      throw error;
    }
  });
}

/**
 * Räumt eine hochgeladene Datei weg, deren Import nicht durchgelaufen ist.
 *
 * **Warum hier gelöscht wird und nicht wie bei Dokumenten aufbewahrt.** Der
 * Dokumentenpfad behält auch eine infizierte Datei — dort trägt die
 * Revisionszeile den Scan-Status, das Objekt ist also referenziert und der
 * Vorgang nachlesbar. Bei einem abgewiesenen IFC-Import entsteht überhaupt
 * keine Zeile: was bliebe, wäre eine Datei, auf die nichts zeigt und die
 * niemand mehr zuordnen kann.
 *
 * **Der ursprüngliche Fehler bleibt der Fehler.** Scheitert das Löschen,
 * wird es protokolliert und nicht geworfen — sonst bekäme der Hochladende
 * statt „diese Datei wurde bereits importiert" eine Meldung über den
 * Objektspeicher, und die Ursache seines Problems wäre verdeckt.
 *
 * Die Zeile im Protokoll ist zugleich die einzige Spur, die ein abgelehnter
 * Upload hinterlässt — es gibt für ihn keinen Audit-Eintrag, weil es keine
 * Ressource gibt, an der er hinge. Für den Fall INFECTED ist das dünn und
 * in notes.md als offene Frage vermerkt.
 */
async function discardUpload(
  storageKey: string,
  fileName: string,
  organizationId: string,
  cause: unknown,
): Promise<void> {
  try {
    await deleteObjects([storageKey]);
    logger.warn(
      { storageKey, fileName, organizationId, reason: describe(cause) },
      'IFC-Import abgewiesen, hochgeladene Datei entfernt',
    );
  } catch (deleteError) {
    logger.error(
      { err: deleteError, storageKey, fileName, organizationId },
      'IFC-Import abgewiesen, die hochgeladene Datei konnte nicht entfernt werden',
    );
  }
}

function describe(cause: unknown): string {
  if (cause instanceof DomainError) return `${cause.code}: ${cause.message}`;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
