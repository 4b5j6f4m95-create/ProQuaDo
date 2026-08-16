/**
 * Wohin die Zeit eines Sync-Stapels geht.
 *
 * **Warum es das braucht.** Auf der Zielhardware liegt der Durchsatz bei rund
 * 9 Stapeln je Sekunde, also etwa 111 ms je Stapel. Drei Messungen haben
 * jeweils eine naheliegende Ursache ausgeschlossen: mehr Kerne bringen fast
 * nichts (die halbe Datenbank-CPU kostet 12 %), mehr Organisationen bringen
 * 8,8 %, und die Platte ist es auch nicht (ein Commit kostet 0,74 ms).
 * Gleichzeitig sind beide CPUs zusammen nur zu rund 1,2 von 2 Kernen
 * ausgelastet. Es wird also **gewartet** — und worauf, sagt keine Zahl von
 * außen. Der nächste sinnvolle Schritt ist deshalb kein weiterer
 * Durchsatzlauf, sondern diese Aufteilung.
 *
 * **Die drei Anteile.**
 *
 *  - `verbindungMs` — Zeit in `pool.connect()`. Das ist das Warten auf eine
 *    freie Verbindung; bei `DATABASE_POOL_MAX=25` und 50 gleichzeitigen
 *    Geräten der erste Verdacht.
 *  - `abfrageMs` — Zeit in `client.query()`. Der eigentliche Aufruf,
 *    einschließlich Netzweg und Ausführung im Server.
 *  - Der Rest (Stapeldauer minus beides) ist Arbeit in Node und Warten auf
 *    die Ereignisschleife.
 *
 * **Warum an den Prototypen von `pg` und nicht an einer Prisma-Erweiterung.**
 * Die Anwendung hält ihren Client als Modul-Singleton; `$extends` liefert
 * einen **neuen** Client, den die Anwendung nie zu Gesicht bekäme. Und ein
 * eigens im Harness gebauter Client wäre nicht mehr der, den die Anwendung
 * benutzt — die Poolgröße und alles andere aus `src/lib/db/client.ts` müsste
 * hier gedoppelt werden und würde beim nächsten Umbau still auseinanderlaufen.
 * Gemessen werden soll aber der echte Client. Der Eingriff ist auf den
 * Prozess des Lasttests beschränkt.
 *
 * **Zuordnung über `AsyncLocalStorage`.** Bei 50 gleichzeitigen Stapeln muss
 * jede Abfrage dem Stapel zugeschlagen werden, aus dem sie stammt. Ein
 * globaler Zähler würde nur die Summe kennen und könnte nichts je Stapel
 * sagen.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

/**
 * Ein Zeitabschnitt, in dem etwas offen war. **Abschnitte statt Summen**, und
 * das ist keine Feinheit: ein Stapel kann mehrere Abfragen gleichzeitig laufen
 * lassen, und dann ist die Summe der Abfragedauern größer als der Stapel
 * gedauert hat. Der erste Anlauf hat genau das getan und für die Restzeit
 * −7 ms gemeldet — eine negative Dauer ist kein knapper Messwert, sondern ein
 * Rechenfehler mit Vorzeichen.
 */
type Abschnitt = [start: number, ende: number];

interface Eimer {
  abfragen: Abschnitt[];
  verbindungen: Abschnitt[];
}

export interface Stapelzeit {
  /** Gesamtdauer des Stapels — der Wert, den auch `measure` aufzeichnet. */
  gesamtMs: number;
  /** Zeit, in der auf eine freie Verbindung gewartet wurde (vereinigt). */
  verbindungMs: number;
  verbindungen: number;
  /** Zeit, in der **mindestens eine** Datenbankoperation offen war. */
  datenbankMs: number;
  abfragen: number;
  /** Summe der Abfragedauern — bei Überlappung größer als `datenbankMs`. */
  abfrageSummeMs: number;
}

/**
 * `pg.Pool.connect` und `pg.Client.query` haben je mehrere Überladungen
 * (Rückruf- und Promise-Form). Typtreu ließe sich keine Hülle darüberlegen,
 * die beide durchreicht — deshalb einmal hier lose beschrieben und an den
 * beiden Stellen unten wieder eingegrenzt.
 */
