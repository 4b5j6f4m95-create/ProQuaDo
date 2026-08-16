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
  /**
   * Lesevorgänge dieses **einen** Stapels, Argumente eingeschlossen.
   *
   * Je Stapel und nicht global: die Argumente enthalten die IDs des Geräts,
   * also ist dieselbe Abfrage bei zwei Geräten zweimal etwas anderes. Global
   * gezählt sähe jede Abfrage einmalig aus und die Antwort wäre immer „keine
   * Wiederholungen" — unabhängig davon, wie oft ein Stapel dieselbe Zeile
   * liest.
   */
  genaueAbfragen: Map<string, number>;
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
  /** Lesevorgänge dieses Stapels samt Argumenten, für die Wiederholungszählung. */
  genaueAbfragen: ReadonlyMap<string, number>;
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
 * Was tatsächlich zur Datenbank geht, nach Anweisung gruppiert.
 *
 * Die Zeitnahme hat 179 Aufrufe je Stapel gezählt und damit den Engpass
 * benannt — aber nicht, **welche** davon entbehrlich sind. Eine Zahl allein
 * sagt „zu viele", eine Gruppierung sagt „diese hier". Erst damit lässt sich
 * entscheiden, wo gekürzt werden kann.
 *
 * Global und nicht je Stapel: gefragt ist die Zusammensetzung, und die ist
 * über alle Stapel dieselbe. Je Stapel gehalten wäre es dieselbe Karte in
 * fünfzig Kopien.
 */
const anweisungen = new Map<string, { anzahl: number; dauerMs: number }>();

/**
 * Woher die Transaktionen kommen — Aufrufstelle je `BEGIN`.
 *
 * Die Gruppierung nach Anweisung sagt „19 Transaktionen für 4 Kommandos",
 * aber nicht, **welche Stelle im Code** sie öffnet. Das ließe sich aus den
 * Aufrufen von `withOrgContext` ablesen; ablesen ist aber raten, solange es
 * nicht gezählt ist, und in dieser Messreihe sind schon zwei plausible
 * Ableitungen an der Messung gescheitert.
 *
 * **Angesetzt wird an `prisma.$transaction`, nicht am `BEGIN`.** Der erste
 * Versuch nahm den Abzug beim Senden von `BEGIN` — und traf ausschließlich
 * Prismas eigenen Transaktionsmanager: bis dorthin ist die Anweisung durch
 * eine Warteschlange gelaufen, und die Rahmen des Aufrufers sind weg. Eine
 * Ebene höher steht der Aufrufer noch auf dem Stapel.
 *
 * Nur mit `LOAD_TRANSAKTIONSHERKUNFT=1`: einen Stapelabzug je Transaktion zu
 * nehmen kostet Zeit, und diese Zeit fiele sonst in dieselbe Messung, die
 * beantworten soll, wohin die Zeit geht.
 */
const herkunft = new Map<string, number>();

function herkunftAufzeichnen(): void {
  const stelle = stelleAusStapel(new Error().stack);
  if (stelle) herkunft.set(stelle, (herkunft.get(stelle) ?? 0) + 1);
}

/**
 * Die erste Zeile aus dem Anwendungscode in einem Stapelabzug.
 *
 * Übersprungen wird alles, was den Weg beschreibt statt den Grund: Bibliotheken,
 * diese Datei — und `lib/db/tenant-context`, das zwar jede Transaktion öffnet,
 * aber bei **jeder** dieselbe Stelle ist. Gefragt ist, wer `withOrgContext`
 * gerufen hat.
 */
export function stelleAusStapel(stapel: string | undefined): string | null {
  if (!stapel) return null;
  for (const zeile of stapel.split('\n').slice(1)) {
    if (zeile.includes('node_modules')) continue;
    const treffer = /\(?((?:src|test)\/[^):]+):(\d+):\d+\)?$/.exec(zeile.trim());
    if (!treffer) continue;
    if (treffer[1]!.includes('support/zeitnahme')) continue;
    if (treffer[1]!.includes('lib/db/tenant-context')) continue;
    const name = /at\s+(?:async\s+)?([\w.<>]+)\s/.exec(zeile)?.[1] ?? '(anonym)';
    return `${name}  ${treffer[1]}:${treffer[2]}`;
  }
  return null;
}

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
      const eimer = speicher.getStore();
      // Nur innerhalb eines Stapels. Ohne diese Bedingung wanderten die
      // Abfragen des Befüllens mit in die Gruppierung — und die sind um ein
      // Vielfaches zahlreicher als die des Syncs.
      if (!eimer) return;

      const beendet = performance.now();
      eimer.abfragen.push([begonnen, beendet]);

      const text = anweisungstext(args[0]);
      if (text === null) return;
      const schluessel = normalisiere(text);
      const eintrag = anweisungen.get(schluessel) ?? { anzahl: 0, dauerMs: 0 };
      eintrag.anzahl += 1;
      eintrag.dauerMs += beendet - begonnen;
      anweisungen.set(schluessel, eintrag);
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
  const eimer: Eimer = { abfragen: [], verbindungen: [], genaueAbfragen: new Map() };
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
      genaueAbfragen: eimer.genaueAbfragen,
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

