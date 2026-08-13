import { createHash } from 'node:crypto';
import archiver from 'archiver';
import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import {
  createPresignedDownloadUrl,
  getObjectBytes,
  putObjectBytes,
} from '@/lib/storage/object-storage';
import { logger } from '@/lib/logger';
import type { Actor } from '@/domain/shared/actor';
import {
  assembleProductionDossier,
  DOSSIER_TEMPLATE_VERSION,
  type ProductionDossierContent,
} from './assemble-dossier';
import { renderDossierPdf } from './render-dossier-pdf';

/**
 * Export of the production dossier — MASTERPROMPT.md Kap. 10: "Export als PDF
 * sowie ZIP mit Originalnachweisen und Manifest. Das Manifest enthält
 * Dateihashes, IDs und Revisionen. Jeder Export ist auditierbar und erhält
 * Erstellungszeit, Datenstand und Template-Version."
 *
 * The manifest is the point of Abnahmeszenario F: "Ein exportiertes
 * ZIP-Manifest bestätigt die enthaltenen Dateien per Hash." So the hash in
 * the manifest is the one this export COMPUTED over the bytes it actually
 * packed — never the hash the database happened to store. Those two agreeing
 * is the assertion being made; assuming it would be assuming the conclusion.
 *
 * When they disagree, the file still goes into the archive and the manifest
 * records `MISMATCH`. Removing it would hide a corruption an auditor has
 * every right to find.
 *
 * Generation is synchronous behind a job record — see ADR-007 for why there
 * is no queue, and for the size limit below.
 */

export const MANIFEST_VERSION = '1.0';

/** Beyond this the export is refused rather than left running — ADR-007's
 *  "harte Grenze als Schutz gegen den Fall, für den die Queue gedacht war". */
const MAX_EVIDENCE_FILES = 500;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export type ExportFormat = 'PDF' | 'ZIP';

export type ManifestEntryStatus = 'VERIFIED' | 'MISMATCH' | 'MISSING';

export interface ManifestEntry {
  path: string;
  kind: string;
  /** What the database recorded when the file was accepted. */
  declaredSha256: string | null;
  /** What this export computed over the bytes it packed. */
  actualSha256: string | null;
  sizeBytes: number | null;
  status: ManifestEntryStatus;
}

export interface DossierManifest {
  manifestVersion: string;
  templateVersion: string;
  dossierNumber: string;
  orderNumber: string;
  serialNumber: string | null;
  planRevision: string;
  documentRevisions: Array<{ documentNumber: string; revisionNumber: string; status: string }>;
  dataAsOf: string;
  generatedAt: string;
  generatedBy: string;
  entries: ManifestEntry[];
  summary: { total: number; verified: number; mismatched: number; missing: number };
}

export interface DossierExportResult {
  exportId: string;
  dossierId: string;
  dossierNumber: string;
  format: ExportFormat;
  status: string;
  storageKey: string;
  fileHashSha256: string;
  fileSizeBytes: number;
  manifest: DossierManifest | null;
  downloadUrl: string;
  downloadExpiresAt: Date;
}

export interface ExportDossierCommand {
  actor: Actor;
  productionOrderId: string;
  format: ExportFormat;
}

export async function exportProductionDossier(
  command: ExportDossierCommand,
): Promise<DossierExportResult> {
  await assertPermission(command.actor, 'dossier.export');

  const dossier = await assembleProductionDossier(command.actor, command.productionOrderId);

  if (command.format === 'ZIP') {
    assertExportableSize(dossier);
  }

  // The job record first (ADR-007): an export that dies mid-flight leaves a
  // PENDING row with its requester and timestamp rather than no trace.
  const { dossierId, dossierNumber, exportId } = await openExport(command, dossier);
  const numbered: ProductionDossierContent = {
    ...dossier,
    identification: { ...dossier.identification, dossierNumber },
  };

  try {
    const built = command.format === 'PDF' ? await buildPdf(numbered) : await buildZip(numbered);

    const storageKey =
      `${command.actor.organizationId}/dossier-exports/${dossierId}/` +
      `${dossierNumber}_${command.format}_${exportId.slice(0, 8)}.${command.format.toLowerCase()}`;

    await putObjectBytes({
      storageKey,
      body: built.bytes,
      mimeType: command.format === 'PDF' ? 'application/pdf' : 'application/zip',
    });

    const fileHash = createHash('sha256').update(built.bytes).digest('hex');
    const completed = await completeExport(command.actor, exportId, {
      storageKey,
      fileHashSha256: fileHash,
      fileSizeBytes: built.bytes.byteLength,
      manifest: built.manifest,
      entryCount: built.manifest?.entries.length ?? 0,
      dossierNumber,
      productionOrderId: command.productionOrderId,
      format: command.format,
    });

    const download = await createPresignedDownloadUrl({
      storageKey,
      downloadFileName: `${dossierNumber}.${command.format.toLowerCase()}`,
    });

    return {
      exportId,
      dossierId,
      dossierNumber,
      format: command.format,
      status: completed.status,
      storageKey,
      fileHashSha256: fileHash,
      fileSizeBytes: built.bytes.byteLength,
      manifest: built.manifest,
      downloadUrl: download.url,
      downloadExpiresAt: download.expiresAt,
    };
  } catch (error) {
    // Recorded in its own transaction and only then re-thrown — the same
    // rule as every other rejection in this codebase, for the same reason.
    await failExport(command.actor, exportId, error);
    throw error;
  }
}