type LoseFunktion = (this: unknown, ...args: unknown[]) => unknown;

const speicher = new AsyncLocalStorage<Eimer>();

/**
 * Gleichzeitig **gehaltene Verbindungen** — nicht gleichzeitige Abfragen.
 *
 * Der erste Anlauf zählte Abfragen und verglich sie mit der Poolgröße: 38
 * gegen 25, woraus der Lauf „der Pool war ausgeschöpft" schloss. Das war
 * falsch, und zwar nicht knapp: `pg` reiht mehrere Abfragen **auf derselben
 * Verbindung** auf, die Zahl kann die Poolgröße also ohne jede Erschöpfung
 * übersteigen. Verglichen werden darf mit der Poolgröße nur, was auch eine
 * Verbindung belegt.
 */
let gehalten = 0;
let gehaltenMax = 0;
let installiert = false;

/**
 * Hängt die Zeitnahme in `pg` ein. **Muss aufgerufen werden, bevor
 * `@/lib/db/client` das erste Mal geladen wird** — danach steht der Pool
 * bereits. `run.ts` lädt Szenarien und Fixtures ohnehin erst nach dem Start
 * der Infrastruktur; hier ist die Stelle davor.
 *
 * Mehrfachaufrufe sind wirkungslos, nicht schädlich: ein zweiter Aufruf würde
 * sonst die eigene Hülle noch einmal umhüllen und jede Dauer doppelt zählen.
 */
export function instrumentiere(): void {
  if (installiert) return;
  installiert = true;

  const urspruenglicherConnect = pg.Pool.prototype.connect as unknown as LoseFunktion;
  (pg.Pool.prototype as unknown as { connect: LoseFunktion }).connect = function (
    this: unknown,
    ...args: unknown[]
  ): unknown {
    // Rückrufform: unangetastet durchreichen. Der Adapter benutzt sie nicht,
    // aber sie hier stillschweigend in ein Promise zu verwandeln wäre eine
    // Verhaltensänderung, die niemand erwartet.
    if (args.length > 0) return urspruenglicherConnect.apply(this, args);

    const begonnen = performance.now();
    return (urspruenglicherConnect.call(this) as Promise<unknown>).then((verbindung) => {
      speicher.getStore()?.verbindungen.push([begonnen, performance.now()]);

      gehalten += 1;
      if (gehalten > gehaltenMax) gehaltenMax = gehalten;
      // Die Verbindung gilt als gehalten, bis sie zurückgegeben wird. `release`
      // wird gelegentlich doppelt aufgerufen — der Wächter verhindert, dass
      // der Zähler dabei unter null wandert und die Spitze verfälscht.
      const mitRelease = verbindung as { release?: (...args: unknown[]) => unknown };
      const urspruenglichesRelease = mitRelease.release;
      if (typeof urspruenglichesRelease === 'function') {
        let zurueckgegeben = false;
        mitRelease.release = function (this: unknown, ...args: unknown[]): unknown {
          if (!zurueckgegeben) {
            zurueckgegeben = true;
            gehalten -= 1;
          }
          return urspruenglichesRelease.apply(this, args);
        };
      }
      return verbindung;
    });
  };

  const urspruenglicheQuery = pg.Client.prototype.query as unknown as LoseFunktion;
  (pg.Client.prototype as unknown as { query: LoseFunktion }).query = function (
    this: unknown,
    ...args: unknown[]
  ): unknown {
    // Auch hier: Rückrufform unangetastet. Sie liefert kein Promise, an das
    // sich eine Messung hängen ließe.
    if (typeof args[args.length - 1] === 'function') {
      return urspruenglicheQuery.apply(this, args);
    }

    const begonnen = performance.now();
    // `finally` und nicht `then`: eine fehlgeschlagene Abfrage hat trotzdem
    // Zeit gekostet und gehört in die Aufteilung.
    return (urspruenglicheQuery.apply(this, args) as Promise<unknown>).finally(() => {
      speicher.getStore()?.abfragen.push([begonnen, performance.now()]);
    });
  };
}

