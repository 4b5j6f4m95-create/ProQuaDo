import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * IFC-Import: aus einem Gebäudemodell wird ein Fertigungsplan.
 *
 * Die Fälle sind danach ausgesucht, was schiefgehen würde, ohne dass es
 * jemand merkt. Dass 24 Schritte entstehen, sieht man sofort; dass sie in der
 * richtigen Reihenfolge verkettet sind, dass jeder eine Bestätigung verlangt
 * und dass der Plan **nicht** freigegeben ist, sieht man nicht — und genau
 * daran hängt, ob das Ergebnis in der Halle das tut, was es soll.
 */

let pgContainer: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createSite: typeof import('@/domain/master-data/master-data').createSite;
let createCustomer: typeof import('@/domain/master-data/master-data').createCustomer;
let createProduct: typeof import('@/domain/master-data/master-data').createProduct;
let createProject: typeof import('@/domain/projects/create-project').createProject;
let importIfcPlan: typeof import('@/domain/production-plans/import-ifc-plan').importIfcPlan;

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = pgContainer.getHost();
  const port = pgContainer.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl = `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;
  process.env.SERVER_NODE_ID = 'integration-test';

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createSite, createCustomer, createProduct } =
    await import('@/domain/master-data/master-data'));
  ({ createProject } = await import('@/domain/projects/create-project'));
  ({ importIfcPlan } = await import('@/domain/production-plans/import-ifc-plan'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
});

// ── Testdatei ────────────────────────────────────────────────
// Aufbau und Schreibweise wie im echten Export (Allplan, IFC2X3), auf drei
// Arbeitsvorgänge und vier Bauteile gekürzt.

function guid(prefix: string, id: number): string {
  return (prefix + String(id)).padEnd(22, '0').slice(0, 22);
}

function element(id: number, arbeitsvorgang: string, bauteilId: string): string {
  const set = id + 10;
  return [
    `#${id}=IFCBUILDINGELEMENTPROXY('${guid('el', id)}',#5,' ',$,$,#63,#64,$,$);`,
    `#${id + 1}=IFCPROPERTYSINGLEVALUE('Arbeitsvorgang',$,IFCTEXT('${arbeitsvorgang}'),$);`,
    `#${id + 2}=IFCPROPERTYSINGLEVALUE('Allright_Bauteil_ID',$,IFCTEXT('${bauteilId}'),$);`,
    `#${id + 3}=IFCPROPERTYSINGLEVALUE('RAUMNUMMER',$,IFCTEXT('A08.4/A08.b'),$);`,
    `#${set}=IFCPROPERTYSET('${guid('ps', set)}',#5,'AllplanAttributes',$,(#${id + 1},#${id + 2},#${id + 3}));`,
    `#${set + 1}=IFCRELDEFINESBYPROPERTIES('${guid('rd', set)}',#5,$,$,(#${id}),#${set});`,
  ].join('\n');
}

function sampleIfc(): Buffer {
  const body = [
    element(100, '20: Statische Verschraubung', 'B-0001'),
    element(200, '20: Statische Verschraubung', 'B-0002'),
    element(300, '130: K\\X\\FCchen Montage', 'B-0003'),
    element(400, '04: Modulboden', 'B-0004'),
  ].join('\n');

  return Buffer.from(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('no view'),'2;1');",
      "FILE_NAME('Modul.ifc','2026-08-11T11:30:46',('Wolf'),('No Org',''),'ODA SDAI 25.4','','mwo');",
      "FILE_SCHEMA(('IFC2X3'));",
      'ENDSEC;',
      'DATA;',
      body,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
    'latin1',
  );
}

interface Fixtures {
  projectLead: Actor;
  worker: Actor;
  projectId: string;
  productId: string;
}

