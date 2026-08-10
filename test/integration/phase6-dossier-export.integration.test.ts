import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Phase 6 (Akte, Reporting) against real infrastructure.
//
// Abnahmeszenario F from MASTERPROMPT.md Kap. 22: "Auditor sucht eine
// Seriennummer und sieht mit Berechtigung lückenlos Auftrag, Plan-/
// Dokumentrevisionen, Schritte, Beteiligte, Zeiten, Fotos, Messwerte, NCR,
// Nacharbeit und Freigaben. Ein exportiertes ZIP-Manifest bestätigt die
// enthaltenen Dateien per Hash."
//
// The manifest assertion is the point: the test reads the ZIP back and
// checks that every declared hash matches the bytes actually in the archive.

let pgContainer: StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let createProductionPlan: typeof import('@/domain/production-plans/create-production-plan').createProductionPlan;
let addPlanStep: typeof import('@/domain/production-plans/plan-steps').addPlanStep;
let addPlanStepDependency: typeof import('@/domain/production-plans/plan-steps').addPlanStepDependency;
let addChecklistItem: typeof import('@/domain/production-plans/plan-step-requirements').addChecklistItem;
let addInspectionCharacteristic: typeof import('@/domain/production-plans/plan-step-requirements').addInspectionCharacteristic;
let addPhotoRequirement: typeof import('@/domain/production-plans/plan-step-requirements').addPhotoRequirement;
let bindDocumentToPlanStep: typeof import('@/domain/production-plans/plan-step-requirements').bindDocumentToPlanStep;
let submitProductionPlanForReview: typeof import('@/domain/production-plans/plan-review-workflow').submitProductionPlanForReview;
let approveProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').approveProductionPlan;
let releaseProductionPlan: typeof import('@/domain/production-plans/plan-review-workflow').releaseProductionPlan;
let createProductionOrder: typeof import('@/domain/production-orders/create-production-order').createProductionOrder;
let transitionProductionOrderStatus: typeof import('@/domain/production-orders/create-production-order').transitionProductionOrderStatus;
let releaseProductionOrder: typeof import('@/domain/production-orders/release-production-order').releaseProductionOrder;
let assignProductionOrder: typeof import('@/domain/production-orders/assign-production-order').assignProductionOrder;
let createDocument: typeof import('@/domain/documents/create-document').createDocument;
let requestDocumentUploadUrl: typeof import('@/domain/documents/document-upload').requestDocumentUploadUrl;
let completeDocumentUpload: typeof import('@/domain/documents/document-upload').completeDocumentUpload;
let submitDocumentRevisionForReview: typeof import('@/domain/documents/document-review-workflow').submitDocumentRevisionForReview;
let approveDocumentRevision: typeof import('@/domain/documents/document-review-workflow').approveDocumentRevision;
let releaseDocumentRevision: typeof import('@/domain/documents/document-review-workflow').releaseDocumentRevision;
let startWorkStep: typeof import('@/domain/execution/start-work-step').startWorkStep;
let recordChecklistResponse: typeof import('@/domain/execution/capture-evidence').recordChecklistResponse;
let recordMeasurementResult: typeof import('@/domain/execution/capture-evidence').recordMeasurementResult;
let requestPhotoUploadUrl: typeof import('@/domain/execution/photo-evidence').requestPhotoUploadUrl;
let completePhotoUpload: typeof import('@/domain/execution/photo-evidence').completePhotoUpload;
let submitWorkStepCompletion: typeof import('@/domain/execution/complete-work-step').submitWorkStepCompletion;
let raiseNonConformance: typeof import('@/domain/quality/raise-non-conformance').raiseNonConformance;

let assembleProductionDossier: typeof import('@/domain/dossier/assemble-dossier').assembleProductionDossier;
let decideProductRelease: typeof import('@/domain/quality/product-release').decideProductRelease;
let getProductRelease: typeof import('@/domain/quality/product-release').getProductRelease;
let exportProductionDossier: typeof import('@/domain/dossier/export-dossier').exportProductionDossier;
let searchTraceability: typeof import('@/domain/dossier/search').searchTraceability;
let findOrdersBySerialNumber: typeof import('@/domain/dossier/search').findOrdersBySerialNumber;
let getDashboard: typeof import('@/domain/dashboard/dashboard-queries').getDashboard;
let listNotifications: typeof import('@/domain/notifications/notification-queries').listNotifications;
let getObjectBytes: typeof import('@/lib/storage/object-storage').getObjectBytes;

