/**
 * Die Bauteile, die in diesem Arbeitsschritt verbaut werden — aus dem
 * importierten Gebäudemodell.
 *
 * **Warum gruppiert und nicht als Liste.** Schritt 20 „Statische
 * Verschraubung" trägt im Beispielmodul 458 Bauteile. Eine Liste mit 458
 * Zeilen auf einem Hallentablet ist keine Hilfe, sondern eine Wand: der
 * Werker will wissen, *was* er verbaut und *wie viel davon*, nicht die
 * Kennung jedes einzelnen Stücks. Die vollständige Liste bleibt trotzdem
 * erreichbar — für die Rückverfolgung zählt sie, nur nicht beim Arbeiten.
 */

export interface IfcComponentView {
  id: string;
  componentNumber: string | null;
  objectName: string | null;
  material: string | null;
  ifcType: string;
}

/** Fasst gleichartige Bauteile zusammen: „Erweitertes Element, Küche — 165×". */
export function groupComponents(
  components: readonly IfcComponentView[],
): Array<{ key: string; objectName: string; material: string | null; count: number }> {
  const groups = new Map<string, { objectName: string; material: string | null; count: number }>();

  for (const component of components) {
    const objectName = component.objectName ?? component.ifcType;
    const material = component.material;
    // JSON statt zusammengeklebter Zeichenkette: „Platte" + „Holz" und
    // „Platte Holz" + nichts dürfen nicht denselben Schlüssel ergeben.
    const key = JSON.stringify([objectName, material]);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { objectName, material, count: 1 });
  }

  return [...groups.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.objectName.localeCompare(b.objectName, 'de'));
}

export function IfcComponentList({ components }: { components: readonly IfcComponentView[] }) {
  if (components.length === 0) return null;

  const groups = groupComponents(components);

  return (
    <section className="card">
      <h2>Bauteile aus dem Modell ({components.length})</h2>

      <table>
        <thead>
          <tr>
            <th scope="col">Anzahl</th>
            <th scope="col">Bauteil</th>
            <th scope="col">Material</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <td>{group.count}×</td>
              <td>{group.objectName}</td>
              <td>{group.material ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details>
        <summary>Einzelne Bauteile anzeigen ({components.length})</summary>
        <ul>
          {components.map((component) => (
            <li key={component.id}>
              {component.componentNumber ?? '(ohne Nummer)'}
              {component.objectName ? ` — ${component.objectName}` : ''}
              {component.material ? ` · ${component.material}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
