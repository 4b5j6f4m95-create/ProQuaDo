import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

// Real PostgreSQL + real MinIO (both via Testcontainers), real migrations,
// real domain services — no mocks. See docs/09_TEST_PYRAMID.md "Ebene 3".

let pgContainer: StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let ownerClient: PrismaClient;

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;

let createProject: typeof import('@/domain/projects/create-project').createProject;
let updateProjectDetails: typeof import('@/domain/projects/update-project').updateProjectDetails;
let transitionProjectStatus: typeof import('@/domain/projects/update-project').transitionProjectStatus;
let getProject: typeof import('@/domain/projects/project-queries').getProject;

let createDocument: typeof import('@/domain/documents/create-document').createDocument;
let createDocumentRevision: typeof import('@/domain/documents/create-document').createDocumentRevision;
let requestDocumentUploadUrl: typeof import('@/domain/documents/document-upload').requestDocumentUploadUrl;
let completeDocumentUpload: typeof import('@/domain/documents/document-upload').completeDocumentUpload;
let submitDocumentRevisionForReview: typeof import('@/domain/documents/document-review-workflow').submitDocumentRevisionForReview;
let approveDocumentRevision: typeof import('@/domain/documents/document-review-workflow').approveDocumentRevision;
let releaseDocumentRevision: typeof import('@/domain/documents/document-review-workflow').releaseDocumentRevision;
let getReleasedRevision: typeof import('@/domain/documents/document-queries').getReleasedRevision;

let createProductionPlan: typeof import('@/domain/production-plans/create-production-plan').createProductionPlan;
let addPlanStep: typeof import('@/domain/production-plans/plan-steps').addPlanStep;
let addPlanStepDependency: typeof import('@/domain/production-plans/plan-steps').addPlanStepDependency;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let bindDocumentToPlanStep: typeof import('@/domain/production-plans/plan-step-requirements').bindDocumentToPlanStep;
let unbindDocumentFromPlanStep: typeof import('@/domain/production-plans/plan-step-requirements').unbindDocumentFromPlanStep;
let getProductionPlanRevision: typeof import('@/domain/production-plans/plan-queries').getProductionPlanRevision;
let listBindableDocumentRevisions: typeof import('@/domain/production-plans/plan-queries').listBindableDocumentRevisions;

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

  minioContainer = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'testuser', MINIO_ROOT_PASSWORD: 'testpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const minioEndpoint = `http://${minioContainer.getHost()}:${minioContainer.getMappedPort(9000)}`;
  process.env.S3_ENDPOINT = minioEndpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = 'test-documents';
  process.env.S3_ACCESS_KEY_ID = 'testuser';
  process.env.S3_SECRET_ACCESS_KEY = 'testpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  // Explicit: getMalwareScanner() warns when nothing is configured, and the
  // tests are not the place to rehearse that warning (see malware-scan.ts).
  process.env.MALWARE_SCANNER = 'stub';

  const bootstrapS3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testuser', secretAccessKey: 'testpassword' },
  });
  await bootstrapS3.send(new CreateBucketCommand({ Bucket: 'test-documents' }));

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createProject } = await import('@/domain/projects/create-project'));
  ({ updateProjectDetails, transitionProjectStatus } =
    await import('@/domain/projects/update-project'));
  ({ getProject } = await import('@/domain/projects/project-queries'));
  ({ createDocument, createDocumentRevision } = await import('@/domain/documents/create-document'));
  ({ requestDocumentUploadUrl, completeDocumentUpload } =
    await import('@/domain/documents/document-upload'));
  ({ submitDocumentRevisionForReview, approveDocumentRevision, releaseDocumentRevision } =
    await import('@/domain/documents/document-review-workflow'));
  ({ getReleasedRevision } = await import('@/domain/documents/document-queries'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ bindDocumentToPlanStep, unbindDocumentFromPlanStep } =
    await import('@/domain/production-plans/plan-step-requirements'));
  ({ getProductionPlanRevision, listBindableDocumentRevisions } =
    await import('@/domain/production-plans/plan-queries'));
  ({ addPlanStep, addPlanStepDependency } = await import('@/domain/production-plans/plan-steps'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));

  ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
}, 180_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
  await minioContainer.stop();
});