async function seedFixtures(name: string): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `ifc-${name}`);
  const ids = await seedDemoUsers(ownerClient, seeded, [
    { email: `admin-${name}@t.local`, displayName: 'Admin', roleCode: 'ADMIN' },
    { email: `pl-${name}@t.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: `w-${name}@t.local`, displayName: 'Worker', roleCode: 'WORKER' },
  ]);
  const org = seeded.organizationId;
  const admin: Actor = { userId: ids[`admin-${name}@t.local`] ?? '', organizationId: org };
  const projectLead: Actor = { userId: ids[`pl-${name}@t.local`] ?? '', organizationId: org };
  const worker: Actor = { userId: ids[`w-${name}@t.local`] ?? '', organizationId: org };

  const site = await createSite({ actor: admin, code: `S-${name}`, name: 'Werk' });
  const customer = await createCustomer({
    actor: admin,
    customerNumber: `K-${name}`,
    name: 'Kunde',
  });
  const project = await createProject({
    actor: projectLead,
    projectNumber: `P-${name}`,
    name: 'Modulbau',
    siteId: site.id,
    customerId: customer.id,
  });
  const product = await createProduct({
    actor: projectLead,
    projectId: project.id,
    productNumber: `PR-${name}`,
    name: 'Raummodul',
  });

  return { projectLead, worker, projectId: project.id, productId: product.id };
}

async function doImport(f: Fixtures, planNumber: string, content = sampleIfc()) {
  return importIfcPlan({
    actor: f.projectLead,
    projectId: f.projectId,
    productId: f.productId,
    planNumber,
    name: 'Fertigungsstraße Modul',
    fileName: 'Modul.ifc',
    content,
    storageKey: `ifc/test/${planNumber}.ifc`,
  });
}

describe('IFC-Import', () => {
  it('erzeugt die Arbeitsschritte in der Reihenfolge der Fertigungsstraße', async () => {
    const f = await seedFixtures('order');
    const result = await doImport(f, 'FP-IFC-1');

    expect(result.stepCount).toBe(3);
    expect(result.componentCount).toBe(4);

    const steps = await ownerClient.planStep.findMany({
      where: { productionPlanRevisionId: result.revisionId },
      orderBy: { stepNumber: 'asc' },
    });

    // Die Nummern aus der Datei bleiben erhalten — 4, 20, 130 und nicht 1, 2, 3.
    // Unter diesen Nummern kennt die Halle ihre Vorgänge.
    expect(steps.map((s) => s.stepNumber)).toEqual([4, 20, 130]);
    expect(steps.map((s) => s.title)).toEqual([
      'Modulboden',
      'Statische Verschraubung',
      'Küchen Montage',
    ]);
  });

  it('verlangt an jedem Schritt eine Bestätigung des Ausführenden', async () => {
    const f = await seedFixtures('sig');
    const result = await doImport(f, 'FP-IFC-2');

    const steps = await ownerClient.planStep.findMany({
      where: { productionPlanRevisionId: result.revisionId },
    });

    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s.signatureRequired)).toBe(true);
  });

  it('verkettet die Schritte, sodass keiner vorgezogen werden kann', async () => {
    const f = await seedFixtures('chain');
    const result = await doImport(f, 'FP-IFC-3');

    const steps = await ownerClient.planStep.findMany({
      where: { productionPlanRevisionId: result.revisionId },
      orderBy: { stepNumber: 'asc' },
      select: { id: true, stepNumber: true },
    });
    const dependencies = await ownerClient.planStepDependency.findMany({
      where: { dependentStepId: { in: steps.map((s) => s.id) } },
    });

    expect(dependencies).toHaveLength(2);
    const numberOf = new Map(steps.map((s) => [s.id, s.stepNumber]));
    const edges = dependencies
      .map((d) => `${numberOf.get(d.predecessorStepId)}→${numberOf.get(d.dependentStepId)}`)
      .sort();
    expect(edges).toEqual(['20→130', '4→20']);
    expect(dependencies.every((d) => d.dependencyType === 'FINISH_TO_START')).toBe(true);
  });

  /**
   * Der Fall, der den Zweck des Imports entscheidet. Eine Datei aus einem
   * Planungsprogramm ist eine Behauptung über die Fertigung; erst die
   * Genehmigung macht daraus eine Anweisung. Ein Import, der freigegebene
   * Schritte erzeugte, hätte die Prüfung nicht beschleunigt, sondern
   * abgeschafft.
   */
  it('legt den Plan als Entwurf an und gibt nichts frei', async () => {
    const f = await seedFixtures('draft');
    const result = await doImport(f, 'FP-IFC-4');

    const revision = await ownerClient.productionPlanRevision.findUniqueOrThrow({
      where: { id: result.revisionId },
    });

    expect(revision.status).toBe('DRAFT');
    expect(revision.releasedAt).toBeNull();
    expect(revision.releasedById).toBeNull();
  });

  it('speichert die Bauteile am Schritt, in dem sie verbaut werden', async () => {
    const f = await seedFixtures('components');
    const result = await doImport(f, 'FP-IFC-5');

    const verschraubung = await ownerClient.planStep.findFirstOrThrow({
      where: { productionPlanRevisionId: result.revisionId, stepNumber: 20 },
    });
    const components = await ownerClient.ifcComponent.findMany({
      where: { planStepId: verschraubung.id },
      orderBy: { componentNumber: 'asc' },
    });

    expect(components.map((c) => c.componentNumber)).toEqual(['B-0001', 'B-0002']);
    expect(components[0]?.ifcType).toBe('IFCBUILDINGELEMENTPROXY');
  });

  it('hält Herkunft und Hash der Datei fest', async () => {
    const f = await seedFixtures('provenance');
    const result = await doImport(f, 'FP-IFC-6');

    const record = await ownerClient.ifcImport.findUniqueOrThrow({
      where: { id: result.importId },
    });

    expect(record.ifcSchema).toBe('IFC2X3');
    expect(record.moduleNumbers).toEqual(['A08.4/A08.b']);
    expect(record.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.stepCount).toBe(3);
    expect(record.componentCount).toBe(4);
  });

  it('weist dieselbe Datei ein zweites Mal ab, statt den Plan zu verdoppeln', async () => {
    const f = await seedFixtures('duplicate');
    await doImport(f, 'FP-IFC-7');

    await expect(doImport(f, 'FP-IFC-8')).rejects.toThrow(/bereits importiert/);

    const plans = await ownerClient.productionPlan.findMany({
      where: { projectId: f.projectId },
    });
    expect(plans).toHaveLength(1);
  });

  /**
   * Je Datei ein eigener Plan heißt: Plannummern werden im Dutzend vergeben.
   * Ohne diese Prüfung antwortet der Weg mit „Ein unerwarteter Fehler ist
   * aufgetreten" — P2002 nennt mit dem Treiber-Adapter von Prisma 7 nicht
   * einmal das verletzte Feld.
   */
  it('nennt eine bereits vergebene Plannummer beim Namen, statt 500 zu antworten', async () => {
    const f = await seedFixtures('planno');
    await doImport(f, 'FP-IFC-DUP');

    // Andere Datei, damit nicht die Hash-Prüfung zuerst greift.
    const other = Buffer.from(sampleIfc().toString('latin1').replace('B-0001', 'B-9999'), 'latin1');

    await expect(doImport(f, 'FP-IFC-DUP', other)).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      status: 409,
    });
  });

  it('schreibt den Import samt Warnungen in den Audit-Trail', async () => {
    const f = await seedFixtures('audit');
    const result = await doImport(f, 'FP-IFC-9');

    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: result.planId, eventType: 'ifc_import.executed' },
    });

    expect(events).toHaveLength(1);
    const values = events[0]?.newValues as Record<string, unknown> | null;
    expect(values?.fileName).toBe('Modul.ifc');
    expect(values?.stepCount).toBe(3);
    expect(values).toHaveProperty('warnings');
  });

  /**
   * Der wahrscheinlichere Fehlerfall ist nicht die kaputte Datei, sondern die
   * **gültige ohne das Merkmal** — ein Modell, das der Planer exportiert hat,
   * ohne die Arbeitsvorgänge zu pflegen. Ohne Abweisung entstünde daraus ein
   * Plan ohne Schritte, den niemand bestätigen müsste.
   */
  it('weist ein gültiges Modell ohne gepflegte Arbeitsvorgänge ab', async () => {
    const f = await seedFixtures('nosteps');
    const body = [
      `#100=IFCBUILDINGELEMENTPROXY('${guid('el', 100)}',#5,' ',$,$,#63,#64,$,$);`,
      `#101=IFCPROPERTYSINGLEVALUE('Objektname',$,IFCTEXT('Wand'),$);`,
      `#110=IFCPROPERTYSET('${guid('ps', 110)}',#5,'AllplanAttributes',$,(#101));`,
      `#111=IFCRELDEFINESBYPROPERTIES('${guid('rd', 110)}',#5,$,$,(#100),#110);`,
    ].join('\n');
    const content = Buffer.from(
      [
        'ISO-10303-21;',
        "FILE_SCHEMA(('IFC2X3'));",
        'ENDSEC;',
        'DATA;',
        body,
        'ENDSEC;',
        'END-ISO-10303-21;',
      ].join('\n'),
      'latin1',
    );

    await expect(doImport(f, 'FP-IFC-10', content)).rejects.toThrow(/Arbeitsvorgang/);

    // Und es bleibt nichts zurück: kein halb angelegter Plan.
    const plans = await ownerClient.productionPlan.findMany({ where: { projectId: f.projectId } });
    expect(plans).toHaveLength(0);
  });

  it('lässt niemanden importieren, der die Berechtigung nicht hat', async () => {
    const f = await seedFixtures('authz');

    await expect(
      importIfcPlan({
        actor: f.worker,
        projectId: f.projectId,
        productId: f.productId,
        planNumber: 'FP-IFC-11',
        name: 'Unbefugt',
        fileName: 'Modul.ifc',
        content: sampleIfc(),
        storageKey: 'ifc/test/nope.ifc',
      }),
    ).rejects.toThrow();
  });
});
