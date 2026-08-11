import { randomUUID } from 'node:crypto';

import { test, expect } from './support/test';
import { authStatePath } from './support/auth';

/**
 * Eine IFC-Datei über der Übertragungsgrenze muss **vollständig** ankommen.
 *
 * **Warum das nur hier prüfbar ist.** Next kappt Request-Körper oberhalb von
 * `experimental.proxyClientMaxBodySize` — still, ohne Fehler, mit „Only the
 * first 10MB will be available" im Protokoll. Die Grenze sitzt in der
 * Proxy-Schicht, nicht in der Route: ein Integrationstest, der den Handler
 * direkt aufruft, kommt an ihr vorbei und beweist nichts. Es braucht eine
 * echte HTTP-Anfrage gegen einen laufenden Next-Server, also diese Ebene.
 *
 * Der Fall ist nicht ausgedacht — er hat die erste Fassung des Imports beim
 * ersten Hochladen im Browser mit HTTP 500 sterben lassen, nachdem Unit-,
 * Integrationstests, Production-Build und CI grün waren.
 *
 * **Warum zwei Anfragen und keine Erwartung auf einen bestimmten Fehler.**
 * Der Lauf fährt gegen einen Production-Build, und dort wird
 * `MALWARE_SCANNER=stub` mit hartem Fehler abgelehnt (richtig so) — der
 * Import kann hier also gar nicht gelingen, ohne dass ein echtes clamd
 * mitläuft. Die Aussage lautet deshalb nicht „der Upload gelingt", sondern
 * das Schärfere: **die Größe darf keinen Unterschied machen.** Eine 12-MB-
 * Datei muss an derselben Stelle scheitern wie eine 12-KB-Datei. Käme sie
 * gekappt an, wäre der Ausgang ein anderer — `formData()` findet die
 * Multipart-Grenze nicht mehr und die Route antwortet mit
 * `PAYLOAD_TOO_LARGE`.
 *
 * Damit hängt der Test nicht an der Form des Scanner-Fehlers und bleibt
 * gültig, wenn diese sich ändert.
 */

test.use({ storageState: authStatePath('projectLead') });

/**
 * Eine gültige IFC-Datei mindestens der gewünschten Größe.
 *
 * Aufgefüllt wird mit `IFCCARTESIANPOINT` — Geometrie, die der Parser
 * ohnehin überspringt. So wird die Datei groß, ohne dass Tausende Bauteile
 * entstehen, die niemand prüfen will. Genau dieses Verhältnis hat auch die
 * echte Datei: von 23 MB sind rund 95 % Punkte und Flächen.
 */
function ifcOfAtLeast(bytes: number): Buffer {
  const head = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('no view'),'2;1');",
    "FILE_NAME('modul.ifc','2026-08-11T11:30:46',('E2E'),('No Org',''),'ODA SDAI 25.4','','e2e');",
    "FILE_SCHEMA(('IFC2X3'));",
    'ENDSEC;',
    'DATA;',
    "#100=IFCBUILDINGELEMENTPROXY('el100000000000000000',#5,' ',$,$,#63,#64,$,$);",
    "#101=IFCPROPERTYSINGLEVALUE('Arbeitsvorgang',$,IFCTEXT('20: Statische Verschraubung'),$);",
    "#110=IFCPROPERTYSET('ps110000000000000000',#5,'AllplanAttributes',$,(#101));",
    "#111=IFCRELDEFINESBYPROPERTIES('rd110000000000000000',#5,$,$,(#100),#110);",
  ].join('\n');
  const tail = '\nENDSEC;\nEND-ISO-10303-21;\n';

  const filler: string[] = [];
  let size = head.length + tail.length;
  for (let i = 1000; size < bytes; i += 1) {
    const line = `#${i}=IFCCARTESIANPOINT((${i}.0,${i}.5,${i}.25));`;
    filler.push(line);
    size += line.length + 1;
  }

  return Buffer.from(`${head}\n${filler.join('\n')}${tail}`, 'latin1');
}

test('eine Datei über der Übertragungsgrenze wird nicht stillschweigend gekappt', async ({
  page,
}) => {
  const small = ifcOfAtLeast(0);
  const large = ifcOfAtLeast(12 * 1024 * 1024);

  // Die Vorbedingung des Falls: ohne sie prüft der Test nichts. Die Vorgabe
  // von Next liegt bei 10 MB.
  expect(large.byteLength).toBeGreaterThan(10 * 1024 * 1024);
  expect(small.byteLength).toBeLessThan(1024 * 1024);

  async function upload(content: Buffer): Promise<{ status: number; code: unknown }> {
    const response = await page.request.post('/api/v1/production-plans/import-ifc', {
      multipart: {
        file: { name: 'modul.ifc', mimeType: 'application/x-step', buffer: content },
        // Beliebige Kennungen: der Weg endet vor der Datenbank am Scanner.
        // Sie müssen nur die Formatprüfung bestehen.
        projectId: randomUUID(),
        productId: randomUUID(),
        planNumber: 'FP-E2E-SIZE',
        name: 'E2E Übertragungsgrenze',
      },
      timeout: 60_000,
    });
    const body: unknown = await response.json().catch(() => null);
    const code =
      body && typeof body === 'object' && 'code' in body ? (body as { code: unknown }).code : null;
    return { status: response.status(), code };
  }

  const smallResult = await upload(small);
  const largeResult = await upload(large);

  // Der eigentliche Regressionsschutz: käme die Datei gekappt an, fände
  // `formData()` die Multipart-Grenze nicht mehr.
  expect(largeResult.code).not.toBe('PAYLOAD_TOO_LARGE');

  // Und das Schärfere: die Größe macht überhaupt keinen Unterschied.
  expect(largeResult).toEqual(smallResult);
});
