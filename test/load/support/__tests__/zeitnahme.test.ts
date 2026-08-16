/**
 * Prüft die Vereinigung überlappender Zeitabschnitte.
 *
 * **Warum das eine eigene Prüfung verdient.** Der erste Anlauf der Zeitnahme
 * hat Abfragedauern schlicht **summiert**. Überlappen sich zwei Abfragen eines
 * Stapels, ist diese Summe größer als der Stapel gedauert hat — der Lauf
 * meldete daraufhin −7 ms Restzeit. Eine negative Dauer ist kein knapper
 * Messwert, sondern ein Rechenfehler mit Vorzeichen, und er fiel nur auf, weil
 * das Minuszeichen auffiel. Ohne Überlappung im Probelauf wäre die Aufteilung
 * still falsch geblieben.
 *
 * Die Fälle unten sind deshalb genau die, die beim Summieren durchgehen und
 * bei der Vereinigung nicht.
 */

import { vereinigteDauer, normalisiere, kategorie, stelleAusStapel, istLesend } from '../zeitnahme';

describe('vereinigteDauer', () => {
  it('ist null ohne Abschnitte', () => {
    expect(vereinigteDauer([])).toBe(0);
  });

  it('gibt bei einem Abschnitt dessen Länge zurück', () => {
    expect(vereinigteDauer([[10, 25]])).toBe(15);
  });

  it('addiert getrennte Abschnitte', () => {
    expect(
      vereinigteDauer([
        [0, 10],
        [20, 25],
      ]),
    ).toBe(15);
  });

  it('zählt überlappende Abschnitte nur einmal', () => {
    // Summiert wären es 20 — und genau dieser Fehler stand im ersten Anlauf.
    expect(
      vereinigteDauer([
        [0, 10],
        [5, 15],
      ]),
    ).toBe(15);
  });

  it('zählt einen vollständig enthaltenen Abschnitt nicht zusätzlich', () => {
    // Der Fall, der beim naiven Zusammenfassen am ehesten durchrutscht: der
    // zweite Abschnitt endet **vor** dem ersten, verlängert also nichts.
    expect(
      vereinigteDauer([
        [0, 100],
        [10, 20],
      ]),
    ).toBe(100);
  });

  it('kommt mit unsortierter Eingabe zurecht', () => {
    // Die Abschnitte entstehen in der Reihenfolge, in der Abfragen **enden** —
    // nach Startzeit sortiert sind sie damit gerade nicht.
    expect(
      vereinigteDauer([
        [50, 60],
        [0, 10],
        [5, 55],
      ]),
    ).toBe(60);
  });

  it('verschmilzt lückenlos angrenzende Abschnitte ohne Doppelzählung', () => {
    expect(
      vereinigteDauer([
        [0, 10],
        [10, 20],
      ]),
    ).toBe(20);
  });

  it('überschreitet nie die Spanne vom frühesten Start bis zum spätesten Ende', () => {
    // Die Eigenschaft, um die es eigentlich geht: die vereinigte Dauer kann
    // nicht größer sein als das Fenster, in dem alles stattfand — und deshalb
    // auch nicht größer als die Dauer des Stapels.
    const abschnitte: [number, number][] = [
      [3, 9],
      [1, 4],
      [8, 12],
      [11, 11],
      [0, 2],
    ];
    const fruehester = Math.min(...abschnitte.map(([a]) => a));
    const spaetestes = Math.max(...abschnitte.map(([, b]) => b));
    expect(vereinigteDauer(abschnitte)).toBeLessThanOrEqual(spaetestes - fruehester);
  });
});

describe('normalisiere', () => {
  it('fasst Zeilenumbrüche und Einrückung zusammen', () => {
    expect(normalisiere('SELECT 1\n  FROM   t')).toBe('SELECT 1 FROM t');
  });

  it('legt dieselbe Abfrage mit verschieden langer Parameterliste zusammen', () => {
    // Sonst erscheint eine Abfrage, die je nach Datenlage zwei oder drei Werte
    // einsetzt, als zwei verschiedene — und beide sähen halb so häufig aus,
    // wie sie sind.
    const zwei = normalisiere('SELECT * FROM t WHERE id IN ($1,$2)');
    const drei = normalisiere('SELECT * FROM t WHERE id IN ($1, $2, $3)');
    expect(zwei).toBe(drei);
  });

  it('lässt einen einzelnen Parameter stehen', () => {
    // `$1` allein ist keine Liste; ihn mitzuersetzen würde Abfragen
    // zusammenwerfen, die sich tatsächlich unterscheiden.
    expect(normalisiere('SELECT * FROM t WHERE id = $1')).toBe('SELECT * FROM t WHERE id = $1');
  });

  it('entfernt abschließende Semikolons', () => {
    expect(normalisiere('COMMIT;')).toBe('COMMIT');
  });
});

