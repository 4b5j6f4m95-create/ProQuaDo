import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { importIfcPlan } from '@/domain/production-plans/import-ifc-plan';
import { putObjectBytes } from '@/lib/storage/object-storage';
import { getMalwareScanner } from '@/lib/storage/malware-scan';
import { ValidationError } from '@/lib/domain-errors';

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

    const form = await request.formData();
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
  });
}
