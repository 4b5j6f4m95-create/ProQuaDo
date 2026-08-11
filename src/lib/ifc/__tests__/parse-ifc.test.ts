import { parseIfc, parseWorkStepLabel, decodeStepString, IfcParseError } from '../parse-ifc';

/**
 * Die Ausschnitte sind aus einer echten Exportdatei entnommen (Allplan,
 * IFC2X3, Modulbau) und in der Schreibweise unverändert — einschließlich der
 * \X\-Fluchtfolgen, an denen der erste Entwurf des Parsers scheiterte.
 */
function ifc(body: string): string {
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('no view'),'2;1');",
    "FILE_NAME('Modul.ifc','2026-08-11T11:30:46',('Wolf'),('No Organization',''),'ODA SDAI 25.4','','mwo');",
    "FILE_SCHEMA(('IFC2X3'));",
    'ENDSEC;',
    'DATA;',
    body,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}

/** Ein Bauteil samt Merkmalssatz, wie es in der Quelldatei zusammenhängt. */
function element(
  id: number,
  globalId: string,
  arbeitsvorgang: string,
  extra: { type?: string; bauteilId?: string; material?: string; gewerk?: string } = {},
): string {
  const type = extra.type ?? 'IFCBUILDINGELEMENTPROXY';
  const p = id + 1;
  const props = [
    `#${p}=IFCPROPERTYSINGLEVALUE('Arbeitsvorgang',$,IFCTEXT('${arbeitsvorgang}'),$);`,
  ];
  const refs = [`#${p}`];
  let next = p + 1;
  if (extra.bauteilId) {
    props.push(
      `#${next}=IFCPROPERTYSINGLEVALUE('Allright_Bauteil_ID',$,IFCTEXT('${extra.bauteilId}'),$);`,
    );
    refs.push(`#${next}`);
    next += 1;
  }
  if (extra.material) {
    props.push(`#${next}=IFCPROPERTYSINGLEVALUE('Material',$,IFCTEXT('${extra.material}'),$);`);
    refs.push(`#${next}`);
    next += 1;
  }
  if (extra.gewerk) {
    props.push(`#${next}=IFCPROPERTYSINGLEVALUE('Gewerk',$,IFCTEXT('${extra.gewerk}'),$);`);
    refs.push(`#${next}`);
    next += 1;
  }
  props.push(`#${next}=IFCPROPERTYSINGLEVALUE('RAUMNUMMER',$,IFCTEXT('A08.4/A08.b'),$);`);
  refs.push(`#${next}`);
  const setId = next + 1;
  return [
    `#${id}=${type}('${globalId}',#5,' ',$,$,#63,#64,$,$);`,
    ...props,
    `#${setId}=IFCPROPERTYSET('${guid('set', setId)}',#5,'AllplanAttributes',$,(${refs.join(',')}));`,
    `#${setId + 1}=IFCRELDEFINESBYPROPERTIES('${guid('rel', setId)}',#5,$,$,(#${id}),#${setId});`,
  ].join('\n');
}

/** Eine GlobalId ist genau 22 Zeichen lang — daran erkennt der Parser sie. */
function guid(prefix: string, id: number): string {
  return (prefix + String(id)).padEnd(22, '0').slice(0, 22);
}

