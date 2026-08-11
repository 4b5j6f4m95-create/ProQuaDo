/**
 * Liest aus einer IFC-Datei (ISO-10303-21, „STEP Physical File") die
 * Arbeitsvorgänge einer Fertigungsstraße und die Bauteile, die zu ihnen
 * gehören.
 *
 * **Warum ein eigener Parser und keine IFC-Bibliothek.** Die vollständigen
 * Bibliotheken (web-ifc und Verwandte) bringen ein WASM-Modul von mehreren
 * Megabyte mit und lösen ein Problem, das hier nicht besteht: Geometrie. Von
 * einer 23-MB-Datei sind rund 95 % der Zeilen Kartesische Punkte und Flächen,
 * und keine einzige davon wird gebraucht. Gebraucht werden vier Entitätstypen
 * und ihre Verkettung. Dafür eine Abhängigkeit dieser Größe aufzunehmen wäre
 * derselbe Handel, den ADR-007 für Warteschlangen abgelehnt hat.
 *
 * **Was gelesen wird.** Die Arbeitsschritte stehen NICHT als `IfcTask` oder
 * `IfcWorkSchedule` in der Datei — geprüft an der Beispieldatei aus Allplan,
 * die keine einzige Prozessentität enthält. Sie stehen als Merkmal
 * `Arbeitsvorgang` an jedem Bauteil, in der Form „20: Statische
 * Verschraubung": die Zahl ist die Reihenfolge in der Straße, der Text der
 * Name des Schritts. Die Verkettung dorthin:
 *
 *     IfcBuildingElementProxy (#105)
 *       ← IfcRelDefinesByProperties(…, (#105), #115)
 *           → IfcPropertySet(#115, 'AllplanAttributes', (#108 … #114))
 *               → IfcPropertySingleValue('Arbeitsvorgang', $, IfcText('130: …'))
 *
 * **Was ausdrücklich nicht gelesen wird:** Geometrie, Platzierung,
 * Darstellung, Material-Zuordnungen als Entität (der Materialname kommt aus
 * dem Merkmalssatz, nicht aus `IfcRelAssociatesMaterial`).
 */

/** Ein Arbeitsvorgang, wie er in der Datei steht — Reihenfolge und Name. */
export interface IfcWorkStep {
  /** Die Zahl vor dem Doppelpunkt. Sortierschlüssel der Fertigungsstraße. */
  stepNumber: number;
  /** Der Text nach dem Doppelpunkt, ohne führende Leerzeichen. */
  title: string;
  /** Der unveränderte Merkmalswert, für die Rückverfolgung zur Quelle. */
  rawValue: string;
  /** Wie viele Bauteile diesem Vorgang zugeordnet sind. */
  componentCount: number;
}

/** Ein Bauteil mit den Merkmalen, die für die Fertigung tragen. */
export interface IfcComponent {
  /** IFC-GlobalId, 22 Zeichen. Stabil über Exporte desselben Modells. */
  globalId: string;
  /** Entitätstyp, z. B. `IFCBUILDINGELEMENTPROXY`. */
  ifcType: string;
  /** `stepNumber` des Arbeitsvorgangs, dem es zugeordnet ist. */
  stepNumber: number;
  /** Merkmal `Allright_Bauteil_ID` — die Kennung des Fertigers. */
  componentNumber?: string;
  /** Merkmal `Objektname`. */
  objectName?: string;
  /** Merkmal `Material`. */
  material?: string;
  /** Merkmal `Gewerk`, z. B. „36 Holzbau". Nur an einem Teil der Bauteile. */
  trade?: string;
}

export interface IfcParseResult {
  /** Aus `FILE_SCHEMA`, z. B. `IFC2X3`. */
  schema: string;
  /** Aus `FILE_NAME`, das erzeugende Programm. */
  sourceApplication?: string;
  /** Merkmal `RAUMNUMMER` — bei einem Modulexport genau ein Wert. */
  moduleNumbers: string[];
  /** Nach `stepNumber` aufsteigend, also in der Reihenfolge der Straße. */
  steps: IfcWorkStep[];
  components: IfcComponent[];
  /**
   * Alles, was gelesen wurde und nicht zugeordnet werden konnte. Bewusst
   * kein stiller Verlust: eine Datei, aus der 119 von 1287 Bauteilen
   * herausfallen, ist ein Fall für eine Rückfrage beim Fertiger und nicht
   * für einen Import, der „erfolgreich" meldet.
   */
  warnings: string[];
}

export class IfcParseError extends Error {}

