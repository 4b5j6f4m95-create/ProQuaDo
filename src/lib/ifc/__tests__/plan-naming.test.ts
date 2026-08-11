import {
  peekModuleNumbers,
  suggestPlanIdentity,
  suggestPlanName,
  suggestPlanNumber,
} from '../plan-naming';

function property(name: string, value: string): string {
  return `#1=IFCPROPERTYSINGLEVALUE('${name}',$,IFCTEXT('${value}'),$);`;
}

describe('peekModuleNumbers', () => {
  it('findet die Modulnummer, ohne die Datei zu parsen', () => {
    const content = [
      property('Material', 'Küche'),
      property('RAUMNUMMER', 'A08.4/A08.b'),
      property('Arbeitsvorgang', '20: Statische Verschraubung'),
    ].join('\n');

    expect(peekModuleNumbers(content)).toEqual(['A08.4/A08.b']);
  });

  it('nennt jede Nummer einmal, auch wenn sie an 1168 Bauteilen steht', () => {
    const content = Array.from({ length: 50 }, () => property('RAUMNUMMER', 'A08.4/A08.b')).join(
      '\n',
    );

    expect(peekModuleNumbers(content)).toEqual(['A08.4/A08.b']);
  });

  it('findet mehrere verschiedene Nummern', () => {
    const content = [
      property('RAUMNUMMER', 'A08.4'),
      property('RAUMNUMMER', 'B12.1'),
      property('RAUMNUMMER', 'A08.4'),
    ].join('\n');

    expect(peekModuleNumbers(content)).toEqual(['A08.4', 'B12.1']);
  });

  it('liefert nichts, wenn das Merkmal fehlt', () => {
    expect(peekModuleNumbers(property('Material', 'Holz'))).toEqual([]);
  });
});

describe('suggestPlanNumber', () => {
  it('ersetzt den Schrägstrich, der in Pfaden ein Verzeichnis trennen würde', () => {
    expect(suggestPlanNumber('A08.4/A08.b')).toBe('FP-A08.4-A08.b');
  });

  it('behält Punkte und Bindestriche, weil sie die Systematik tragen', () => {
    expect(suggestPlanNumber('M-12.3')).toBe('FP-M-12.3');
  });

  it('fasst Ketten von Trennzeichen zusammen und schneidet Ränder ab', () => {
    expect(suggestPlanNumber(' //A 1// ')).toBe('FP-A-1');
  });

  it('bleibt innerhalb der 50 Zeichen der Spalte', () => {
    expect(suggestPlanNumber('X'.repeat(80))).toHaveLength(50);
  });

  it('liefert nichts für eine Nummer ohne verwendbare Zeichen', () => {
    expect(suggestPlanNumber('///')).toBe('');
  });
});

describe('suggestPlanName', () => {
  it('nennt das Modul beim Namen', () => {
    expect(suggestPlanName('A08.4/A08.b')).toBe('Fertigungsstraße Modul A08.4/A08.b');
  });
});

describe('suggestPlanIdentity', () => {
  it('schlägt Nummer und Namen für einen Modulexport vor', () => {
    const content = property('RAUMNUMMER', 'A08.4/A08.b');

    expect(suggestPlanIdentity(content)).toEqual({
      moduleNumber: 'A08.4/A08.b',
      planNumber: 'FP-A08.4-A08.b',
      name: 'Fertigungsstraße Modul A08.4/A08.b',
    });
  });

  /**
   * Zwei Modulnummern heißen: das ist kein Modulexport, sondern ein
   * Ausschnitt aus einem größeren Modell. Daraus eine Plannummer zu raten
   * hieße, eine Entscheidung zu treffen, die dem Menschen gehört.
   */
  it('schlägt nichts vor, wenn die Datei mehrere Module enthält', () => {
    const content = [property('RAUMNUMMER', 'A08.4'), property('RAUMNUMMER', 'B12.1')].join('\n');

    expect(suggestPlanIdentity(content)).toBeNull();
  });

  it('schlägt nichts vor, wenn keine Modulnummer da ist', () => {
    expect(suggestPlanIdentity(property('Material', 'Holz'))).toBeNull();
  });
});
