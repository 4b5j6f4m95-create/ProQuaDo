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

import { vereinigteDauer } from '../zeitnahme';

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