const PIN = '4711';

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
  process.env.RELEASE_TOKEN_SECRET = 'integration-test-release-token-secret';
  process.env.SERVER_NODE_ID = 'integration-test';

  minioContainer = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'testuser', MINIO_ROOT_PASSWORD: 'testpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const minioEndpoint = `http://${minioContainer.getHost()}:${minioContainer.getMappedPort(9000)}`;
  process.env.S3_ENDPOINT = minioEndpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = 'test-dossier';
  process.env.S3_ACCESS_KEY_ID = 'testuser';
  process.env.S3_SECRET_ACCESS_KEY = 'testpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  // Explicit: getMalwareScanner() warns when nothing is configured, and the
  // tests are not the place to rehearse that warning (see malware-scan.ts).
  process.env.MALWARE_SCANNER = 'stub';

  await new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testuser', secretAccessKey: 'testpassword' },
  }).send(new CreateBucketCommand({ Bucket: 'test-dossier' }));

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ createProductionPlan } = await import('@/domain/production-plans/create-production-plan'));
  ({ addPlanStep, addPlanStepDependency } = await import('@/domain/production-plans/plan-steps'));
  ({ addChecklistItem, addInspectionCharacteristic, addPhotoRequirement, bindDocumentToPlanStep } =
    await import('@/domain/production-plans/plan-step-requirements'));
  ({ submitProductionPlanForReview, approveProductionPlan, releaseProductionPlan } =
    await import('@/domain/production-plans/plan-review-workflow'));
  ({ createProductionOrder, transitionProductionOrderStatus } =
    await import('@/domain/production-orders/create-production-order'));
  ({ releaseProductionOrder } =
    await import('@/domain/production-orders/release-production-order'));
  ({ assignProductionOrder } = await import('@/domain/production-orders/assign-production-order'));
  ({ createDocument } = await import('@/domain/documents/create-document'));
  ({ requestDocumentUploadUrl, completeDocumentUpload } =
    await import('@/domain/documents/document-upload'));
  ({ submitDocumentRevisionForReview, approveDocumentRevision, releaseDocumentRevision } =
    await import('@/domain/documents/document-review-workflow'));
  ({ startWorkStep } = await import('@/domain/execution/start-work-step'));
  ({ recordChecklistResponse, recordMeasurementResult } =
    await import('@/domain/execution/capture-evidence'));
  ({ requestPhotoUploadUrl, completePhotoUpload } =
    await import('@/domain/execution/photo-evidence'));
  ({ submitWorkStepCompletion } = await import('@/domain/execution/complete-work-step'));
  ({ raiseNonConformance } = await import('@/domain/quality/raise-non-conformance'));

  ({ assembleProductionDossier } = await import('@/domain/dossier/assemble-dossier'));
  ({ decideProductRelease, getProductRelease } = await import('@/domain/quality/product-release'));
  ({ exportProductionDossier } = await import('@/domain/dossier/export-dossier'));
  ({ searchTraceability, findOrdersBySerialNumber } = await import('@/domain/dossier/search'));
  ({ getDashboard } = await import('@/domain/dashboard/dashboard-queries'));
  ({ listNotifications } = await import('@/domain/notifications/notification-queries'));
  ({ getObjectBytes } = await import('@/lib/storage/object-storage'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
  await minioContainer.stop();
});

interface Fixtures {
  organizationId: string;
  worker: Actor;
  projectLead: Actor;
  qualityManager: Actor;
  productionManager: Actor;
  auditor: Actor;
  orderId: string;
  orderNumber: string;
  serialNumber: string;
  step1InstanceId: string;
  step2InstanceId: string;
  checklistItemId: string;
  characteristicId: string;
  photoRequirementId: string;
  documentNumber: string;
}