/**
 * Führt einen Stapel aus und gibt zurück, wohin seine Zeit ging.
 *
 * Der Rest (Gesamtdauer minus Verbindung minus Abfrage) wird bewusst **nicht**
 * hier gebildet: er kann negativ werden, wenn ein Stapel mehrere Abfragen
 * gleichzeitig laufen lässt, und diese Auskunft gehört in die Auswertung und
 * nicht in eine Zahl, die so tut, als sei sie eine Dauer.
 */
export async function messeStapel<T>(
  vorgang: () => Promise<T>,
): Promise<{ ergebnis: T; zeit: Stapelzeit }> {
  const eimer: Eimer = { abfragen: [], verbindungen: [] };
  const begonnen = performance.now();
  const ergebnis = await speicher.run(eimer, vorgang);
  const gesamtMs = performance.now() - begonnen;

  return {
    ergebnis,
    zeit: {
      gesamtMs,
      verbindungMs: vereinigteDauer(eimer.verbindungen),
      verbindungen: eimer.verbindungen.length,
      // Vereinigt über **beides**: Warten auf eine Verbindung und Abfragen
      // können sich innerhalb eines Stapels überlappen. Was übrig bleibt, ist
      // dann tatsächlich die Zeit, in der die Datenbank nichts zu tun hatte.
      datenbankMs: vereinigteDauer([...eimer.verbindungen, ...eimer.abfragen]),
      abfragen: eimer.abfragen.length,
      abfrageSummeMs: eimer.abfragen.reduce((summe, [a, b]) => summe + (b - a), 0),
    },
  };
}

/**
 * Gesamtlänge der Vereinigung überlappender Abschnitte — „wie lange war
 * mindestens eines davon offen".
 *
 * Ausgeführt exportiert, damit die Rechnung geprüft werden kann: sie ist der
 * einzige Algorithmus in dieser Datei, und ein Fehler darin verfälscht keine
 * Anzeige, sondern die Aufteilung, auf die sich eine Hardwareentscheidung
 * stützt. Siehe `__tests__/zeitnahme.test.ts`.
 */
export function vereinigteDauer(abschnitte: readonly Abschnitt[]): number {
  if (abschnitte.length === 0) return 0;
  const sortiert = [...abschnitte].sort((a, b) => a[0] - b[0]);
  let summe = 0;
  let [, offenBis] = sortiert[0]!;
  let offenAb = sortiert[0]![0];
  for (const [start, ende] of sortiert.slice(1)) {
    if (start > offenBis) {
      summe += offenBis - offenAb;
      offenAb = start;
      offenBis = ende;
    } else if (ende > offenBis) {
      offenBis = ende;
    }
  }
  return summe + (offenBis - offenAb);
}

/** Höchste Zahl gleichzeitig **gehaltener Verbindungen** seit dem Zurücksetzen. */
export function hoechsteGleichzeitigkeit(): number {
  return gehaltenMax;
}

export function setzeGleichzeitigkeitZurueck(): void {
  gehaltenMax = gehalten;
}

export interface Zeitbild {
  /** Anzahl ausgewerteter Stapel. */
  stapel: number;
  medianGesamtMs: number;
  /** Anteil des Wartens auf eine freie Verbindung. */
  medianVerbindungMs: number;
  /** Anteil, in dem mindestens eine Datenbankoperation offen war. */
  medianDatenbankMs: number;
  /** Der Rest: Arbeit in Node und Warten auf die Ereignisschleife. */
  medianRestMs: number;
  medianAbfragen: number;
  /**
   * Summe der Abfragedauern gegen die vereinigte Dauer. Liegt sie deutlich
   * höher, arbeitet ein Stapel mehrere Abfragen gleichzeitig ab — eine
   * Auskunft über den Code und nicht über die Maschine.
   */
  medianAbfrageSummeMs: number;
  /** Höchste Zahl gleichzeitig **gehaltener** Verbindungen. */
  hoechsteGleichzeitigkeit: number;
  poolMax: number;
}

function median(werte: readonly number[]): number {
  if (werte.length === 0) return Number.NaN;
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.floor((sortiert.length - 1) / 2)]!;
}

