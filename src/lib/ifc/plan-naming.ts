/**
 * Plannummer und Planname aus der Modulnummer im Gebäudemodell ableiten.
 *
 * **Warum das hier steht und nicht im Parser.** Diese Funktionen laufen auch
 * im Browser: das Formular liest die gewählte Datei einmal vor dem Hochladen,
 * um die Felder zu füllen. Deshalb keine Node-Abhängigkeit, keine
 * Datenbankkenntnis, nichts als Zeichenkettenarbeit — `parse-ifc.ts` bliebe
 * dafür zu schwer und ist auf dem Server richtig aufgehoben.
 *
 * **Warum überhaupt.** Je Modul entsteht ein eigener Fertigungsplan; die
 * Modulnummer steht in der Datei. Sie abtippen zu lassen ist Arbeit ohne
 * Ertrag und eine Fehlerquelle: ein Zahlendreher in der Plannummer fällt erst
 * auf, wenn jemand den Plan sucht.
 *
 * Ein **Vorschlag**, keine Festlegung: die Felder bleiben änderbar. Wer eine
 * eigene Systematik in der Halle hat, überschreibt ihn.
 */

/**
 * Sucht die Modulnummern (`RAUMNUMMER`), ohne die Datei zu parsen.
 *
 * Ein Streifzug mit einem regulären Ausdruck statt eines Durchlaufs durch
 * alle Entitäten — für einen Vorschlag reicht das, und im Browser zählt jede
 * Zehntelsekunde vor dem ersten Tastendruck. Die verbindliche Auswertung
 * macht der Server mit `parseIfc`; was hier herauskommt, wird nie
 * gespeichert.
 */
export function peekModuleNumbers(content: string): string[] {
  const found = new Set<string>();
  const pattern = /'RAUMNUMMER'\s*,\s*[^,]*,\s*[A-Z0-9_]+\s*\(\s*'([^']*)'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const value = match[1]?.trim();
    if (value) found.add(value);
  }
  return [...found].sort();
}

/**
 * `A08.4/A08.b` → `FP-A08.4-A08.b`
 *
 * Der Schrägstrich muss weg: die Plannummer taucht in Pfaden und Dateinamen
 * auf (Akte, ZIP-Export), und dort trennt er Verzeichnisse. Punkte und
 * Bindestriche bleiben, weil sie die Systematik des Fertigers tragen.
 */
export function suggestPlanNumber(moduleNumber: string): string {
  const cleaned = moduleNumber
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  if (!cleaned) return '';
  // `production_plans.plan_number` fasst 50 Zeichen.
  return `FP-${cleaned}`.slice(0, 50);
}

export function suggestPlanName(moduleNumber: string): string {
  const cleaned = moduleNumber.trim();
  if (!cleaned) return '';
  return `Fertigungsstraße Modul ${cleaned}`.slice(0, 255);
}

/**
 * Der Vorschlag für eine Datei — oder nichts, wenn sie keine oder mehrere
 * Modulnummern trägt.
 *
 * **Mehrere sind mit Absicht kein Vorschlag.** Eine Datei mit zwei
 * Modulnummern ist kein Modulexport, sondern ein Ausschnitt aus einem
 * größeren Modell. Daraus eine Plannummer zu raten hieße, eine Entscheidung
 * zu treffen, die dem Menschen gehört — er sieht die Zahl im Formular und
 * merkt, dass etwas nicht stimmt.
 */
export function suggestPlanIdentity(
  content: string,
): { moduleNumber: string; planNumber: string; name: string } | null {
  const modules = peekModuleNumbers(content);
  if (modules.length !== 1) return null;
  const moduleNumber = modules[0];
  if (!moduleNumber) return null;

  const planNumber = suggestPlanNumber(moduleNumber);
  const name = suggestPlanName(moduleNumber);
  if (!planNumber || !name) return null;

  return { moduleNumber, planNumber, name };
}
