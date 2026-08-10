import { z } from 'zod';
import { toErrorResponse, type ApiErrorBody } from '../error-response';

/**
 * Der Übersetzungspfad von einem `ZodError` in die 422-Antwort aus
 * docs/05 („Standard-Fehlerformat", Feld `errors`).
 *
 * Warum das einen eigenen Test bekommt: bis zur Anhebung auf zod 4 hatte
 * dieser Pfad keinen. Die vorhandenen `VALIDATION_ERROR`-Zusicherungen in den
 * Integrationstests betreffen sämtlich die `DomainError` gleichen Namens aus
 * den Diensten — nicht die Schemaprüfung an der Anfragegrenze. Ausgerechnet
 * die aber ist es, deren Ausgabe sich mit zod 4 geändert hat.
 *
 * **Was hier bewusst NICHT zugesichert wird: der Wortlaut.** Die Texte kommen
 * von zod und haben sich mit v4 geändert („Required" → „Invalid input:
 * expected string, received undefined"). docs/05 typisiert `message` als
 * freien String und schreibt keine Formulierung vor; ein Test auf den
 * Wortlaut würde eine fremde Zeichenkette einfrieren und bei jeder
 * Bibliotheksanhebung rot werden, ohne dass etwas kaputt wäre. Zugesichert
 * ist, was der Vertrag verspricht: Statuscode, `code`, und je Feld ein
 * Eintrag mit gepunktetem Pfad und einer nicht leeren Meldung.
 */

const request = new Request('https://beispiel.local/api/v1/work-steps/abc/start');

function zodErrorFrom(schema: z.ZodTypeAny, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('Eingabe war unerwartet gültig');
  return result.error;
}

describe('toErrorResponse bei einem ZodError', () => {
  const schema = z.object({
    deviceId: z.string(),
    nested: z.object({ sequenceNumber: z.number() }),
  });

  it('antwortet mit 422 und VALIDATION_ERROR statt mit 500', async () => {
    const response = toErrorResponse(
      zodErrorFrom(schema, { nested: { sequenceNumber: 'keine Zahl' } }),
      request,
      'req_test',
    );
    expect(response.status).toBe(422);

    const body = (await response.json()) as ApiErrorBody;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.status).toBe(422);
    expect(body.correlationId).toBe('req_test');
    expect(body.instance).toBe('/api/v1/work-steps/abc/start');
  });

  it('nennt jedes beanstandete Feld mit gepunktetem Pfad und einer Meldung', async () => {
    const response = toErrorResponse(
      zodErrorFrom(schema, { nested: { sequenceNumber: 'keine Zahl' } }),
      request,
      'req_test',
    );
    const body = (await response.json()) as ApiErrorBody;

    const fields = body.errors?.map((entry) => entry.field).sort();
    expect(fields).toEqual(['deviceId', 'nested.sequenceNumber']);

    // Der Wortlaut gehört zod, die Existenz gehört dem Vertrag.
    for (const entry of body.errors ?? []) {
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it('nennt bei einem Fehler in einem Array den Index im Pfad', async () => {
    const batched = z.object({ commands: z.array(z.object({ sequenceNumber: z.number() })) });
    const response = toErrorResponse(
      zodErrorFrom(batched, { commands: [{ sequenceNumber: 1 }, { sequenceNumber: 'x' }] }),
      request,
      'req_test',
    );
    const body = (await response.json()) as ApiErrorBody;

    // Ein Sync-Stapel meldet bis zu 500 Kommandos auf einmal; ohne den Index
    // wüsste der Client nicht, welches er nachbessern soll (docs/06).
    expect(body.errors?.map((entry) => entry.field)).toEqual(['commands.1.sequenceNumber']);
  });
});
