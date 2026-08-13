import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Nachgereichte Unterlagen an einem Arbeitsschritt.
 *
 * Anlass ist eine Aussage aus der Fertigung: „Detailzeichnungen oder
 * Zulassungen werden nachträglich zugeordnet." Bis dahin ging das nicht — eine
 * Bindung verlangt eine Planrevision im Status DRAFT.
 *
 * Die Fälle prüfen vor allem, was die Beilage **nicht** tut. Dass sie
 * erscheint, sieht man sofort; dass sie den Plan nicht ändert, keine
 * Bindung erzeugt und an einem freigegebenen Plan überhaupt möglich ist,
 * sieht man nicht — und genau daran hängt, ob der Zuschnitt trägt.
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
let createDocument: typeof import('@/domain/documents/create-document').createDocument;
let createProductionPlan: typeof import('@/domain/production-plans/create-production-plan').createProductionPlan;
let addPlanStep: typeof import('@/domain/production-plans/plan-steps').addPlanStep;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let createProductionOrder: typeof import('@/domain/production-orders/create-production-order').createProductionOrder;
let transitionProductionOrderStatus: typeof import('@/domain/production-orders/create-production-order').transitionProductionOrderStatus;
let releaseProductionOrder: typeof import('@/domain/production-orders/release-production-order').releaseProductionOrder;
let addWorkStepSupplement: typeof import('@/domain/execution/work-step-supplements').addWorkStepSupplement;
let removeWorkStepSupplement: typeof import('@/domain/execution/work-step-supplements').removeWorkStepSupplement;
let bindDocumentToPlanStep: typeof import('@/domain/production-plans/plan-step-requirements').bindDocumentToPlanStep;
let assembleProductionDossier: typeof import('@/domain/dossier/assemble-dossier').assembleProductionDossier;

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
  process.env.RELEASE_TOKEN_SECRET = 'supplement-test-secret';

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createSite, createCustomer, createProduct } =
    await import('@/domain/master-data/master-data'));
  ({ createProject } = await import('@/domain/projects/create-project'));
  ({ createDocument } = await import('@/domain/documents/create-document'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ addPlanStep } = await import('@/domain/production-plans/plan-steps'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));
  ({ createProductionOrder, transitionProductionOrderStatus } =
    await import('@/domain/production-orders/create-production-order'));
  ({ releaseProductionOrder } =
    await import('@/domain/production-orders/release-production-order'));
  ({ addWorkStepSupplement, removeWorkStepSupplement } =
    await import('@/domain/execution/work-step-supplements'));
  ({ bindDocumentToPlanStep } = await import('@/domain/production-plans/plan-step-requirements'));
  ({ assembleProductionDossier } = await import('@/domain/dossier/assemble-dossier'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
});

interface Fixtures {
  projectLead: Actor;
  qualityManager: Actor;
  worker: Actor;
  projectId: string;
  orderId: string;
  stepInstanceId: string;
  planRevisionId: string;
  planStepId: string;
  releasedRevisionId: string;
  otherProjectRevisionId: string;
}

/**
 * Der Aufbau geht bis zur Schrittinstanz — der Plan ist **freigegeben**, was
 * genau der Zustand ist, in dem eine Bindung nicht mehr möglich wäre.
 *
 * Die Dokumentfreigabe wird hier direkt gesetzt und nicht über den
 * Freigabelauf gefahren: der ist in phase2 vollständig geprüft, verlangt
 * einen echten Upload und damit einen MinIO-Container, und ist nicht der
 * Gegenstand dieser Datei.
 */