/**
 * Die Anweisung aus dem ersten Argument von `query`.
 *
 * `pg` nimmt beides: eine Zeichenkette (so kommen `BEGIN` und `COMMIT`) und
 * ein Objekt mit `text` (so kommt alles, was Prisma über den Adapter stellt).
 * Wer nur eine der beiden Formen liest, verliert genau die Hälfte, um die es
 * hier geht — das Transaktionsgerüst.
 */
function anweisungstext(erstes: unknown): string | null {
  if (typeof erstes === 'string') return erstes;
  if (typeof erstes === 'object' && erstes !== null) {
    const text = (erstes as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return null;
}

/**
 * Vereinheitlicht eine Anweisung, damit gleichartige zusammenfallen.
 *
 * Prisma stellt bereits parametrisierte Anweisungen — Werte stehen also
 * ohnehin als `$1`, `$2` darin. Zusammenzufassen bleibt der Fall, in dem sich
 * dieselbe Abfrage nur in der **Länge** einer Parameterliste unterscheidet
 * (`IN ($1,$2)` gegen `IN ($1,$2,$3)`): das ist dieselbe Anweisung und darf
 * nicht als zwei erscheinen.
 */
export function normalisiere(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\$\d+(\s*,\s*\$\d+)+/g, '$N,…')
    .replace(/;+\s*$/, '')
    .trim();
}

export type Kategorie = 'Transaktionsgerüst' | 'Lesen' | 'Schreiben' | 'Sonstiges';

/**
 * Ordnet eine Anweisung ein.
 *
 * **Das Gerüst wird zuerst geprüft, und das ist keine Formalie.**
 * `app.current_org_id` wird über `SELECT set_config(…)` gesetzt (siehe
 * `src/lib/db/tenant-context.ts`) — die Anweisung beginnt also mit `SELECT`
 * und wäre nach der Leseregel ein Lesevorgang. Sie liest aber nichts; sie
 * gehört zum Aufbau jeder einzelnen Transaktion und damit zu genau dem
 * Anteil, dessen Größe hier zur Debatte steht.
 */
export function kategorie(sql: string): Kategorie {
  const s = sql.trimStart().toUpperCase();
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET |DEALLOCATE|DISCARD)/.test(s)) {
    return 'Transaktionsgerüst';
  }
  if (s.includes('SET_CONFIG(')) return 'Transaktionsgerüst';
  if (/^SELECT/.test(s)) return 'Lesen';
  if (/^(INSERT|UPDATE|DELETE)/.test(s)) return 'Schreiben';
  return 'Sonstiges';
}

/** Höchste Zahl gleichzeitig **gehaltener Verbindungen** seit dem Zurücksetzen. */
export function hoechsteGleichzeitigkeit(): number {
  return gehaltenMax;
}

export function setzeGleichzeitigkeitZurueck(): void {
  gehaltenMax = gehalten;
  anweisungen.clear();
  herkunft.clear();
  zugriffe.clear();
  wiederholungJeTransaktion.length = 0;
}

/**
 * Hängt die Herkunftsaufzeichnung an den Client der Anwendung.
 *
 * Anders als `instrumentiere()` **nach** dem Laden von `@/lib/db/client` zu
 * rufen: gewickelt wird die Methode des fertigen Objekts, nicht ein
 * Modulexport — ein `import`-Binding ließe sich ohnehin nicht überschreiben.
 */