/** Seeds an org with WORKER/PROJECT_LEAD/QUALITY_MANAGER users plus a
 * customer/site/project/product fixture set — everything the Phase 2
 * services need as foreign-key targets. */
async function seedFixtures(orgName: string) {
  const seeded = await seedOrganizationRbac(ownerClient, orgName);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `worker-${orgName}@test.local`, displayName: 'Worker', roleCode: 'WORKER' },
    { email: `pl-${orgName}@test.local`, displayName: 'PL', roleCode: 'PROJECT_LEAD' },
    { email: `qm-${orgName}@test.local`, displayName: 'QM', roleCode: 'QUALITY_MANAGER' },
  ]);

  const site = await ownerClient.site.create({
    data: {
      organizationId: seeded.organizationId,
      code: `SITE-${randomUUID().slice(0, 8)}`,
      name: 'Werk 1',
    },
  });
  const customer = await ownerClient.customer.create({
    data: {
      organizationId: seeded.organizationId,
      customerNumber: `CUST-${randomUUID().slice(0, 8)}`,
      name: 'Testkunde GmbH',
    },
  });
  const project = await ownerClient.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: `PROJ-${randomUUID().slice(0, 8)}`,
      name: 'Testprojekt',
      customerId: customer.id,
      createdById: userIds[`pl-${orgName}@test.local`]!,
    },
  });
  const product = await ownerClient.product.create({
    data: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: `PROD-${randomUUID().slice(0, 8)}`,
      name: 'Testprodukt',
    },
  });

  return {
    organizationId: seeded.organizationId,
    worker: {
      userId: userIds[`worker-${orgName}@test.local`]!,
      organizationId: seeded.organizationId,
    },
    projectLead: {
      userId: userIds[`pl-${orgName}@test.local`]!,
      organizationId: seeded.organizationId,
    },
    qualityManager: {
      userId: userIds[`qm-${orgName}@test.local`]!,
      organizationId: seeded.organizationId,
    },
    projectId: project.id,
    productId: product.id,
  };
}

async function uploadAndCompleteRevision(
  actor: { userId: string; organizationId: string },
  documentRevisionId: string,
  content = 'Testzeichnung Inhalt',
) {
  const buffer = Buffer.from(content);
  const expectedHash = createHash('sha256').update(buffer).digest('hex');

  const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
    actor,
    documentRevisionId,
    mimeType: 'text/plain',
  });
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': 'text/plain' },
  });
  expect(putResponse.status).toBe(200);

  return completeDocumentUpload({
    actor,
    documentRevisionId,
    storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: expectedHash,
  });
}

