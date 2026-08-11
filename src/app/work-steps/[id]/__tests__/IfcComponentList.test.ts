import { groupComponents, type IfcComponentView } from '../IfcComponentList';

function component(overrides: Partial<IfcComponentView> & { id: string }): IfcComponentView {
  return {
    componentNumber: null,
    objectName: null,
    material: null,
    ifcType: 'IFCBUILDINGELEMENTPROXY',
    ...overrides,
  };
}

describe('groupComponents', () => {
  it('fasst gleichartige Bauteile zusammen und zählt sie', () => {
    const groups = groupComponents([
      component({ id: '1', objectName: 'Schraube', material: 'Stahl' }),
      component({ id: '2', objectName: 'Schraube', material: 'Stahl' }),
      component({ id: '3', objectName: 'Winkel', material: 'Stahl' }),
    ]);

    // Ohne den Schlüssel: seine Form ist Implementierungsdetail, und ein Test,
    // der sie festschreibt, bricht bei jeder Umstellung ohne Aussage. Der
    // erste Entwurf tat genau das — und deckte dabei zufällig auf, dass im
    // Trennzeichen ein NUL-Byte statt eines Leerzeichens stand.
    expect(
      groups.map(({ objectName, material, count }) => ({ objectName, material, count })),
    ).toEqual([
      { objectName: 'Schraube', material: 'Stahl', count: 2 },
      { objectName: 'Winkel', material: 'Stahl', count: 1 },
    ]);
  });

  it('unterscheidet Bauteile, deren Namen nur zusammengeklebt gleich aussähen', () => {
    const groups = groupComponents([
      component({ id: '1', objectName: 'Platte', material: 'Holz' }),
      component({ id: '2', objectName: 'Platte Holz', material: null }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('trennt gleiche Bauteile aus verschiedenem Material', () => {
    const groups = groupComponents([
      component({ id: '1', objectName: 'Platte', material: 'Holz' }),
      component({ id: '2', objectName: 'Platte', material: 'Gips' }),
    ]);

    expect(groups).toHaveLength(2);
  });

  /**
   * Im Beispielmodell heißen 1095 Bauteile „Erweitertes Element" und tragen
   * gar keinen Objektnamen, wenn Allplan keinen exportiert. Dann ist der
   * IFC-Typ die einzige Auskunft, die bleibt — besser als eine leere Zelle.
   */
  it('fällt auf den IFC-Typ zurück, wenn kein Objektname da ist', () => {
    const groups = groupComponents([component({ id: '1', ifcType: 'IFCBEAM' })]);

    expect(groups[0]?.objectName).toBe('IFCBEAM');
  });

  it('sortiert nach Anzahl, damit oben steht, wovon es am meisten gibt', () => {
    const groups = groupComponents([
      component({ id: '1', objectName: 'Selten' }),
      component({ id: '2', objectName: 'Häufig' }),
      component({ id: '3', objectName: 'Häufig' }),
      component({ id: '4', objectName: 'Häufig' }),
    ]);

    expect(groups.map((g) => g.objectName)).toEqual(['Häufig', 'Selten']);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(groupComponents([])).toEqual([]);
  });
});