export function instrumentiereTransaktionen(client: object): void {
  if (process.env.LOAD_TRANSAKTIONSHERKUNFT !== '1') return;
  const halter = client as { $transaction: LoseFunktion };
  const urspruenglich = halter.$transaction;
  halter.$transaction = function (this: unknown, ...args: unknown[]): unknown {
    herkunftAufzeichnen();
    // Den Rückruf so umhüllen, dass der Fachcode den beobachteten Client
    // bekommt. Nur die Rückrufform — die Feldform (`$transaction([…])`) reicht
    // keinen Client weiter und hat nichts zu beobachten.
    const [erstes, ...rest] = args;
    if (typeof erstes === 'function') {
      const rueckruf = erstes as (tx: unknown) => unknown;
      return urspruenglich.apply(this, [
        (tx: unknown) => transaktionsSpeicher.run(new Map(), () => rueckruf(beobachte(tx))),
        ...rest,
      ]);
    }
    return urspruenglich.apply(this, args);
  };
}

/**
 * Aufrufstellen der einzelnen Datenbankzugriffe — nicht nur der Transaktionen.
 *
 * Dieselbe Falle wie beim `BEGIN`: beim Absenden der Anweisung ist der
 * Aufrufer nicht mehr auf dem Stapel. Greifbar ist er an dem `tx`-Client, den
 * `$transaction` an den Fachcode weiterreicht — dort steht `findFirst` noch
 * synchron im Aufruf. Deshalb wird der Client in einen Stellvertreter
 * gehüllt, der jeden Zugriff festhält, bevor er weiterreicht.
 */
const zugriffe = new Map<string, number>();

/**
 * Wiederholungen innerhalb **einer Transaktion** — der einzige Bereich, in
 * dem ein Zwischenspeicher unbedenklich ist.
 *
 * Ein Cache über mehrere Transaktionen hinweg bediente eine Prüfung aus einer
 * Ablesung, die außerhalb der Transaktion geschah, deren Schreibvorgänge sie
 * absichert — genau das, was der Kommentar an `hasPermissionWithin`
 * ausschließt. Diese Zahl sagt, was ein unbedenklicher Cache einbrächte.
 */
const transaktionsSpeicher = new AsyncLocalStorage<Map<string, number>>();
const wiederholungJeTransaktion: number[] = [];

function beobachte(tx: unknown): unknown {
  if (typeof tx !== 'object' || tx === null) return tx;
  return new Proxy(tx as Record<string, unknown>, {
    get(ziel, name) {
      const wert = Reflect.get(ziel, name);
      if (typeof name !== 'string' || name.startsWith('__')) return wert;

      // `$executeRaw`, `$queryRaw` — direkt am Client.
      if (typeof wert === 'function') {
        return (...args: unknown[]) => {
          festhalten(name, '');
          return (wert as LoseFunktion).apply(ziel, args);
        };
      }
      // Modell-Delegierte: `tx.workStepInstance.findFirst(…)`.
      if (typeof wert === 'object' && wert !== null) {
        return new Proxy(wert as Record<string, unknown>, {
          get(modell, vorgang) {
            const fn = Reflect.get(modell, vorgang);
            if (typeof fn !== 'function' || typeof vorgang !== 'string') return fn;
            return (...args: unknown[]) => {
              festhalten(name, vorgang, args[0]);
              return (fn as LoseFunktion).apply(modell, args);
            };
          },
        });
      }
      return wert;
    },
  });
}

function festhalten(modell: string, vorgang: string, argumente?: unknown): void {
  const stelle = stelleAusStapel(new Error().stack);
  const was = vorgang ? `${modell}.${vorgang}` : modell;
  const schluessel = `${was}\u0000${stelle ?? '(unbekannt)'}`;
  zugriffe.set(schluessel, (zugriffe.get(schluessel) ?? 0) + 1);

  // Zusätzlich die **vollständige** Abfrage, Argumente eingeschlossen. Ein
  // Zwischenspeicher greift nur bei buchstäblich derselben Abfrage; zwei
  // Lesevorgänge auf dieselbe Zeile mit verschiedenem `select` sind für ihn
  // zwei verschiedene. Ohne diese Zahl wüsste man nicht, ob ein Cache
  // überhaupt etwas zu fangen hätte.
  if (!istLesend(was)) return;
  const eimer = speicher.getStore();
  if (!eimer) return;
  const genau = `${was}(${formeAb(argumente)})`;
  eimer.genaueAbfragen.set(genau, (eimer.genaueAbfragen.get(genau) ?? 0) + 1);

  const inTransaktion = transaktionsSpeicher.getStore();
  if (inTransaktion) {
    const vorher = inTransaktion.get(genau) ?? 0;
    inTransaktion.set(genau, vorher + 1);
    if (vorher > 0) wiederholungJeTransaktion.push(1);
  }
}