describe('parseIfc', () => {
  it('liest Arbeitsvorgänge in der Reihenfolge der Fertigungsstraße', () => {
    const result = parseIfc(
      ifc(
        [
          element(100, '258bKmHOf6ieXVsEGIv8w1', '130: K\\X\\FCchen Montage'),
          element(200, '098WhdmAn8q8eMmLe_4Dqk', '20: Statische Verschraubung'),
          element(300, '14BtizezL0BwJWxJb1mmPw', '04: Modulboden'),
        ].join('\n'),
      ),
    );

    expect(result.schema).toBe('IFC2X3');
    // Nach Nummer sortiert, nicht in der Reihenfolge der Datei — die Zahl ist
    // die Position in der Straße.
    expect(result.steps.map((s) => s.stepNumber)).toEqual([4, 20, 130]);
    expect(result.steps.map((s) => s.title)).toEqual([
      'Modulboden',
      'Statische Verschraubung',
      'Küchen Montage',
    ]);
  });

  it('zählt die Bauteile je Arbeitsvorgang', () => {
    const result = parseIfc(
      ifc(
        [
          element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '20: Statische Verschraubung'),
          element(200, 'aaaaaaaaaaaaaaaaaaaaa2', '20: Statische Verschraubung'),
          element(300, 'aaaaaaaaaaaaaaaaaaaaa3', '130: K\\X\\FCchen Montage'),
        ].join('\n'),
      ),
    );

    expect(result.steps.find((s) => s.stepNumber === 20)?.componentCount).toBe(2);
    expect(result.steps.find((s) => s.stepNumber === 130)?.componentCount).toBe(1);
    expect(result.components).toHaveLength(3);
  });

  it('übernimmt Bauteilkennung, Material und Gewerk', () => {
    const result = parseIfc(
      ifc(
        element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '130: K\\X\\FCchen Montage', {
          bauteilId: '4950ErE0000000014',
          material: 'K\\X\\FCche',
          gewerk: '36 Holzbau',
        }),
      ),
    );

    expect(result.components[0]).toMatchObject({
      globalId: 'aaaaaaaaaaaaaaaaaaaaa1',
      componentNumber: '4950ErE0000000014',
      material: 'Küche',
      trade: '36 Holzbau',
    });
    expect(result.moduleNumbers).toEqual(['A08.4/A08.b']);
  });

  /**
   * Der Fehler, den die echte Datei aufdeckte: der erste Entwurf zählte
   * erlaubte Entitätstypen auf und verlor dabei drei Vorhangfassaden, ohne
   * ein Wort darüber zu verlieren. Bemerkt nur, weil die Bauteilzahl 17 unter
   * der Zahl der Merkmale lag.
   */
  it('nimmt auch Bauteiltypen auf, die keine Positivliste vorhergesehen hätte', () => {
    const result = parseIfc(
      ifc(
        [
          element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '70: Fassadenaufbau', { type: 'IFCCURTAINWALL' }),
          element(200, 'aaaaaaaaaaaaaaaaaaaaa2', '70: Fassadenaufbau', { type: 'IFCROOF' }),
        ].join('\n'),
      ),
    );

    expect(result.components).toHaveLength(2);
    expect(result.components.map((c) => c.ifcType).sort()).toEqual(['IFCCURTAINWALL', 'IFCROOF']);
  });

  it('lässt Beschriftungen aus, meldet sie aber statt sie zu verschlucken', () => {
    const result = parseIfc(
      ifc(
        [
          element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '20: Statische Verschraubung'),
          element(200, 'aaaaaaaaaaaaaaaaaaaaa2', '20: Statische Verschraubung', {
            type: 'IFCANNOTATION',
          }),
        ].join('\n'),
      ),
    );

    expect(result.components).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('IFCANNOTATION');
  });

  it('meldet Objekte ohne Arbeitsvorgang, statt sie stillschweigend zu übergehen', () => {
    const body = [
      element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '20: Statische Verschraubung'),
      // Eine Baugruppe ohne Arbeitsvorgang — in der echten Datei 136 davon.
      `#500=IFCELEMENTASSEMBLY('bbbbbbbbbbbbbbbbbbbbb1',#5,'SpatialDim_Group',$,$,#63,#64,$,$,$);`,
      `#501=IFCPROPERTYSINGLEVALUE('Objektname',$,IFCTEXT('Gruppe'),$);`,
      `#502=IFCPROPERTYSET('${guid('set', 502)}',#5,'AllplanAttributes',$,(#501));`,
      `#503=IFCRELDEFINESBYPROPERTIES('${guid('rel', 502)}',#5,$,$,(#500),#502);`,
    ].join('\n');

    const result = parseIfc(ifc(body));

    expect(result.components).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('kein Merkmal');
  });

  it('meldet dieselbe Nummer mit zwei Bezeichnungen', () => {
    const result = parseIfc(
      ifc(
        [
          element(100, 'aaaaaaaaaaaaaaaaaaaaa1', '20: Statische Verschraubung'),
          element(200, 'aaaaaaaaaaaaaaaaaaaaa2', '20: Etwas ganz anderes'),
        ].join('\n'),
      ),
    );

    expect(result.warnings.join(' ')).toContain('zwei Bezeichnungen');
  });

  it('weist eine Datei ohne FILE_SCHEMA ab', () => {
    expect(() => parseIfc('irgendein Text')).toThrow(IfcParseError);
  });

  it('weist eine Datei ohne auswertbaren Arbeitsvorgang ab', () => {
    const body = [
      `#100=IFCBUILDINGELEMENTPROXY('aaaaaaaaaaaaaaaaaaaaa1',#5,' ',$,$,#63,#64,$,$);`,
      `#101=IFCPROPERTYSINGLEVALUE('Objektname',$,IFCTEXT('Etwas'),$);`,
      `#102=IFCPROPERTYSET('${guid('set', 102)}',#5,'AllplanAttributes',$,(#101));`,
      `#103=IFCRELDEFINESBYPROPERTIES('${guid('rel', 102)}',#5,$,$,(#100),#102);`,
    ].join('\n');

    expect(() => parseIfc(ifc(body))).toThrow(/Arbeitsvorgang/);
  });
});

describe('parseWorkStepLabel', () => {
  it.each([
    ['20: Statische Verschraubung', 20, 'Statische Verschraubung'],
    ['04: Modulboden', 4, 'Modulboden'],
    // Führende Null darf nicht als Oktal gelesen werden: 09 ist neun.
    ['09: Randdämmstreifen', 9, 'Randdämmstreifen'],
    ['210:Verladen', 210, 'Verladen'],
    ['  130 :  Küchen Montage  ', 130, 'Küchen Montage'],
  ])('liest %s', (raw, number, title) => {
    expect(parseWorkStepLabel(raw)).toEqual({ stepNumber: number, title });
  });

  it.each(['Statische Verschraubung', '20:', '', ': Ohne Nummer'])('weist %s zurück', (raw) => {
    expect(parseWorkStepLabel(raw)).toBeNull();
  });
});

describe('decodeStepString', () => {
  it('löst die Fluchtfolgen von ISO-10303-21 auf', () => {
    expect(decodeStepString('K\\X\\FCchen Montage')).toBe('Küchen Montage');
    expect(decodeStepString('Randd\\X\\E4mmstreifen')).toBe('Randdämmstreifen');
    expect(decodeStepString('Fu\\X\\DFbodenheizung')).toBe('Fußbodenheizung');
    expect(decodeStepString('m\\X\\B3')).toBe('m³');
  });

  it('löst UTF-16-Folgen auf', () => {
    expect(decodeStepString('\\X2\\00FC00E4\\X0\\')).toBe('üä');
  });

  it('gibt einfache Zeichenketten unverändert zurück', () => {
    expect(decodeStepString('Statische Verschraubung')).toBe('Statische Verschraubung');
  });

  it('setzt verdoppelte Anführungszeichen zusammen', () => {
    expect(decodeStepString("Werkst''att")).toBe("Werkst'att");
  });
});