async function seedFixtures(name: string): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `supp-${name}`);
  const ids = await seedDemoUsers(ownerClient, seeded, [
    { email: `admin-${name}@t.local`, displayName: 'Admin', roleCode: 'ADMIN' },
    { email: `pl-${name}@t.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: `qm-${name}@t.local`, displayName: 'QM', roleCode: 'QUALITY_MANAGER' },
    { email: `pm-${name}@t.local`, displayName: 'PM', roleCode: 'PRODUCTION_MANAGER' },
    { email: `w-${name}@t.local`, displayName: 'Worker', roleCode: 'WORKER' },
  ]);
  const org = seeded.organizationId;
  const actor = (prefix: string): Actor => ({
    userId: ids[`${prefix}-${name}@t.local`] ?? '',
    organizationId: org,
  });
  const admin = actor('admin');
  const projectLead = actor('pl');
  const qualityManager = actor('qm');
  const productionManager = actor('pm');
  const worker = actor('w');

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

  const { revision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `FP-${name}`,
    name: 'Plan',
  });
  const step = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
    stepNumber: 10,
    title: 'Modulzusammenbau',
  });

  const releasedRevisionId = await releasedDocument(
    projectLead,
    project.id,
    `ZG-${name}`,
    'Zulassung Verbinder',
  );

  // Ein zweites Projekt, um die Projektgrenze prüfen zu können.
  const otherProject = await createProject({
    actor: projectLead,
    projectNumber: `P2-${name}`,
    name: 'Fremdprojekt',
    siteId: site.id,
    customerId: customer.id,
  });
  const otherProjectRevisionId = await releasedDocument(
    projectLead,
    otherProject.id,
    `ZG2-${name}`,
    'Fremde Zeichnung',
  );

  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: revision.id,
  });
  await approveProductionPlan({ actor: qualityManager, productionPlanRevisionId: revision.id });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: revision.id });

  const order = await createProductionOrder({
    actor: productionManager,
    projectId: project.id,
    productId: product.id,
    productionPlanRevisionId: revision.id,
    orderNumber: `AUF-${name}`,
    quantity: 1,
  });
  let row = await ownerClient.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
  await transitionProductionOrderStatus({
    actor: productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: row.version,
  });
  row = await ownerClient.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
  await releaseProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    expectedVersion: row.version,
  });

  const instance = await ownerClient.workStepInstance.findFirstOrThrow({
    where: { productionOrderId: order.id },
  });

  return {
    projectLead,
    qualityManager,
    worker,
    projectId: project.id,
    orderId: order.id,
    stepInstanceId: instance.id,
    planRevisionId: revision.id,
    planStepId: step.id,
    releasedRevisionId,
    otherProjectRevisionId,
  };
}

async function releasedDocument(
  actor: Actor,
  projectId: string,
  documentNumber: string,
  title: string,
): Promise<string> {
  const { revision } = await createDocument({
    actor,
    projectId,
    documentNumber,
    title,
    firstRevision: { title: `${title} Rev. 01` },
  });
  await ownerClient.documentRevision.update({
    where: { id: revision.id },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
      releasedById: actor.userId,
      fileHashSha256: 'a'.repeat(64),
      storageKey: `documents/${revision.id}.pdf`,
    },
  });
  return revision.id;
}

describe('Nachgereichte Unterlagen', () => {
  /**
   * Der Fall, um dessentwillen es die Funktion gibt. Vorher scheitert der
   * bisherige Weg — das steht mit im Test, weil sonst niemand mehr sieht,
   * warum eine zweite Zuordnungsart existiert.
   */
  it('gelingt an einem freigegebenen Plan, an dem eine Bindung scheitert', async () => {
    const f = await seedFixtures('released');

    await expect(
      bindDocumentToPlanStep({
        actor: f.projectLead,
        productionPlanRevisionId: f.planRevisionId,
        planStepId: f.planStepId,
        documentRevisionId: f.releasedRevisionId,
      }),
    ).rejects.toThrow(/DRAFT/);

    const supplement = await addWorkStepSupplement({
      actor: f.projectLead,
      workStepInstanceId: f.stepInstanceId,
      documentRevisionId: f.releasedRevisionId,
      reason: 'Zulassung des Lieferanten lag bei Planfreigabe noch nicht vor',
    });

    expect(supplement.id).toBeTruthy();
  });

  /**
   * Der Kern des Zuschnitts: die Beilage darf den Plan nicht anfassen. Täte
   * sie es, bekäme ein zweiter Auftrag gegen dieselbe Revision sie
   * ungefragt mit — und der `documentSetHash` der Schrittfreigabe wäre
   * nachträglich ein anderer.
   */
  it('erzeugt keine Bindung am Planschritt', async () => {
    const f = await seedFixtures('noplan');
    await addWorkStepSupplement({
      actor: f.projectLead,
      workStepInstanceId: f.stepInstanceId,
      documentRevisionId: f.releasedRevisionId,
      reason: 'Nachweis nachgereicht',
    });

    const bindings = await ownerClient.stepDocumentBinding.findMany({
      where: { planStepId: f.planStepId },
    });
    expect(bindings).toHaveLength(0);
  });

  it('verlangt eine Begründung', async () => {
    const f = await seedFixtures('reason');
    await expect(
      addWorkStepSupplement({
        actor: f.projectLead,
        workStepInstanceId: f.stepInstanceId,
        documentRevisionId: f.releasedRevisionId,
        reason: '   ',
      }),
    ).rejects.toThrow(/begründen/);
  });

  it('nimmt nur freigegebene Revisionen', async () => {
    const f = await seedFixtures('draft');
    const { revision } = await createDocument({
      actor: f.projectLead,
      projectId: f.projectId,
      documentNumber: 'ZG-ENTWURF',
      title: 'Noch im Entwurf',
      firstRevision: { title: 'Rev. 01' },
    });

    await expect(
      addWorkStepSupplement({
        actor: f.projectLead,
        workStepInstanceId: f.stepInstanceId,
        documentRevisionId: revision.id,
        reason: 'Versehentlich zu früh',
      }),
    ).rejects.toThrow(/freigegebene/);
  });

  /**
   * RLS trennt Mandanten, nicht Projekte. Ohne diese Prüfung wäre die
   * Beilage der einzige Weg, ein fremdes Dokument in eine Akte zu bekommen.
   */
  it('lässt kein Dokument aus einem anderen Projekt zu', async () => {
    const f = await seedFixtures('foreign');
    await expect(
      addWorkStepSupplement({
        actor: f.projectLead,
        workStepInstanceId: f.stepInstanceId,
        documentRevisionId: f.otherProjectRevisionId,
        reason: 'Falsches Projekt',
      }),
    ).rejects.toThrow(/nicht zum Projekt/);
  });

  it('weist dieselbe Revision am selben Schritt kein zweites Mal an', async () => {
    const f = await seedFixtures('twice');
    const add = () =>
      addWorkStepSupplement({
        actor: f.qualityManager,
        workStepInstanceId: f.stepInstanceId,
        documentRevisionId: f.releasedRevisionId,
        reason: 'Zulassung nachgereicht',
      });

    await add();
    await expect(add()).rejects.toThrow(/liegt diesem Schritt bereits bei/);
  });

  it('lässt einen Werker nicht nachreichen', async () => {
    const f = await seedFixtures('authz');
    await expect(
      addWorkStepSupplement({
        actor: f.worker,
        workStepInstanceId: f.stepInstanceId,
        documentRevisionId: f.releasedRevisionId,
        reason: 'Unbefugt',
      }),
    ).rejects.toThrow();
  });

  it('schreibt Beilegen und Entfernen mit beiden Begründungen in den Audit-Trail', async () => {
    const f = await seedFixtures('audit');
    const supplement = await addWorkStepSupplement({
      actor: f.qualityManager,
      workStepInstanceId: f.stepInstanceId,
      documentRevisionId: f.releasedRevisionId,
      reason: 'Zulassung kam vom Lieferanten nach',
    });
    await removeWorkStepSupplement({
      actor: f.qualityManager,
      supplementId: supplement.id,
      reason: 'Falsche Revision erwischt',
    });

    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: f.stepInstanceId },
      orderBy: { createdAt: 'asc' },
    });
    const added = events.find((e) => e.eventType === 'work_step.supplement_added');
    const removed = events.find((e) => e.eventType === 'work_step.supplement_removed');

    expect((added?.newValues as Record<string, unknown>)?.reason).toBe(
      'Zulassung kam vom Lieferanten nach',
    );
    // Die Zeile ist weg, der Vorgang bleibt — mit BEIDEN Begründungen.
    expect((removed?.previousValues as Record<string, unknown>)?.addedReason).toBe(
      'Zulassung kam vom Lieferanten nach',
    );
    expect((removed?.newValues as Record<string, unknown>)?.removedReason).toBe(
      'Falsche Revision erwischt',
    );
    expect(
      await ownerClient.workStepSupplement.findFirst({ where: { id: supplement.id } }),
    ).toBeNull();
  });

  /**
   * Der Weg in die Produktionsakte. Zwei Dinge werden geprüft, die
   * auseinanderfallen können: dass die Beilage **in der Akte** unter den
   * Unterlagen steht, und dass ihre **Datei** in die Nachweisliste kommt.
   * Eine Akte, die eine Unterlage aufführt, deren Datei das Archiv nicht
   * enthält, wäre genau die Lücke, gegen die Abnahmeszenario F steht.
   *
   * Ebenso geprüft: sie landet **nicht** unter `documents`. Dort stehen die
   * verbindlichen Bindungen, und die Trennung ist der ganze Zweck.
   */
  it('erscheint in der Produktionsakte getrennt von den verbindlichen Unterlagen', async () => {
    const f = await seedFixtures('dossier');
    await addWorkStepSupplement({
      actor: f.qualityManager,
      workStepInstanceId: f.stepInstanceId,
      documentRevisionId: f.releasedRevisionId,
      reason: 'Zulassung traf nach Fertigungsbeginn ein',
    });

    const dossier = await assembleProductionDossier(f.qualityManager, f.orderId);

    expect(dossier.supplements).toHaveLength(1);
    expect(dossier.supplements[0]).toMatchObject({
      revisionNumber: '01',
      stepNumber: 10,
      reason: 'Zulassung traf nach Fertigungsbeginn ein',
    });
    expect(dossier.documents).toHaveLength(0);

    const evidence = dossier.generation.evidenceFiles.filter((file) => file.kind === 'SUPPLEMENT');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.storageKey).toBe(dossier.supplements[0]!.storageKey);
  });
});