/** Einsparbare Lesevorgänge je Stapel, wenn der Cache je Transaktion gilt. */
export function wiederholungenInTransaktionen(stapel: number): number {
  return wiederholungJeTransaktion.length / Math.max(1, stapel);
}

export function formeAb(wert: unknown): string {
  try {
    return (
      JSON.stringify(wert, function (this: Record<string, unknown>, schluessel, v) {
        // **`this[schluessel]`, nicht `v`.** `JSON.stringify` ruft `toJSON`
        // eines `Date` **vor** dem Ersetzer auf; `v` ist dort längst eine
        // Zeichenkette, und `v instanceof Date` trifft nie zu. Der erste
        // Anlauf prüfte genau das und ließ deshalb jede Abfrage mit einem
        // Zeitpunkt darin einmalig aussehen — `hasPermissionWithin` fragt
        // mit `expiresAt: { gt: new Date() }`, also millisekundengenau
        // verschieden, und fiel aus der Wiederholungszählung heraus.
        const roh = this[schluessel];
        if (roh instanceof Date) return '<Zeitpunkt>';
        return typeof v === 'bigint' ? v.toString() : v;
      }) ?? 'undefined'
    );
  } catch {
    return '<nicht abbildbar>';
  }
}

export interface Wiederholungsbild {
  /** Lesevorgänge je Stapel (Mittel). */
  vorgaenge: number;
  /** Verschiedene Abfragen je Stapel (Mittel), Argumente eingeschlossen. */
  verschieden: number;
  /**
   * Vorgänge, die innerhalb **eines Stapels** buchstäblich wiederholt werden
   * — die Obergrenze dessen, was ein Zwischenspeicher einsparen könnte. Ein
   * Cache je **Kommando** kann höchstens diese Zahl erreichen und liegt in
   * der Regel darunter, weil er zwischen den Kommandos geleert wird.
   */
  wiederholungen: number;
  /** Die am häufigsten wiederholten Abfragen, gemittelt über die Stapel. */
  haeufigste: { abfrage: string; jeStapel: number }[];
  /**
   * Wiederholungen innerhalb **einer** Transaktion. Nur diese darf ein Cache
   * bedienen, ohne eine Prüfung aus einer Ablesung außerhalb der Transaktion
   * zu beantworten, deren Schreibvorgänge sie absichert.
   */
  inTransaktion: number;
}

/**
 * @param zeiten dieselben Stapel, für die auch die Zeiten gelten — die
 *   Wiederholungen werden je Stapel gebildet und dann gemittelt.
 */
export function fasseWiederholungenZusammen(
  proStapel: readonly ReadonlyMap<string, number>[],
  grenze = 10,
): Wiederholungsbild {
  if (proStapel.length === 0) {
    return { vorgaenge: 0, verschieden: 0, wiederholungen: 0, haeufigste: [], inTransaktion: 0 };
  }
  let vorgaenge = 0;
  let verschieden = 0;
  let wiederholungen = 0;
  const gesamt = new Map<string, number>();

  for (const karte of proStapel) {
    for (const [abfrage, anzahl] of karte) {
      vorgaenge += anzahl;
      verschieden += 1;
      wiederholungen += anzahl - 1; // der erste Aufruf muss geschehen
      // Für die Liste ohne IDs: der Schlüssel enthält die des Geräts, also
      // fiele über die Stapel hinweg nichts zusammen und die Liste bliebe
      // leer — obwohl die Zahl darüber Wiederholungen ausweist.
      const ohneIds = abfrage.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<id>',
      );
      // Gezählt werden die **einsparbaren** Aufrufe, nicht alle.
      if (anzahl > 1) gesamt.set(ohneIds, (gesamt.get(ohneIds) ?? 0) + (anzahl - 1));
    }
  }

  const n = proStapel.length;
  return {
    vorgaenge: vorgaenge / n,
    verschieden: verschieden / n,
    wiederholungen: wiederholungen / n,
    haeufigste: [...gesamt.entries()]
      .map(([abfrage, anzahl]) => ({ abfrage, jeStapel: anzahl / n }))
      .sort((a, b) => b.jeStapel - a.jeStapel)
      .slice(0, grenze),
    inTransaktion: wiederholungenInTransaktionen(n),
  };
}