function assertExportableSize(dossier: ProductionDossierContent): void {
  const files = dossier.generation.evidenceFiles.length;
  if (files > MAX_EVIDENCE_FILES) {
    throw new ValidationError(
      `Diese Akte enthält ${files} Nachweisdateien und überschreitet die Exportgrenze von ${MAX_EVIDENCE_FILES}. ` +
        'Bitte den Export auf Teilbereiche einschränken oder die asynchrone Erzeugung aktivieren (ADR-007).',
    );
  }
}

async function buildPdf(
  dossier: ProductionDossierContent,
): Promise<{ bytes: Buffer; manifest: null }> {
  return { bytes: await renderDossierPdf(dossier), manifest: null };
}

async function buildZip(
  dossier: ProductionDossierContent,
): Promise<{ bytes: Buffer; manifest: DossierManifest }> {
  const entries: ManifestEntry[] = [];
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // The rendered dossier itself is part of the archive and part of the
  // manifest: an auditor should be able to check the PDF they are reading
  // against the same list as every photo.
  const pdf = await renderDossierPdf(dossier);
  const pdfPath = `${dossier.identification.dossierNumber}.pdf`;
  archive.append(pdf, { name: pdfPath });
  entries.push({
    path: pdfPath,
    kind: 'DOSSIER_PDF',
    declaredSha256: null,
    actualSha256: createHash('sha256').update(pdf).digest('hex'),
    sizeBytes: pdf.byteLength,
    status: 'VERIFIED',
  });

  let totalBytes = pdf.byteLength;

  for (const file of dossier.generation.evidenceFiles) {
    const path = `nachweise/${folderFor(file.kind)}/${sanitize(file.label)}${extensionFor(file.storageKey)}`;

    let bytes: Buffer;
    try {
      bytes = await getObjectBytes(file.storageKey);
    } catch (error) {
      // A record that points at a file the store no longer has is exactly
      // the kind of gap an audit archive must surface rather than swallow.
      logger.warn(
        { err: error, storageKey: file.storageKey },
        'dossier export: evidence file could not be read',
      );
      entries.push({
        path,
        kind: file.kind,
        declaredSha256: file.declaredHashSha256,
        actualSha256: null,
        sizeBytes: null,
        status: 'MISSING',
      });
      continue;
    }

    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ValidationError(
        `Der Export überschreitet die Größengrenze von ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB (ADR-007).`,
      );
    }

    const actual = createHash('sha256').update(bytes).digest('hex');
    archive.append(bytes, { name: path });
    entries.push({
      path,
      kind: file.kind,
      declaredSha256: file.declaredHashSha256,
      actualSha256: actual,
      status:
        file.declaredHashSha256 === null
          ? 'VERIFIED'
          : file.declaredHashSha256 === actual
            ? 'VERIFIED'
            : 'MISMATCH',
      sizeBytes: bytes.byteLength,
    });
  }

  const manifest = buildManifest(dossier, entries);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  await archive.finalize();
  return { bytes: await finished, manifest };
}

function buildManifest(
  dossier: ProductionDossierContent,
  entries: ManifestEntry[],
): DossierManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    templateVersion: dossier.generation.templateVersion,
    dossierNumber: dossier.identification.dossierNumber,
    orderNumber: dossier.identification.orderNumber,
    serialNumber: dossier.identification.serialNumber,
    planRevision: `${dossier.planRevision.planNumber} Rev. ${dossier.planRevision.revisionNumber}`,
    documentRevisions: dossier.documents.map((document) => ({
      documentNumber: document.documentNumber,
      revisionNumber: document.revisionNumber,
      status: document.revisionStatus,
    })),
    dataAsOf: dossier.identification.dataAsOf.toISOString(),
    generatedAt: dossier.generation.generatedAt.toISOString(),
    generatedBy: dossier.generation.generatedBy,
    entries,
    summary: {
      total: entries.length,
      verified: entries.filter((e) => e.status === 'VERIFIED').length,
      mismatched: entries.filter((e) => e.status === 'MISMATCH').length,
      missing: entries.filter((e) => e.status === 'MISSING').length,
    },
  };
}

// ── persistence ──────────────────────────────────────────────