describe('Document revision workflow (DRAFT → IN_REVIEW → APPROVED → RELEASED)', () => {
  it('full happy path: only the RELEASED revision is authoritative, superseded ones stay readable', async () => {
    const fx = await seedFixtures('doc-happy');

    const { document, revision: rev1 } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Gehäusedeckel',
      firstRevision: { title: 'Gehäusedeckel Rev. 01' },
    });

    await uploadAndCompleteRevision(fx.projectLead, rev1.id);
    await submitDocumentRevisionForReview({ actor: fx.projectLead, documentRevisionId: rev1.id });
    await approveDocumentRevision({ actor: fx.qualityManager, documentRevisionId: rev1.id });
    const released1 = await releaseDocumentRevision({
      actor: fx.qualityManager,
      documentRevisionId: rev1.id,
    });
    expect(released1.status).toBe('RELEASED');

    const currentlyReleased = await getReleasedRevision(fx.worker, document.id);
    expect(currentlyReleased?.id).toBe(rev1.id);

    // A second revision releases — rev1 must become SUPERSEDED, never deleted.
    const rev2 = await createDocumentRevision({
      actor: fx.projectLead,
      documentId: document.id,
      title: 'Gehäusedeckel Rev. 02',
      changeReason: 'Bohrungsdurchmesser angepasst',
    });
    await uploadAndCompleteRevision(fx.projectLead, rev2.id, 'Andere Zeichnung Inhalt');
    await submitDocumentRevisionForReview({ actor: fx.projectLead, documentRevisionId: rev2.id });
    await approveDocumentRevision({ actor: fx.qualityManager, documentRevisionId: rev2.id });
    await releaseDocumentRevision({ actor: fx.qualityManager, documentRevisionId: rev2.id });

    const stillCurrentlyReleased = await getReleasedRevision(fx.worker, document.id);
    expect(stillCurrentlyReleased?.id).toBe(rev2.id);

    const rev1AfterSupersede = await ownerClient.documentRevision.findUniqueOrThrow({
      where: { id: rev1.id },
    });
    expect(rev1AfterSupersede.status).toBe('SUPERSEDED');
    // Historical fact preserved, not deleted (Geschäftsgrundsatz 5).
    expect(rev1AfterSupersede.title).toBe('Gehäusedeckel Rev. 01');
  });

  it('rejects submitting for review before the file is uploaded', async () => {
    const fx = await seedFixtures('doc-no-upload');
    const { revision } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Ohne Datei',
      firstRevision: { title: 'Rev 01' },
    });

    await expect(
      submitDocumentRevisionForReview({ actor: fx.projectLead, documentRevisionId: revision.id }),
    ).rejects.toThrow(/vollständig hochgeladen/);
  });

  it('rejects completeUpload when the declared hash does not match the actual content', async () => {
    const fx = await seedFixtures('doc-hash-mismatch');
    const { revision } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Falscher Hash',
      firstRevision: { title: 'Rev 01' },
    });

    const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
      actor: fx.projectLead,
      documentRevisionId: revision.id,
      mimeType: 'text/plain',
    });
    await fetch(uploadUrl, { method: 'PUT', body: Buffer.from('actual content') });

    await expect(
      completeDocumentUpload({
        actor: fx.projectLead,
        documentRevisionId: revision.id,
        storageKey,
        mimeType: 'text/plain',
        expectedHashSha256: 'a'.repeat(64), // deliberately wrong
      }),
    ).rejects.toThrow(/Hash/);
  });

  it('WORKER cannot approve or release a document revision (RBAC)', async () => {
    const fx = await seedFixtures('doc-rbac');
    const { revision } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'RBAC Test',
      firstRevision: { title: 'Rev 01' },
    });
    await uploadAndCompleteRevision(fx.projectLead, revision.id);
    await submitDocumentRevisionForReview({
      actor: fx.projectLead,
      documentRevisionId: revision.id,
    });

    await expect(
      approveDocumentRevision({ actor: fx.worker, documentRevisionId: revision.id }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('Production plan graph validation (Negativtest #15)', () => {
  it('rejects submitting a plan with a cyclic dependency for review', async () => {
    const fx = await seedFixtures('plan-cycle');
    const { revision } = await createProductionPlan({
      actor: fx.projectLead,
      projectId: fx.projectId,
      productId: fx.productId,
      planNumber: `PLAN-${randomUUID().slice(0, 8)}`,
      name: 'Zyklischer Plan',
    });

    const stepA = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      stepNumber: 1,
      title: 'Schritt A',
    });
    const stepB = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      stepNumber: 2,
      title: 'Schritt B',
    });
    const stepC = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      stepNumber: 3,
      title: 'Schritt C',
    });

    await addPlanStepDependency({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      predecessorStepId: stepA.id,
      dependentStepId: stepB.id,
    });
    await addPlanStepDependency({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      predecessorStepId: stepB.id,
      dependentStepId: stepC.id,
    });
    // Closes the cycle: C depends on B depends on A depends on C.
    await addPlanStepDependency({
      actor: fx.projectLead,
      productionPlanRevisionId: revision.id,
      predecessorStepId: stepC.id,
      dependentStepId: stepA.id,
    });

    await expect(
      submitProductionPlanForReview({
        actor: fx.projectLead,
        productionPlanRevisionId: revision.id,
      }),
    ).rejects.toThrow(/zyklische Abhängigkeit/);

    const unchanged = await ownerClient.productionPlanRevision.findUniqueOrThrow({
      where: { id: revision.id },
    });
    expect(unchanged.status).toBe('DRAFT');
  });

  it('accepts and releases an acyclic plan, auto-superseding the prior release', async () => {
    const fx = await seedFixtures('plan-happy');
    const { plan, revision: rev1 } = await createProductionPlan({
      actor: fx.projectLead,
      projectId: fx.projectId,
      productId: fx.productId,
      planNumber: `PLAN-${randomUUID().slice(0, 8)}`,
      name: 'Gültiger Plan',
    });

    const step1 = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: rev1.id,
      stepNumber: 1,
      title: 'Materialbereitstellung',
    });
    const step2 = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: rev1.id,
      stepNumber: 2,
      title: 'Montage',
    });
    await addPlanStepDependency({
      actor: fx.projectLead,
      productionPlanRevisionId: rev1.id,
      predecessorStepId: step1.id,
      dependentStepId: step2.id,
    });

    await submitProductionPlanForReview({
      actor: fx.projectLead,
      productionPlanRevisionId: rev1.id,
    });
    await approveProductionPlan({ actor: fx.qualityManager, productionPlanRevisionId: rev1.id });
    const released1 = await releaseProductionPlan({
      actor: fx.projectLead,
      productionPlanRevisionId: rev1.id,
    });
    expect(released1.status).toBe('RELEASED');

    // New revision, released again — old one must become SUPERSEDED.
    const rev2 = await ownerClient.productionPlanRevision.create({
      data: {
        organizationId: fx.organizationId,
        productionPlanId: plan.id,
        revisionNumber: '02',
        status: 'DRAFT',
        createdById: fx.projectLead.userId,
        priorRevisionId: rev1.id,
      },
    });
    await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: rev2.id,
      stepNumber: 1,
      title: 'Materialbereitstellung (angepasst)',
    });
    await submitProductionPlanForReview({
      actor: fx.projectLead,
      productionPlanRevisionId: rev2.id,
    });
    await approveProductionPlan({ actor: fx.qualityManager, productionPlanRevisionId: rev2.id });
    await releaseProductionPlan({ actor: fx.projectLead, productionPlanRevisionId: rev2.id });

    const rev1AfterSupersede = await ownerClient.productionPlanRevision.findUniqueOrThrow({
      where: { id: rev1.id },
    });
    expect(rev1AfterSupersede.status).toBe('SUPERSEDED');
  });

  it('rejects submitting a plan with zero steps', async () => {
    const fx = await seedFixtures('plan-empty');
    const { revision } = await createProductionPlan({
      actor: fx.projectLead,
      projectId: fx.projectId,
      productId: fx.productId,
      planNumber: `PLAN-${randomUUID().slice(0, 8)}`,
      name: 'Leerer Plan',
    });

    await expect(
      submitProductionPlanForReview({
        actor: fx.projectLead,
        productionPlanRevisionId: revision.id,
      }),
    ).rejects.toThrow(/ohne Arbeitsschritte/);
  });
});