export function formatWiederholungen(bild: Wiederholungsbild, breite = 110): string {
  if (bild.vorgaenge === 0) return '';
  return [
    `  Buchstäblich gleiche Lesevorgänge je Stapel: ${bild.wiederholungen.toFixed(1)} von ` +
      `${bild.vorgaenge.toFixed(1)} (${bild.verschieden.toFixed(1)} verschiedene Abfragen)`,
    // Die entscheidende Zeile: die Zahl darüber ist über den ganzen Stapel
    // gerechnet und damit die Obergrenze. Ein Zwischenspeicher darf aber nur
    // innerhalb einer Transaktion antworten — sonst bedient er eine Prüfung
    // aus einer Ablesung außerhalb der Transaktion, deren Schreibvorgänge sie
    // absichert.
    `    davon innerhalb einer Transaktion (was ein unbedenklicher Cache fängt): ${bild.inTransaktion.toFixed(1)}`,
    ...bild.haeufigste
      .filter((z) => z.jeStapel >= 0.5)
      .map((z) => {
        const text = z.abfrage.length > breite ? `${z.abfrage.slice(0, breite - 1)}…` : z.abfrage;
        return `    ${z.jeStapel.toFixed(1).padStart(5)}×  ${text}`;
      }),
  ].join('\n');
}

/**
 * Ist das ein lesender Vorgang?
 *
 * Eingeordnet wird am **Vorgangsnamen von Prisma**, nicht am SQL-Text — auf
 * dieser Ebene gibt es noch keinen. Die Falle ist dieselbe wie bei
 * `SELECT set_config(…)` in der Einordnung nach Anweisungstext: greift man zu
 * weit, wandern Schreibvorgänge in die Lesespalte und machen genau die Zahl
 * größer, um die es hier geht. Deshalb der Vorgang **am Ende** und nicht ein
 * Namensbestandteil.
 */
export function istLesend(vorgang: string): boolean {
  return /\.(findFirst|findUnique|findMany|count|aggregate|groupBy|findFirstOrThrow|findUniqueOrThrow)$/.test(
    vorgang,
  );
}

export interface Zugriffszeile {
  vorgang: string;
  stelle: string;
  jeStapel: number;
  lesend: boolean;
}

export function fasseZugriffeZusammen(stapel: number): Zugriffszeile[] {
  return [...zugriffe.entries()]
    .map(([schluessel, anzahl]) => {
      const [vorgang, stelle] = schluessel.split('\u0000') as [string, string];
      return { vorgang, stelle, jeStapel: anzahl / stapel, lesend: istLesend(vorgang) };
    })
    .sort((a, b) => b.jeStapel - a.jeStapel);
}

export function formatZugriffe(zeilen: readonly Zugriffszeile[], grenze = 20): string {
  if (zeilen.length === 0) return '';
  const lesend = zeilen.filter((z) => z.lesend);
  const summe = lesend.reduce((s, z) => s + z.jeStapel, 0);

  // Nach Modell zusammengefasst — die Frage lautet „welche Zeile wird mehrfach
  // gelesen", und die stellt sich je Tabelle und nicht je Aufrufstelle.
  const jeModell = new Map<string, number>();
  for (const z of lesend) {
    const modell = z.vorgang.split('.')[0]!;
    jeModell.set(modell, (jeModell.get(modell) ?? 0) + z.jeStapel);
  }

  return [
    `  Lesevorgänge je Stapel: ${summe.toFixed(1)}, nach Tabelle:`,
    ...[...jeModell.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, grenze)
      .map(([modell, anzahl]) => `    ${anzahl.toFixed(1).padStart(5)}×  ${modell}`),
    '  Nach Aufrufstelle:',
    ...lesend
      .slice(0, grenze)
      .map((z) => `    ${z.jeStapel.toFixed(1).padStart(5)}×  ${z.vorgang}  ←  ${z.stelle}`),
  ].join('\n');
}

/** Aufrufstellen, die eine Transaktion öffnen — absteigend nach Häufigkeit. */
export function fasseHerkunftZusammen(stapel: number): { stelle: string; jeStapel: number }[] {
  return [...herkunft.entries()]
    .map(([stelle, anzahl]) => ({ stelle, jeStapel: anzahl / stapel }))
    .sort((a, b) => b.jeStapel - a.jeStapel);
}