/**
 * **Ausschlussliste, nicht Positivliste** — und das ist der Punkt.
 *
 * Der erste Entwurf zählte auf, welche Entitätstypen ein Bauteil sein
 * dürfen. Gegen die Beispieldatei gehalten fehlten darin `IFCCURTAINWALL`
 * (drei Vorhangfassaden, ein echtes Bauteil) — bemerkt nur, weil die
 * Bauteilzahl 17 unter der Zahl der Merkmale lag. Bei einem anderen Fertiger
 * wären es `IFCROOF`, `IFCRAILING` oder `IFCSTAIR` gewesen, und eine
 * Positivliste hätte sie ebenso still verschluckt.
 *
 * Deshalb umgekehrt: alles, was einen Arbeitsvorgang trägt, ist ein Bauteil —
 * außer den Typen hier, die keine physische Sache sind, und der räumlichen
 * Gliederung. Was ausgeschlossen wird, steht anschließend als Warnung im
 * Ergebnis; ein unbekannter Typ führt zu einer Zeile im Bericht, nicht zu
 * einem Verlust.
 */
const NON_PHYSICAL_TYPES = new Set([
  'IFCANNOTATION', // Beschriftung im Modell, kein Bauteil
  'IFCGRID',
  'IFCVIRTUALELEMENT',
  'IFCOPENINGELEMENT', // eine Aussparung ist die Abwesenheit von Material
]);

/** Räumliche Gliederung und Typen — tragen Merkmale, sind aber kein Bauteil. */
const NON_COMPONENT_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE',
  'IFCZONE',
  'IFCGROUP',
  'IFCSYSTEM',
]);

const PROPERTY_ARBEITSVORGANG = 'Arbeitsvorgang';
const PROPERTY_ROOM = 'RAUMNUMMER';
const PROPERTY_COMPONENT_ID = 'Allright_Bauteil_ID';
const PROPERTY_OBJECT_NAME = 'Objektname';
const PROPERTY_MATERIAL = 'Material';
const PROPERTY_TRADE = 'Gewerk';

/**
 * Eine Zeile der DATA-Sektion: `#123=IFCTYPE(arg,arg,…);`
 *
 * Bewusst zeilenweise und nicht als vollständige Grammatik. Der STEP-Standard
 * erlaubt Zeilenumbrüche innerhalb einer Entität; die hier verarbeiteten
 * Exporte setzen eine Entität je Zeile. Trifft das nicht zu, fällt es beim
 * Zusammenführen als fehlende Referenz auf und wird gemeldet — nicht still
 * übergangen.
 */
const ENTITY_LINE = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;\s*$/;