function short(): string {
  return randomUUID().slice(0, 8);
}

/** Seeds a full order and runs step 1 to completion with checklist, photo and
 *  measurement, so the dossier has something to prove. */
async function seedExecutedOrder(name: string): Promise<Fixtures> {
  const seeded = await seedOrganizationRbac(ownerClient, `phase6-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    {
      email: `w-${name}@t.local`,
      displayName: 'Meike Klein',
      roleCode: 'WORKER',
      confirmationPin: PIN,
    },
    {
      email: `pl-${name}@t.local`,
      displayName: 'Paul Lang',
      roleCode: 'PROJECT_LEAD',
      confirmationPin: PIN,
    },
    {
      email: `qm-${name}@t.local`,
      displayName: 'Quirin Mayr',
      roleCode: 'QUALITY_MANAGER',
      confirmationPin: PIN,
    },
    { email: `pm-${name}@t.local`, displayName: 'Pia Meier', roleCode: 'PRODUCTION_MANAGER' },
    { email: `au-${name}@t.local`, displayName: 'Anna Uhl', roleCode: 'AUDITOR' },
  ]);
  const actor = (prefix: string): Actor => ({
    userId: userIds[`${prefix}-${name}@t.local`]!,
    organizationId: seeded.organizationId,
  });
  const worker = actor('w');
  const projectLead = actor('pl');
  const qualityManager = actor('qm');
  const productionManager = actor('pm');
  const auditor = actor('au');

  const site = await ownerClient.site.create({
    data: { organizationId: seeded.organizationId, code: `S-${short()}`, name: 'Werk Nord' },
  });
  const customer = await ownerClient.customer.create({
    data: {
      organizationId: seeded.organizationId,
      customerNumber: `C-${short()}`,
      name: 'Kunde AG',
    },
  });
  const project = await ownerClient.project.create({
    data: {
      organizationId: seeded.organizationId,
      siteId: site.id,
      projectNumber: `P-${short()}`,
      name: 'Gehäuseserie',
      customerId: customer.id,
      createdById: projectLead.userId,
      status: 'ACTIVE',
    },
  });
  const product = await ownerClient.product.create({
    data: {
      organizationId: seeded.organizationId,
      projectId: project.id,
      productNumber: `PR-${short()}`,
      name: 'Gehäuse A',
    },
  });

  // A released drawing, bound to step 1 — section 4 of the dossier.
  const documentNumber = `P-102-${short()}`;
  const { revision } = await createDocument({
    actor: projectLead,
    projectId: project.id,
    documentNumber,
    title: 'Gehäusezeichnung',
    firstRevision: { title: 'Gehäusezeichnung Rev. 04' },
  });
  await uploadAndRelease(projectLead, qualityManager, revision.id, 'Zeichnungsinhalt Rev04');

  const { revision: planRevision } = await createProductionPlan({
    actor: projectLead,
    projectId: project.id,
    productId: product.id,
    planNumber: `PL-${short()}`,
    name: 'Fertigungsplan Gehäuse A',
  });
  const step1 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 1,
    title: 'Gehäuse fräsen',
    instruction: 'Nach Zeichnung fräsen und entgraten.',
  });
  const step2 = await addPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    stepNumber: 2,
    title: 'Endprüfung',
  });
  await addPlanStepDependency({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    predecessorStepId: step1.id,
    dependentStepId: step2.id,
  });
  const checklistItem = await addChecklistItem({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    itemNumber: 1,
    text: 'Sichtprüfung Oberfläche',
  });
  const characteristic = await addInspectionCharacteristic({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    characteristicNumber: 1,
    name: 'Spaltmaß',
    nominalValue: '2.0',
    lowerLimit: '1.8',
    upperLimit: '2.2',
    unit: 'mm',
  });
  const photoRequirement = await addPhotoRequirement({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    category: 'TYPENSCHILD',
    minCount: 1,
  });
  await bindDocumentToPlanStep({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
    planStepId: step1.id,
    documentRevisionId: revision.id,
  });

  await submitProductionPlanForReview({
    actor: projectLead,
    productionPlanRevisionId: planRevision.id,
  });
  await approveProductionPlan({ actor: qualityManager, productionPlanRevisionId: planRevision.id });
  await releaseProductionPlan({ actor: projectLead, productionPlanRevisionId: planRevision.id });

  const serialNumber = `SN-${short()}`;
  const orderNumber = `A-${short()}`;
  const order = await createProductionOrder({
    actor: productionManager,
    projectId: project.id,
    productId: product.id,
    productionPlanRevisionId: planRevision.id,
    orderNumber,
    serialNumber,
  });
  const planned = await transitionProductionOrderStatus({
    actor: productionManager,
    productionOrderId: order.id,
    toStatus: 'PLANNED',
    expectedVersion: order.version,
  });
  await releaseProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    expectedVersion: planned.version,
  });
  await assignProductionOrder({
    actor: productionManager,
    productionOrderId: order.id,
    userId: worker.userId,
  });

  const instances = await ownerClient.workStepInstance.findMany({
    where: { productionOrderId: order.id },
    orderBy: { stepNumber: 'asc' },
  });
  const step1InstanceId = instances[0]!.id;

  // Execute step 1 fully: checklist, measurement, photo, confirmation.
  await startWorkStep({ actor: worker, workStepInstanceId: step1InstanceId });
  await recordChecklistResponse({
    actor: worker,
    workStepInstanceId: step1InstanceId,
    checklistItemId: checklistItem.id,
    response: 'OK',
    comment: 'Oberfläche ohne Befund',
  });
  await recordMeasurementResult({
    actor: worker,
    workStepInstanceId: step1InstanceId,
    inspectionCharacteristicId: characteristic.id,
    measuredValue: '2.05',
  });
  await uploadPhoto(worker, step1InstanceId, photoRequirement.id);
  await submitWorkStepCompletion({
    actor: worker,
    workStepInstanceId: step1InstanceId,
    idempotencyKey: randomUUID(),
    confirmation: { signatureMethod: 'PIN', pin: PIN },
    usedDocumentRevisionIds: [revision.id],
  });

  return {
    organizationId: seeded.organizationId,
    worker,
    projectLead,
    qualityManager,
    productionManager,
    auditor,
    orderId: order.id,
    orderNumber,
    serialNumber,
    step1InstanceId,
    step2InstanceId: instances[1]!.id,
    checklistItemId: checklistItem.id,
    characteristicId: characteristic.id,
    photoRequirementId: photoRequirement.id,
    documentNumber,
  };
}

async function uploadAndRelease(
  projectLead: Actor,
  qualityManager: Actor,
  documentRevisionId: string,
  content: string,
): Promise<void> {
  const buffer = Buffer.from(content);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { uploadUrl, storageKey } = await requestDocumentUploadUrl({
    actor: projectLead,
    documentRevisionId,
    mimeType: 'text/plain',
  });
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) throw new Error(`Upload fehlgeschlagen: ${response.status}`);
  await completeDocumentUpload({
    actor: projectLead,
    documentRevisionId,
    storageKey,
    mimeType: 'text/plain',
    expectedHashSha256: hash,
  });
  await submitDocumentRevisionForReview({ actor: projectLead, documentRevisionId });
  await approveDocumentRevision({ actor: qualityManager, documentRevisionId });
  await releaseDocumentRevision({ actor: qualityManager, documentRevisionId });
}

async function uploadPhoto(
  actor: Actor,
  workStepInstanceId: string,
  photoRequirementId: string,
): Promise<void> {
  const buffer = Buffer.from(`Foto ${randomUUID()}`);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const { uploadUrl, photoEvidenceId } = await requestPhotoUploadUrl({
    actor,
    workStepInstanceId,
    mimeType: 'image/jpeg',
    photoRequirementId,
  });
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (!response.ok) throw new Error(`Fotoupload fehlgeschlagen: ${response.status}`);
  await completePhotoUpload({ actor, photoEvidenceId, expectedHashSha256: hash });
}

/** Minimal ZIP reader: walks the central directory and returns each entry's
 *  name and inflated bytes. Deliberately not a library — the test must check
 *  the archive independently of the code that produced it. */
function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  // End of central directory record: signature 0x06054b50, scanned from the
  // back because it is followed by a variable-length comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP-Endverzeichnis gefunden');

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Zentralverzeichnis beschädigt');
    const compressionMethod = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, compressionMethod === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────

describe('Abnahmeszenario F — Audit und Akte', () => {
  it('lets an auditor find a serial and read a gapless dossier', async () => {
    const fx = await seedExecutedOrder('scenario-f');

    // "Auditor sucht eine Seriennummer …"
    const hits = await searchTraceability({ actor: fx.auditor, q: fx.serialNumber });
    expect(hits.some((hit) => hit.type === 'ORDER' && hit.id === fx.orderId)).toBe(true);

    const bySerial = await findOrdersBySerialNumber(fx.auditor, fx.serialNumber);
    expect(bySerial.map((order) => order.id)).toContain(fx.orderId);

    // "… und sieht mit Berechtigung lückenlos …"
    const dossier = await assembleProductionDossier(fx.auditor, fx.orderId);

    expect(dossier.identification.serialNumber).toBe(fx.serialNumber);
    expect(dossier.context.customerName).toBe('Kunde AG');
    expect(dossier.planRevision.revisionNumber).toBeTruthy();
    expect(dossier.documents).toHaveLength(1);
    expect(dossier.documents[0]!.documentNumber).toBe(fx.documentNumber);
    expect(dossier.documents[0]!.boundToStepNumbers).toEqual([1]);

    const step1 = dossier.steps.find((step) => step.stepNumber === 1)!;
    expect(step1.status).toBe('COMPLETED');
    expect(step1.startedBy).toBe('Meike Klein');
    expect(step1.confirmations).toHaveLength(1);
    expect(step1.evidence.checklist[0]!.response).toBe('OK');
    expect(step1.evidence.measurements[0]!.measuredValue).toBe('2.05');
    // Limits as copied onto the result, not as the plan reads today.
    expect(step1.evidence.measurements[0]!.lowerLimit).toBe('1.8');
    expect(step1.evidence.measurements[0]!.isWithinTolerance).toBe(true);
    expect(step1.evidence.photos[0]!.uploadStatus).toBe('COMPLETED');
    expect(step1.evidence.photos[0]!.fileHashSha256).toMatch(/^[0-9a-f]{64}$/);

    expect(dossier.participants.some((p) => p.displayName === 'Meike Klein')).toBe(true);
    expect(dossier.auditTrail.length).toBeGreaterThan(0);
    expect(dossier.auditTrail.some((e) => e.eventType === 'work_step.completed')).toBe(true);

    // Step 2 is released but not done — the dossier says so rather than
    // implying the order is finished.
    expect(dossier.finalRelease.orderCompleted).toBe(false);
    expect(dossier.finalRelease.releasable).toBe(false);
  }, 240_000);

  it('exports a ZIP whose manifest confirms every contained file by hash', async () => {
    const fx = await seedExecutedOrder('manifest');

    const result = await exportProductionDossier({
      actor: fx.auditor,
      productionOrderId: fx.orderId,
      format: 'ZIP',
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.manifest).not.toBeNull();
    const manifest = result.manifest!;

    // The dossier PDF, the bound drawing and the photo.
    expect(manifest.summary.total).toBe(3);
    expect(manifest.summary.verified).toBe(3);
    expect(manifest.summary.mismatched).toBe(0);
    expect(manifest.summary.missing).toBe(0);
    expect(manifest.orderNumber).toBe(fx.orderNumber);
    expect(manifest.serialNumber).toBe(fx.serialNumber);
    expect(manifest.templateVersion).toBeTruthy();
    expect(manifest.dataAsOf).toBeTruthy();

    // Read the archive back and verify each entry independently of the code
    // that wrote it — this is the assertion Abnahmeszenario F actually makes.
    const zip = await getObjectBytes(result.storageKey);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(createHash('sha256').update(zip).digest('hex')).toBe(result.fileHashSha256);

    const entries = readZipEntries(zip);
    expect(entries.has('manifest.json')).toBe(true);

    const embedded = JSON.parse(entries.get('manifest.json')!.toString('utf8'));
    expect(embedded.summary).toEqual(manifest.summary);

    for (const entry of manifest.entries) {
      const bytes = entries.get(entry.path);
      expect(bytes).toBeDefined();
      expect(createHash('sha256').update(bytes!).digest('hex')).toBe(entry.actualSha256);
      expect(bytes!.byteLength).toBe(entry.sizeBytes);
      // Where the database recorded a hash at capture time, it must equal
      // what the archive now contains.
      if (entry.declaredSha256) {
        expect(entry.declaredSha256).toBe(entry.actualSha256);
      }
    }

    const pdfEntry = manifest.entries.find((entry) => entry.kind === 'DOSSIER_PDF')!;
    expect(entries.get(pdfEntry.path)!.subarray(0, 5).toString()).toBe('%PDF-');
  }, 240_000);

  it('records every export as an auditable job with its data-as-of moment', async () => {
    const fx = await seedExecutedOrder('audit-job');

    const pdf = await exportProductionDossier({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      format: 'PDF',
    });
    expect(pdf.format).toBe('PDF');
    expect(pdf.fileSizeBytes).toBeGreaterThan(0);

    const rows = await ownerClient.dossierExport.findMany({
      where: { productionDossier: { productionOrderId: fx.orderId } },
      include: { productionDossier: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('COMPLETED');
    expect(rows[0]!.requestedById).toBe(fx.qualityManager.userId);
    expect(rows[0]!.completedAt).not.toBeNull();
    expect(rows[0]!.productionDossier.templateVersion).toBeTruthy();
    expect(rows[0]!.productionDossier.dataAsOf.getTime()).toBeLessThanOrEqual(
      rows[0]!.productionDossier.generatedAt.getTime(),
    );

    const audit = await ownerClient.auditEvent.findMany({
      where: { eventType: 'dossier.exported', organizationId: fx.organizationId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(fx.qualityManager.userId);

    // Each generation is its own dossier with its own moment.
    await exportProductionDossier({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      format: 'ZIP',
    });
    const dossiers = await ownerClient.productionDossier.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { dossierNumber: 'asc' },
    });
    expect(dossiers).toHaveLength(2);
    expect(dossiers[0]!.dossierNumber).not.toBe(dossiers[1]!.dossierNumber);
  }, 240_000);

  it('refuses the dossier to somebody without the export permission', async () => {
    const fx = await seedExecutedOrder('permission');

    // A WORKER holds neither dossier.export nor the right to read the file.
    await expect(assembleProductionDossier(fx.worker, fx.orderId)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      exportProductionDossier({
        actor: fx.worker,
        productionOrderId: fx.orderId,
        format: 'ZIP',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  }, 240_000);

  it('does not leak another organization’s records into search or dossier', async () => {
    const mine = await seedExecutedOrder('tenant-mine');
    const theirs = await seedExecutedOrder('tenant-theirs');

    const hits = await searchTraceability({ actor: mine.auditor, q: theirs.serialNumber });
    expect(hits).toHaveLength(0);

    await expect(assembleProductionDossier(mine.auditor, theirs.orderId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 300_000);
});

describe('Dashboard und Benachrichtigungen', () => {
  it('never counts a locally completed step as progress (docs/07 B1)', async () => {
    const fx = await seedExecutedOrder('dashboard');

    // Step 2 is READY; force it into the offline in-between state the rule
    // is about.
    await ownerClient.workStepInstance.update({
      where: { id: fx.step2InstanceId },
      data: { status: 'COMPLETED_PENDING_SYNC' },
    });

    const dashboard = await getDashboard(fx.projectLead);
    const row = dashboard.orders.find((order) => order.productionOrderId === fx.orderId)!;

    expect(row.totalSteps).toBe(2);
    expect(row.completedSteps).toBe(1);
    expect(row.pendingSteps).toBe(1);
    // 50 %, not 100 %: the locally finished step is reported separately.
    expect(row.progressPercent).toBe(50);
  }, 240_000);

  it('turns a raised deviation into a notification for the people who can assess it', async () => {
    const fx = await seedExecutedOrder('notifications');

    await raiseNonConformance({
      actor: fx.worker,
      productionOrderId: fx.orderId,
      workStepInstanceId: fx.step1InstanceId,
      description: 'Kratzer auf der Oberfläche festgestellt',
      errorCategory: 'OBERFLAECHE',
      priority: 'MEDIUM',
    });

    // QM holds ncr.assess and is notified.
    const forQm = await listNotifications(fx.qualityManager, { includeRead: true });
    expect(forQm.some((n) => n.eventType === 'non_conformance.raised')).toBe(true);

    // The worker who reported it does not get an assessment task.
    const forWorker = await listNotifications(fx.worker, { includeRead: true });
    expect(forWorker.some((n) => n.eventType === 'non_conformance.raised')).toBe(false);
    // …but does get the release of the step they are assigned to.
    expect(forWorker.some((n) => n.eventType === 'work_step.released')).toBe(true);

    // Dispatch is idempotent: reading again creates nothing new.
    const before = await ownerClient.notification.count({
      where: { organizationId: fx.organizationId },
    });
    await listNotifications(fx.qualityManager, { includeRead: true });
    const after = await ownerClient.notification.count({
      where: { organizationId: fx.organizationId },
    });
    expect(after).toBe(before);
  }, 240_000);
});

/**
 * Produktfreigabe — Masterprompt Kap. 10 section 9.
 *
 * Until Phase 7 the dossier only added up whether anything was open and said
 * in as many words that the release itself was not recorded. These tests
 * cover the decision that now exists, and above all the two things it must
 * never become: derived from the data, and repeatable.
 */
describe('Produktfreigabe', () => {
  /** Finishes the second (requirement-free) step so the order reaches COMPLETED. */
  async function completeOrder(fx: Awaited<ReturnType<typeof seedExecutedOrder>>) {
    await startWorkStep({ actor: fx.worker, workStepInstanceId: fx.step2InstanceId });
    await submitWorkStepCompletion({
      actor: fx.worker,
      workStepInstanceId: fx.step2InstanceId,
      idempotencyKey: randomUUID(),
      confirmation: { signatureMethod: 'PIN', pin: PIN },
      usedDocumentRevisionIds: [],
    });
  }

  it('refuses a release while the order is unfinished, and names why', async () => {
    const fx = await seedExecutedOrder('release-blocked');

    // Step 2 is still open, so the order is not COMPLETED.
    await expect(
      decideProductRelease({
        actor: fx.qualityManager,
        productionOrderId: fx.orderId,
        decision: 'RELEASED',
        reason: 'Sieht gut aus',
        pin: PIN,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // A rejection stays available — refusing a product is exactly what one
    // does while something is wrong with it.
    const rejected = await decideProductRelease({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      decision: 'REJECTED',
      reason: 'Endprüfung nicht durchgeführt, Auftrag unvollständig.',
      pin: PIN,
    });
    expect(rejected.decision).toBe('REJECTED');
    expect(rejected.basis.orderStatus).not.toBe('COMPLETED');
  }, 240_000);

  it('records who released, when, why, and on what basis', async () => {
    const fx = await seedExecutedOrder('release-granted');
    await completeOrder(fx);

    const result = await decideProductRelease({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      decision: 'RELEASED',
      reason: 'Akte vollständig geprüft, alle Merkmale in Toleranz.',
      pin: PIN,
    });
    expect(result.decision).toBe('RELEASED');
    expect(result.basis.orderStatus).toBe('COMPLETED');
    expect(result.basis.openBlockingNonConformances).toBe(0);

    const dossier = await assembleProductionDossier(fx.auditor, fx.orderId);
    const decision = dossier.finalRelease.decision!;
    expect(decision.decision).toBe('RELEASED');
    expect(decision.decidedBy).toBe('Quirin Mayr');
    expect(decision.reason).toContain('Akte vollständig geprüft');
    expect(decision.signatureData).toMatch(/^[0-9a-f]{64}$/);
    // The dossier can now answer the question rather than explain why it
    // cannot.
    expect(dossier.finalRelease.releasable).toBe(true);

    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: fx.orderId, eventType: 'product_release.granted' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toContain('Akte vollständig geprüft');
  }, 240_000);

  it('keeps the basis as it stood, even after the data moves on', async () => {
    const fx = await seedExecutedOrder('release-basis');
    await completeOrder(fx);

    await decideProductRelease({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      decision: 'RELEASED',
      reason: 'Freigegeben ohne offene Punkte.',
      pin: PIN,
    });

    // Something happens afterwards that changes the live numbers.
    await raiseNonConformance({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      description: 'Nachträglich im Feld aufgefallen',
      priority: 'CRITICAL',
      reporterSuggestsBlocking: true,
    });

    const dossier = await assembleProductionDossier(fx.auditor, fx.orderId);
    // The live figure moved…
    expect(dossier.finalRelease.openBlockingNonConformances).toBeGreaterThan(0);
    // …the recorded grounds of the decision did not. Same reasoning as
    // copying tolerances onto a measurement result.
    expect(dossier.finalRelease.decision!.basis.openBlockingNonConformances).toBe(0);
  }, 240_000);

  it('refuses a second release, because withdrawing one is a recall', async () => {
    const fx = await seedExecutedOrder('release-once');
    await completeOrder(fx);

    const release = () =>
      decideProductRelease({
        actor: fx.qualityManager,
        productionOrderId: fx.orderId,
        decision: 'RELEASED',
        reason: 'Freigabe nach vollständiger Prüfung.',
        pin: PIN,
      });

    await release();
    await expect(release()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // And a rejection cannot quietly overturn a release either.
    await expect(
      decideProductRelease({
        actor: fx.qualityManager,
        productionOrderId: fx.orderId,
        decision: 'REJECTED',
        reason: 'Doch nicht.',
        pin: PIN,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const rows = await ownerClient.productRelease.count({
      where: { productionOrderId: fx.orderId },
    });
    expect(rows).toBe(1);
  }, 240_000);

  it('lets a rejection be followed by a release once the cause is gone', async () => {
    const fx = await seedExecutedOrder('release-after-reject');

    await decideProductRelease({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      decision: 'REJECTED',
      reason: 'Endprüfung fehlt.',
      pin: PIN,
    });
    await completeOrder(fx);
    const granted = await decideProductRelease({
      actor: fx.qualityManager,
      productionOrderId: fx.orderId,
      decision: 'RELEASED',
      reason: 'Endprüfung nachgeholt und bestanden.',
      pin: PIN,
    });
    expect(granted.decision).toBe('RELEASED');

    // The rejection stays readable — the history is not rewritten. The
    // decision in force is the latest one.
    const rows = await ownerClient.productRelease.findMany({
      where: { productionOrderId: fx.orderId },
      orderBy: { decidedAt: 'asc' },
    });
    expect(rows.map((r) => r.decision)).toEqual(['REJECTED', 'RELEASED']);
    const current = await getProductRelease(fx.qualityManager, fx.orderId);
    expect(current!.decision).toBe('RELEASED');
  }, 240_000);

  it('is not open to a worker, and not open without the right PIN', async () => {
    const fx = await seedExecutedOrder('release-authz');
    await completeOrder(fx);

    await expect(
      decideProductRelease({
        actor: fx.worker,
        productionOrderId: fx.orderId,
        decision: 'RELEASED',
        reason: 'Ich bin fertig.',
        pin: PIN,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      decideProductRelease({
        actor: fx.qualityManager,
        productionOrderId: fx.orderId,
        decision: 'RELEASED',
        reason: 'Freigabe.',
        pin: '0000',
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });

    // A reason is not optional — a decision without one is a signature on a
    // blank page.
    await expect(
      decideProductRelease({
        actor: fx.qualityManager,
        productionOrderId: fx.orderId,
        decision: 'RELEASED',
        reason: '   ',
        pin: PIN,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await getProductRelease(fx.qualityManager, fx.orderId)).toBeNull();
  }, 240_000);
});