describe('Project status machine + optimistic locking', () => {
  it('valid transition succeeds; invalid transition is rejected', async () => {
    const fx = await seedFixtures('project-status');
    const project = await createProject({
      actor: fx.projectLead,
      siteId: (await ownerClient.project.findFirstOrThrow({ where: { id: fx.projectId } })).siteId,
      projectNumber: `PROJ-${randomUUID().slice(0, 8)}`,
      name: 'Statustest',
      customerId: (await ownerClient.project.findFirstOrThrow({ where: { id: fx.projectId } }))
        .customerId,
    });
    expect(project.status).toBe('DRAFT');

    const active = await transitionProjectStatus({
      actor: fx.projectLead,
      projectId: project.id,
      toStatus: 'ACTIVE',
      expectedVersion: project.version,
    });
    expect(active.status).toBe('ACTIVE');

    await expect(
      transitionProjectStatus({
        actor: fx.projectLead,
        projectId: project.id,
        toStatus: 'DRAFT',
        expectedVersion: active.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('rejects an update against a stale version (concurrent edit conflict)', async () => {
    const fx = await seedFixtures('project-version');
    const projectRow = await ownerClient.project.findFirstOrThrow({ where: { id: fx.projectId } });
    const project = await createProject({
      actor: fx.projectLead,
      siteId: projectRow.siteId,
      projectNumber: `PROJ-${randomUUID().slice(0, 8)}`,
      name: 'Versionstest',
      customerId: projectRow.customerId,
    });

    await updateProjectDetails({
      actor: fx.projectLead,
      projectId: project.id,
      expectedVersion: project.version,
      name: 'Erste Änderung',
    });

    await expect(
      updateProjectDetails({
        actor: fx.projectLead,
        projectId: project.id,
        expectedVersion: project.version, // stale — already incremented above
        name: 'Zweite Änderung (Konflikt)',
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_VERSION_CONFLICT' });
  });
});

describe('Tenant isolation for Phase 2 entities (ADR-006)', () => {
  it('a user cannot read a project belonging to a different organization, even knowing its ID', async () => {
    const fxA = await seedFixtures('iso-a');
    const fxB = await seedFixtures('iso-b');

    const projectRowB = await ownerClient.project.findFirstOrThrow({
      where: { id: fxB.projectId },
    });
    const projectInOrgB = await createProject({
      actor: fxB.projectLead,
      siteId: projectRowB.siteId,
      projectNumber: `PROJ-${randomUUID().slice(0, 8)}`,
      name: 'Projekt in Org B',
      customerId: projectRowB.customerId,
    });

    await expect(
      getProject(
        { userId: fxA.projectLead.userId, organizationId: fxA.organizationId },
        projectInOrgB.id,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * Step-document binding — docs/10 lists it under Phase 2, the model arrived
 * there, the service in Phase 5, and the planning screen only in Phase 7.
 * Until then Abnahmeszenario C was defined entirely in terms of these
 * bindings and could not be produced from the application at all.
 *
 * These tests cover what the screen actually needs from the domain: the list
 * of choices it may offer, and the two operations behind its buttons.
 */
describe('Schritt-Dokumentbindung', () => {
  async function bindableFixture(name: string) {
    const fx = await seedFixtures(name);

    const { document, revision: draft } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Fertigungszeichnung',
      firstRevision: { title: 'Fertigungszeichnung Rev. 01' },
    });
    await uploadAndCompleteRevision(fx.projectLead, draft.id);
    await submitDocumentRevisionForReview({
      actor: fx.projectLead,
      documentRevisionId: draft.id,
    });
    await approveDocumentRevision({ actor: fx.qualityManager, documentRevisionId: draft.id });
    const released = await releaseDocumentRevision({
      actor: fx.qualityManager,
      documentRevisionId: draft.id,
    });

    const { revision: planRevision } = await createProductionPlan({
      actor: fx.projectLead,
      projectId: fx.projectId,
      productId: fx.productId,
      planNumber: `PLAN-${randomUUID().slice(0, 8)}`,
      name: 'Plan mit Bindung',
    });
    const step = await addPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: planRevision.id,
      stepNumber: 1,
      title: 'Montage nach Zeichnung',
    });

    return { fx, document, released, planRevision, step };
  }

  it('offers only released revisions of the plan project as choices', async () => {
    const { fx, released, planRevision } = await bindableFixture('binding-choices');

    // A second document in the same project that never got released — the
    // usual state of a project mid-flight, and the one the screen must not
    // present as bindable.
    const { revision: unreleased } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Entwurf, noch nicht freigegeben',
      firstRevision: { title: 'Entwurf Rev. 01' },
    });

    const choices = await listBindableDocumentRevisions(fx.projectLead, fx.projectId);
    const ids = choices.map((c) => c.id);
    expect(ids).toContain(released.id);
    expect(ids).not.toContain(unreleased.id);

    // And nothing from a different project leaks into the list.
    const other = await seedFixtures('binding-choices-other');
    const foreign = await listBindableDocumentRevisions(other.projectLead, other.projectId);
    expect(foreign.map((c) => c.id)).not.toContain(released.id);
    expect(planRevision.status).toBe('DRAFT');
  });

  it('binds and unbinds, and the plan query shows the current state', async () => {
    const { fx, released, planRevision, step } = await bindableFixture('binding-roundtrip');

    const binding = await bindDocumentToPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: planRevision.id,
      planStepId: step.id,
      documentRevisionId: released.id,
      pageNumber: 3,
      markerLabel: 'Detail B',
    });

    const withBinding = await getProductionPlanRevision(fx.projectLead, planRevision.id);
    expect(withBinding.steps[0]!.documentBindings).toHaveLength(1);
    expect(withBinding.steps[0]!.documentBindings[0]!.pageNumber).toBe(3);
    expect(withBinding.steps[0]!.documentBindings[0]!.documentRevision.revisionNumber).toBe(
      released.revisionNumber,
    );

    await unbindDocumentFromPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: planRevision.id,
      planStepId: step.id,
      bindingId: binding.id,
    });

    const afterRemoval = await getProductionPlanRevision(fx.projectLead, planRevision.id);
    expect(afterRemoval.steps[0]!.documentBindings).toHaveLength(0);

    // The removal is itself reconstructible — a binding that vanished without
    // a trace would be exactly what an audit asks about.
    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: binding.id, eventType: 'step_document_binding.removed' },
    });
    expect(events).toHaveLength(1);
  });

  it('refuses to bind the same revision twice', async () => {
    const { fx, released, planRevision, step } = await bindableFixture('binding-duplicate');

    const bind = () =>
      bindDocumentToPlanStep({
        actor: fx.projectLead,
        productionPlanRevisionId: planRevision.id,
        planStepId: step.id,
        documentRevisionId: released.id,
      });

    await bind();
    // Not cosmetic: hashIdSet in release-work-step.ts hashes the sorted list
    // of bound revision ids, so a duplicate would change documentSetHash for
    // an unchanged document set and a release token would disagree with the
    // plan it was minted from.
    await expect(bind()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const bindings = await ownerClient.stepDocumentBinding.count({
      where: { planStepId: step.id },
    });
    expect(bindings).toBe(1);
  });

  it('refuses to bind anything that is not released', async () => {
    const { fx, planRevision, step } = await bindableFixture('binding-unreleased');
    const { revision: draft } = await createDocument({
      actor: fx.projectLead,
      projectId: fx.projectId,
      documentNumber: `DOC-${randomUUID().slice(0, 8)}`,
      title: 'Noch im Entwurf',
      firstRevision: { title: 'Noch im Entwurf Rev. 01' },
    });

    // Geschäftsgrundsatz 6: an unreviewed drawing must never become binding
    // for production.
    await expect(
      bindDocumentToPlanStep({
        actor: fx.projectLead,
        productionPlanRevisionId: planRevision.id,
        planStepId: step.id,
        documentRevisionId: draft.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('stops accepting changes once the plan leaves DRAFT', async () => {
    const { fx, released, planRevision, step } = await bindableFixture('binding-frozen');

    const binding = await bindDocumentToPlanStep({
      actor: fx.projectLead,
      productionPlanRevisionId: planRevision.id,
      planStepId: step.id,
      documentRevisionId: released.id,
    });
    await submitProductionPlanForReview({
      actor: fx.projectLead,
      productionPlanRevisionId: planRevision.id,
    });

    // The binding is part of what was reviewed. Removing it afterwards would
    // change what a released plan demands without a new revision.
    await expect(
      unbindDocumentFromPlanStep({
        actor: fx.projectLead,
        productionPlanRevisionId: planRevision.id,
        planStepId: step.id,
        bindingId: binding.id,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