export function parseIfc(content: string): IfcParseResult {
  const warnings: string[] = [];

  const schema = firstMatch(content, /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/);
  if (!schema) {
    throw new IfcParseError(
      'Keine FILE_SCHEMA-Angabe gefunden — die Datei ist kein IFC im STEP-Format.',
    );
  }
  // **Vollständigkeitsprüfung, und sie ist keine Förmlichkeit.** Eine auf
  // halber Strecke abgeschnittene IFC-Datei hat weiterhin einen gültigen Kopf
  // und gültige Bauteile — sie würde anstandslos einen Fertigungsplan
  // erzeugen, dem die hinteren Arbeitsschritte fehlen. Und „Verpacken" und
  // „Verladen" stehen am Ende der Straße. Der Schlussmarker der Norm ist das
  // einzige, woran sich das erkennen lässt.
  //
  // Der Fall ist nicht ausgedacht: Next 16 kappt Request-Körper bei 10 MB
  // still, und das Beispielmodul misst 23 MB (siehe next.config.mjs).
  if (!/END-ISO-10303-21\s*;\s*$/.test(content.trimEnd())) {
    throw new IfcParseError(
      'Die Datei endet nicht mit „END-ISO-10303-21;" und ist damit unvollständig — ' +
        'vermutlich beim Übertragen abgeschnitten. Ein Import daraus hätte Arbeitsschritte verloren.',
    );
  }

  const sourceApplication = firstMatch(content, /FILE_NAME\s*\([^)]*?'([^']*)'\s*,\s*'[^']*'\s*\)/);

  // Erster Durchlauf: die vier Entitätstypen einsammeln, die zählen.
  const properties = new Map<number, { name: string; value: string }>();
  const propertySets = new Map<number, number[]>();
  /** PropertySet-Id → Element-Ids, die darauf zeigen. */
  const setToElements = new Map<number, number[]>();
  const elements = new Map<number, { globalId: string; ifcType: string }>();

  for (const line of content.split('\n')) {
    if (line.length === 0 || line.charCodeAt(0) !== 35 /* '#' */) continue;
    const match = ENTITY_LINE.exec(line);
    if (!match) continue;

    const [, rawId, type, args] = match;
    if (rawId === undefined || type === undefined || args === undefined) continue;
    const id = Number(rawId);

    if (type === 'IFCPROPERTYSINGLEVALUE') {
      const parsed = parsePropertySingleValue(args);
      if (parsed) properties.set(id, parsed);
      continue;
    }

    if (type === 'IFCPROPERTYSET') {
      propertySets.set(id, collectRefs(lastGroup(args)));
      continue;
    }

    if (type === 'IFCRELDEFINESBYPROPERTIES') {
      // (…, (relatedObjects), relatingPropertyDefinition)
      const setRef = lastRef(args);
      const related = collectRefs(lastGroup(args));
      if (setRef !== undefined && related.length > 0) {
        const existing = setToElements.get(setRef);
        if (existing) existing.push(...related);
        else setToElements.set(setRef, related);
      }
      continue;
    }

    // Alles Übrige, das eine GlobalId trägt (22 Zeichen, IfcRoot), kommt als
    // möglicher Kandidat in die Ablage. Aussortiert wird erst, wenn feststeht,
    // ob ein Arbeitsvorgang daran hängt — vorher weiß man nicht, was zählt.
    const globalId = firstMatch(args, /^'([^']{22})'/);
    if (globalId) elements.set(id, { globalId, ifcType: type });
  }

  if (elements.size === 0) {
    throw new IfcParseError(
      'Die Datei enthält keine Objekte mit GlobalId — sie ist kein auswertbares IFC-Modell.',
    );
  }

  // Zweiter Durchlauf: Merkmale je Element zusammenführen. Ein Element kann
  // mehrere Merkmalssätze haben (hier: AllplanAttributes und
  // Pset_ManufacturerTypeInformation), deshalb wird gesammelt und nicht ersetzt.
  const byElement = new Map<number, Map<string, string>>();
  let unresolvedSets = 0;

  for (const [setId, elementIds] of setToElements) {
    const propIds = propertySets.get(setId);
    if (!propIds) {
      unresolvedSets += 1;
      continue;
    }
    for (const elementId of elementIds) {
      if (!elements.has(elementId)) continue;
      let bag = byElement.get(elementId);
      if (!bag) {
        bag = new Map<string, string>();
        byElement.set(elementId, bag);
      }
      for (const propId of propIds) {
        const property = properties.get(propId);
        if (property && !bag.has(property.name)) bag.set(property.name, property.value);
      }
    }
  }

  if (unresolvedSets > 0) {
    warnings.push(
      `${unresolvedSets} Merkmalssätze verweisen auf eine Definition, die nicht in der Datei steht — ` +
        'ihre Bauteile bleiben unberücksichtigt.',
    );
  }

  // Dritter Durchlauf: Bauteile und Arbeitsvorgänge bilden.
  const components: IfcComponent[] = [];
  const stepsByNumber = new Map<number, IfcWorkStep>();
  const moduleNumbers = new Set<string>();
  let withoutStep = 0;
  const malformed = new Set<string>();
  const excludedByType = new Map<string, number>();

  // Nur Objekte, an denen überhaupt Merkmale hängen. Merkmalssätze und
  // Beziehungen tragen zwar auch eine GlobalId, stehen aber nie auf der
  // Objektseite einer `IfcRelDefinesByProperties` und tauchen hier deshalb
  // nicht auf.
  for (const [elementId, bag] of byElement) {
    const element = elements.get(elementId);
    if (!element) continue;

    if (NON_COMPONENT_TYPES.has(element.ifcType)) continue;

    const raw = bag.get(PROPERTY_ARBEITSVORGANG);
    if (!raw) {
      withoutStep += 1;
      continue;
    }

    if (NON_PHYSICAL_TYPES.has(element.ifcType)) {
      excludedByType.set(element.ifcType, (excludedByType.get(element.ifcType) ?? 0) + 1);
      continue;
    }

    const step = parseWorkStepLabel(raw);
    if (!step) {
      malformed.add(raw);
      continue;
    }

    const room = bag?.get(PROPERTY_ROOM);
    if (room) moduleNumbers.add(room);

    const known = stepsByNumber.get(step.stepNumber);
    if (!known) {
      stepsByNumber.set(step.stepNumber, { ...step, rawValue: raw, componentCount: 1 });
    } else {
      known.componentCount += 1;
      if (known.title !== step.title) {
        malformed.add(
          `Nummer ${step.stepNumber} trägt zwei Bezeichnungen: „${known.title}" und „${step.title}"`,
        );
      }
    }

    components.push({
      globalId: element.globalId,
      ifcType: element.ifcType,
      stepNumber: step.stepNumber,
      componentNumber: bag?.get(PROPERTY_COMPONENT_ID),
      objectName: bag?.get(PROPERTY_OBJECT_NAME),
      material: bag?.get(PROPERTY_MATERIAL),
      trade: bag?.get(PROPERTY_TRADE),
    });
  }

  if (withoutStep > 0) {
    warnings.push(
      `${withoutStep} von ${withoutStep + components.length} Objekten tragen kein Merkmal ` +
        `„${PROPERTY_ARBEITSVORGANG}" und sind keinem Arbeitsschritt zugeordnet.`,
    );
  }
  for (const [type, count] of excludedByType) {
    warnings.push(
      `${count}× ${type} trägt einen Arbeitsvorgang, ist aber kein Bauteil und wurde ausgelassen.`,
    );
  }
  for (const entry of malformed) {
    warnings.push(`Nicht auswertbarer Arbeitsvorgang: ${entry}`);
  }

  if (stepsByNumber.size === 0) {
    throw new IfcParseError(
      `Kein Bauteil trägt ein auswertbares Merkmal „${PROPERTY_ARBEITSVORGANG}". ` +
        'Erwartet wird die Form „20: Statische Verschraubung".',
    );
  }

  return {
    schema,
    ...(sourceApplication ? { sourceApplication } : {}),
    moduleNumbers: [...moduleNumbers].sort(),
    steps: [...stepsByNumber.values()].sort((a, b) => a.stepNumber - b.stepNumber),
    components,
    warnings,
  };
}