async function openExport(
  command: ExportDossierCommand,
  dossier: ProductionDossierContent,
): Promise<{ dossierId: string; dossierNumber: string; exportId: string }> {
  return withOrgContext(command.actor.organizationId, async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { id: command.productionOrderId },
      select: { id: true, orderNumber: true, serialNumber: true },
    });
    if (!order) throw new NotFoundError('Produktionsauftrag');

    // One dossier row per generation, not one per order: each carries its own
    // dataAsOf, and two exports taken a week apart are two distinct pieces of
    // evidence about two different moments.
    const sequence = await tx.productionDossier.count({
      where: { productionOrderId: order.id },
    });
    const dossierNumber = `AKTE-${order.orderNumber}-${String(sequence + 1).padStart(2, '0')}`;

    const record = await tx.productionDossier.create({
      data: {
        organizationId: command.actor.organizationId,
        productionOrderId: order.id,
        dossierNumber,
        serialNumber: order.serialNumber,
        templateVersion: DOSSIER_TEMPLATE_VERSION,
        dataAsOf: dossier.identification.dataAsOf,
        generatedById: command.actor.userId,
      },
      select: { id: true },
    });

    const exported = await tx.dossierExport.create({
      data: {
        organizationId: command.actor.organizationId,
        productionDossierId: record.id,
        format: command.format,
        status: 'PENDING',
        requestedById: command.actor.userId,
      },
      select: { id: true },
    });

    return { dossierId: record.id, dossierNumber, exportId: exported.id };
  });
}

async function completeExport(
  actor: Actor,
  exportId: string,
  result: {
    storageKey: string;
    fileHashSha256: string;
    fileSizeBytes: number;
    manifest: DossierManifest | null;
    entryCount: number;
    dossierNumber: string;
    productionOrderId: string;
    format: ExportFormat;
  },
) {
  return withOrgContext(actor.organizationId, async (tx) => {
    const updated = await tx.dossierExport.update({
      where: { id: exportId },
      data: {
        status: 'COMPLETED',
        storageKey: result.storageKey,
        fileHashSha256: result.fileHashSha256,
        fileSizeBytes: BigInt(result.fileSizeBytes),
        manifest: (result.manifest ?? undefined) as Prisma.InputJsonValue | undefined,
        entryCount: result.entryCount,
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // Masterprompt Kap. 10: "Jeder Export ist auditierbar." Reading a
    // production record is itself an event worth recording (docs/08 on
    // access to sensitive dossiers).
    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'dossier.exported',
      resourceType: 'dossier_export',
      resourceId: exportId,
      actorId: actor.userId,
      newValues: {
        dossierNumber: result.dossierNumber,
        productionOrderId: result.productionOrderId,
        format: result.format,
        fileHashSha256: result.fileHashSha256,
        entryCount: result.entryCount,
        mismatched: result.manifest?.summary.mismatched ?? 0,
        missing: result.manifest?.summary.missing ?? 0,
      },
      source: 'web',
    });

    return updated;
  });
}

async function failExport(actor: Actor, exportId: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  await withOrgContext(actor.organizationId, async (tx) => {
    await tx.dossierExport.update({
      where: { id: exportId },
      data: {
        status: 'FAILED',
        failureReason: reason.slice(0, 2000),
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });

    await writeAuditEvent(tx, {
      organizationId: actor.organizationId,
      eventType: 'dossier.export_failed',
      resourceType: 'dossier_export',
      resourceId: exportId,
      actorId: actor.userId,
      result: 'FAILURE',
      failureReason: reason.slice(0, 500),
      source: 'web',
    });
  });
}

export async function listDossierExports(actor: Actor, productionOrderId: string) {
  await assertPermission(actor, 'dossier.export');

  return withOrgContext(actor.organizationId, (tx) =>
    tx.dossierExport.findMany({
      where: { productionDossier: { productionOrderId } },
      orderBy: { requestedAt: 'desc' },
      include: {
        productionDossier: {
          select: { dossierNumber: true, dataAsOf: true, templateVersion: true },
        },
      },
    }),
  );
}

// ── helpers ──────────────────────────────────────────────────

function folderFor(kind: string): string {
  if (kind === 'DOCUMENT') return 'dokumente';
  // Eigener Ordner, nicht `dokumente/`: wer das Archiv ohne die Akte daneben
  // öffnet, muss verbindliche Unterlagen von Beilagen unterscheiden können.
  if (kind === 'SUPPLEMENT') return 'nachgereicht';
  if (kind === 'PHOTO') return 'fotos';
  return 'abweichungen';
}

function extensionFor(storageKey: string): string {
  const base = storageKey.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/** Archive paths must survive extraction on any filesystem, and must not be
 *  able to escape the archive root — a label is data, and data ending up in
 *  a path is where zip-slip comes from. */
function sanitize(label: string): string {
  return label
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
}