export function formatHerkunft(zeilen: { stelle: string; jeStapel: number }[]): string {
  if (zeilen.length === 0) return '';
  const summe = zeilen.reduce((s, z) => s + z.jeStapel, 0);
  return [
    `  Transaktionen je Stapel nach Aufrufstelle (${summe.toFixed(1)} insgesamt):`,
    ...zeilen.map((z) => `    ${z.jeStapel.toFixed(1).padStart(5)}×  ${z.stelle}`),
  ].join('\n');
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
  /** Zusammensetzung der Aufrufe — siehe `Anweisungsbild`. */
  anweisungen: Anweisungsbild;
}

export interface Anweisungszeile {
  anweisung: string;
  kategorie: Kategorie;
  /** Aufrufe **je Stapel** — die Zahl, um die es geht. */
  jeStapel: number;
  anzahl: number;
  dauerMs: number;
}

export interface Anweisungsbild {
  /** Aufrufe je Stapel, nach Kategorie. */
  jeKategorie: {
    kategorie: Kategorie;
    jeStapel: number;
    anteilProzent: number;
    /** Aufgewendete Zeit je Stapel. Die Zahl der Aufrufe allein sagt nicht,
     *  ob eine Art teuer ist — `BEGIN` ist häufig und billig. */
    dauerJeStapelMs: number;
  }[];
  /** Die häufigsten Anweisungen, absteigend nach Aufrufen je Stapel. */
  haeufigste: Anweisungszeile[];
  /** Zahl **verschiedener** Anweisungen — gegen die Gesamtzahl gelesen sagt
   *  sie, ob wenige Abfragen oft oder viele Abfragen einmal laufen. */
  verschiedene: number;
  gesamtJeStapel: number;
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
    anweisungen: fasseAnweisungenZusammen(Math.max(1, zeiten.length)),
  };
}

export function fasseAnweisungenZusammen(stapel: number, haeufigste = 12): Anweisungsbild {
  const zeilen: Anweisungszeile[] = [...anweisungen.entries()]
    .map(([anweisung, { anzahl, dauerMs }]) => ({
      anweisung,
      kategorie: kategorie(anweisung),
      jeStapel: anzahl / stapel,
      anzahl,
      dauerMs,
    }))
    .sort((a, b) => b.jeStapel - a.jeStapel);

  const gesamtJeStapel = zeilen.reduce((summe, z) => summe + z.jeStapel, 0);

  const kategorien = new Map<Kategorie, { jeStapel: number; dauerMs: number }>();
  for (const zeile of zeilen) {
    const eintrag = kategorien.get(zeile.kategorie) ?? { jeStapel: 0, dauerMs: 0 };
    eintrag.jeStapel += zeile.jeStapel;
    eintrag.dauerMs += zeile.dauerMs;
    kategorien.set(zeile.kategorie, eintrag);
  }

  return {
    jeKategorie: [...kategorien.entries()]
      .map(([kat, { jeStapel, dauerMs }]) => ({
        kategorie: kat,
        jeStapel,
        anteilProzent: gesamtJeStapel > 0 ? (jeStapel / gesamtJeStapel) * 100 : 0,
        dauerJeStapelMs: dauerMs / stapel,
      }))
      .sort((a, b) => b.jeStapel - a.jeStapel),
    haeufigste: zeilen.slice(0, haeufigste),
    verschiedene: zeilen.length,
    gesamtJeStapel,
  };
}

export function formatAnweisungen(bild: Anweisungsbild, breite = 96): string {
  if (bild.verschiedene === 0) return '  (keine Anweisungen aufgezeichnet)';

  const zeilen = [
    `  Aufrufe je Stapel nach Art (${bild.gesamtJeStapel.toFixed(0)} insgesamt, ` +
      `${bild.verschiedene} verschiedene Anweisungen):`,
  ];
  for (const k of bild.jeKategorie) {
    zeilen.push(
      `    ${k.kategorie.padEnd(19)} ${k.jeStapel.toFixed(1).padStart(6)} ` +
        `(${k.anteilProzent.toFixed(0).padStart(2)} %)   ${k.dauerJeStapelMs.toFixed(0).padStart(5)} ms`,
    );
  }
  zeilen.push('  Häufigste Anweisungen je Stapel:');
  for (const z of bild.haeufigste) {
    const text = z.anweisung.length > breite ? `${z.anweisung.slice(0, breite - 1)}…` : z.anweisung;
    zeilen.push(`    ${z.jeStapel.toFixed(1).padStart(5)}×  ${text}`);
  }
  return zeilen.join('\n');
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