/**
 * „130: Küchen Montage" → { stepNumber: 130, title: 'Küchen Montage' }
 *
 * Führende Nullen sind in dieser Quelle üblich („04: Modulboden") und werden
 * als Dezimalzahl gelesen, nicht als Oktal.
 */
export function parseWorkStepLabel(raw: string): { stepNumber: number; title: string } | null {
  const match = /^\s*(\d{1,6})\s*:\s*(\S.*?)\s*$/.exec(raw);
  const digits = match?.[1];
  const title = match?.[2];
  if (digits === undefined || title === undefined) return null;
  const stepNumber = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(stepNumber)) return null;
  return { stepNumber, title };
}

function parsePropertySingleValue(args: string): { name: string; value: string } | null {
  // IFCPROPERTYSINGLEVALUE('Name',$,IFCTEXT('Wert'),$)
  const match = /^'([^']*)'\s*,\s*[^,]*,\s*[A-Z0-9_]+\s*\(\s*'((?:[^']|'')*)'\s*\)/.exec(args);
  const name = match?.[1];
  const value = match?.[2];
  if (name === undefined || value === undefined) return null;
  return { name: decodeStepString(name), value: decodeStepString(value) };
}

/** Der Inhalt der letzten Klammergruppe `(#1,#2,#3)` in einer Argumentliste. */
function lastGroup(args: string): string {
  const end = args.lastIndexOf(')');
  if (end === -1) return '';
  const start = args.lastIndexOf('(', end);
  if (start === -1) return '';
  return args.slice(start + 1, end);
}

/** Die letzte Entitätsreferenz `#123` in einer Argumentliste. */
function lastRef(args: string): number | undefined {
  const match = /#(\d+)\s*$/.exec(args.trim());
  return match ? Number(match[1]) : undefined;
}

function collectRefs(group: string): number[] {
  const refs: number[] = [];
  const pattern = /#(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(group)) !== null) refs.push(Number(match[1]));
  return refs;
}

function firstMatch(haystack: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(haystack);
  return match?.[1];
}

/**
 * Dekodiert die Zeichenkodierung von ISO-10303-21.
 *
 * Ohne das steht „Küchen Montage" als „K\X\FCchen Montage" in der Datenbank
 * und damit auf dem Tablet des Werkers. Die Formen:
 *
 *   `\X\FC`            ein Byte, latin-1  → ü
 *   `\X2\00FC00E4\X0\` UTF-16, beliebig viele Zeichen
 *   `\S\d`             Zeichen + 128 (ISO 8859-1)
 *   `''`               einfaches Anführungszeichen
 */
export function decodeStepString(raw: string): string {
  let out = raw.replace(/''/g, "'");

  out = out.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_all, hex: string) => {
    let text = '';
    for (let i = 0; i + 3 < hex.length; i += 4) {
      text += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return text;
  });

  out = out.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_all, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

  out = out.replace(/\\S\\(.)/g, (_all, char: string) =>
    String.fromCharCode(char.charCodeAt(0) + 128),
  );

  return out.replace(/\\\\/g, '\\');
}