export function fasseZeitenZusammen(zeiten: readonly Stapelzeit[], poolMax: number): Zeitbild {
  return {
    stapel: zeiten.length,
    medianGesamtMs: median(zeiten.map((z) => z.gesamtMs)),
    medianVerbindungMs: median(zeiten.map((z) => z.verbindungMs)),
    medianDatenbankMs: median(zeiten.map((z) => z.datenbankMs)),
    // Je Stapel gebildet und dann der Median — nicht die Differenz zweier
    // Mediane. Die Vereinigung ist nie größer als die Stapeldauer, der Rest
    // also nie negativ.
    medianRestMs: median(zeiten.map((z) => Math.max(0, z.gesamtMs - z.datenbankMs))),
    medianAbfragen: median(zeiten.map((z) => z.abfragen)),
    medianAbfrageSummeMs: median(zeiten.map((z) => z.abfrageSummeMs)),
    hoechsteGleichzeitigkeit: hoechsteGleichzeitigkeit(),
    poolMax,
  };
}

export function formatZeitbild(bild: Zeitbild): string {
  // Der Fall, der zuerst auffallen muss: die Zeitnahme hat nicht gegriffen.
  // Eine Aufteilung, die überall 0 meldet, sieht aus wie ein Messwert und ist
  // keiner — dieselbe Falle wie das `|| echo 0` in den Serverskripten.
  if (bild.medianAbfragen === 0) {
    return (
      '  ⚠ Zeitnahme hat nicht gegriffen: keine einzige Abfrage zugeordnet.\n' +
      '    Wurde `instrumentiere()` erst nach dem Laden von @/lib/db/client aufgerufen?'
    );
  }

  const ms = (wert: number) => `${wert.toFixed(0)} ms`;
  const anteil = (wert: number) =>
    bild.medianGesamtMs > 0 ? ` (${((wert / bild.medianGesamtMs) * 100).toFixed(0)} %)` : '';

  const zeilen = [
    `  Zeitnahme je Stapel (Median über ${bild.stapel} Stapel): ${ms(bild.medianGesamtMs)}`,
    `    Datenbank offen          ${ms(bild.medianDatenbankMs)}${anteil(bild.medianDatenbankMs)}` +
      `  über ${bild.medianAbfragen} Abfragen`,
    // Eingerückt, weil das Warten auf eine Verbindung **Teil** der offenen
    // Datenbankzeit ist und nicht danebensteht. Nebeneinander gesetzt hätte
    // man die beiden addiert und wäre über 100 % gelandet.
    `      darunter Verbindung    ${ms(bild.medianVerbindungMs)}${anteil(bild.medianVerbindungMs)}`,
    `    Node / Ereignisschleife  ${ms(bild.medianRestMs)}${anteil(bild.medianRestMs)}`,
    `  Gleichzeitig gehaltene Verbindungen: höchstens ${bild.hoechsteGleichzeitigkeit} ` +
      `(Poolgröße ${bild.poolMax})`,
  ];

  // Die Antwort auf den Verdacht, der diese Messung ausgelöst hat — als Satz
  // und nicht als zwei Zahlen, die der Lesende selbst vergleichen müsste.
  zeilen.push(
    bild.hoechsteGleichzeitigkeit >= bild.poolMax
      ? '    → Der Pool war ausgeschöpft; die Verbindungszahl begrenzt mit.'
      : '    → Der Pool war nie ausgeschöpft; die Verbindungszahl begrenzt nicht.',
  );

  // Nur wenn es etwas zu sagen gibt: liegt die Summe über der vereinigten
  // Dauer, laufen Abfragen eines Stapels gleichzeitig.
  if (bild.medianAbfrageSummeMs > bild.medianDatenbankMs * 1.05) {
    zeilen.push(
      `  Abfragen überlappen sich: Summe ${ms(bild.medianAbfrageSummeMs)} gegen ` +
        `${ms(bild.medianDatenbankMs)} tatsächlich offen.`,
    );
  }

  // Jeder Anteil ist der Median **seiner eigenen** Verteilung über die Stapel.
  // Mediane addieren sich nicht, die Anteile ergeben deshalb nicht exakt 100 %
  // — das ist kein Rundungsfehler, sondern die Eigenschaft der Kennzahl.
  zeilen.push('  (Mediane je Stapel; die Anteile summieren sich deshalb nicht genau auf 100 %.)');

  return zeilen.join('\n');
}