describe('kategorie', () => {
  it.each(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT s1', 'RELEASE SAVEPOINT s1'])(
    'zählt %s zum Transaktionsgerüst',
    (sql) => {
      expect(kategorie(sql)).toBe('Transaktionsgerüst');
    },
  );

  it('zählt das Setzen der Organisation zum Gerüst, nicht zum Lesen', () => {
    // Der Fall, der die Reihenfolge der Prüfungen bestimmt: die Anweisung
    // beginnt mit SELECT, liest aber nichts — sie baut die Transaktion auf.
    // Nach der Leseregel eingeordnet, verschöbe sie ein Sechstel aller
    // Aufrufe in die falsche Spalte.
    expect(kategorie("SELECT set_config('app.current_org_id', $1, true)")).toBe(
      'Transaktionsgerüst',
    );
  });

  it('unterscheidet Lesen und Schreiben', () => {
    expect(kategorie('SELECT "id" FROM "work_step_instances"')).toBe('Lesen');
    expect(kategorie('INSERT INTO "sync_commands" ("id") VALUES ($1)')).toBe('Schreiben');
    expect(kategorie('UPDATE "sync_commands" SET "status" = $1')).toBe('Schreiben');
    expect(kategorie('DELETE FROM "sync_commands"')).toBe('Schreiben');
  });

  it('ist unempfindlich gegen führenden Leerraum und Kleinschreibung', () => {
    expect(kategorie('  begin')).toBe('Transaktionsgerüst');
    expect(kategorie('\n  select 1')).toBe('Lesen');
  });
});

describe('stelleAusStapel', () => {
  const stapel = [
    'Error',
    '    at Object.query (/repo/test/load/support/zeitnahme.ts:120:20)',
    '    at PrismaClient._transaction (/repo/node_modules/.pnpm/@prisma+client/index.js:9:1)',
    '    at withOrgContext (/repo/src/lib/db/tenant-context.ts:23:18)',
    '    at async claimCommand (/repo/src/domain/sync/sync-commands.ts:172:10)',
    '    at async processOne (/repo/src/domain/sync/sync-commands.ts:150:17)',
  ].join('\n');

  it('nennt den Aufrufer von withOrgContext, nicht withOrgContext selbst', () => {
    // `tenant-context` öffnet jede Transaktion und wäre damit bei allen
    // dieselbe Antwort — die Auswertung bestünde aus einer einzigen Zeile.
    expect(stelleAusStapel(stapel)).toBe('claimCommand  src/domain/sync/sync-commands.ts:172');
  });

  it('überspringt Bibliotheken und die Messdatei selbst', () => {
    const stelle = stelleAusStapel(stapel)!;
    expect(stelle).not.toContain('node_modules');
    expect(stelle).not.toContain('zeitnahme');
  });

  it('gibt null zurück, wenn kein Anwendungsrahmen enthalten ist', () => {
    // Genau der Fall des ersten Versuchs: am `BEGIN` abgegriffen reichte der
    // Abzug nur bis in Prismas Transaktionsmanager. Ein `null` ist hier die
    // ehrliche Antwort — eine erfundene Stelle wäre schlimmer als keine.
    expect(stelleAusStapel('Error\n    at q (/repo/node_modules/pg/lib/client.js:1:1)')).toBeNull();
  });

  it('kommt ohne Stapelabzug zurecht', () => {
    expect(stelleAusStapel(undefined)).toBeNull();
  });
});

describe('istLesend', () => {
  it.each([
    'workStepInstance.findFirst',
    'userRole.findMany',
    'syncCommand.findUnique',
    'productionHold.count',
    'auditEntry.aggregate',
    'device.groupBy',
    'completionSubmission.findFirstOrThrow',
    'user.findUniqueOrThrow',
  ])('zählt %s zu den Lesevorgängen', (vorgang) => {
    expect(istLesend(vorgang)).toBe(true);
  });

  it.each([
    'syncCommand.create',
    'syncCommand.update',
    'workStepInstance.updateMany',
    'checklistResponse.upsert',
    'device.delete',
    '$executeRaw',
  ])('zählt %s nicht zu den Lesevorgängen', (vorgang) => {
    // Ein Schreibvorgang in der Lesespalte machte genau die Zahl größer, um
    // die es hier geht — dieselbe Falle wie `SELECT set_config(…)` bei der
    // Einordnung nach Anweisungstext.
    expect(istLesend(vorgang)).toBe(false);
  });

  it('trifft nur den Vorgang am Ende, nicht einen Namensbestandteil', () => {
    // Ein Modell, das „find" im Namen trägt, darf nicht als Lesevorgang
    // durchgehen, wenn der Vorgang selbst schreibt.
    expect(istLesend('findingReport.create')).toBe(false);
  });
});
