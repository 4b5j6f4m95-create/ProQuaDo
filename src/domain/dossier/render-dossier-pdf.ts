import PDFDocument from 'pdfkit';
import type { ProductionDossierContent } from './assemble-dossier';

/**
 * Renders the dossier as a PDF, section by section, in the order
 * MASTERPROMPT.md Kap. 10 lists them.
 *
 * Two rules this layout follows throughout:
 *
 *  - Nothing is omitted because it is inconvenient. A superseded document
 *    revision, a failed photo upload, a step that was superseded by a repeat
 *    — all appear, labelled. A dossier that quietly dropped the awkward rows
 *    would be worse than useless in the audit it exists for.
 *  - Every value that was COPIED at capture time (tolerance limits, the
 *    revision an execution cited) is printed as captured, never re-derived
 *    from what the plan says today.
 */

const MARGIN = 48;
const TITLE_SIZE = 18;
const HEADING_SIZE = 12;
const BODY_SIZE = 9;

export async function renderDossierPdf(dossier: ProductionDossierContent): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `Produktionsakte ${dossier.identification.dossierNumber}`,
      Author: 'ProQuaDo',
      Subject: `Auftrag ${dossier.identification.orderNumber}`,
      CreationDate: dossier.generation.generatedAt,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  coverPage(doc, dossier);
  contextSection(doc, dossier);
  planAndDocumentsSection(doc, dossier);
  stepsSection(doc, dossier);
  qualitySection(doc, dossier);
  finalReleaseSection(doc, dossier);
  auditSection(doc, dossier);

  doc.end();
  return done;
}

type Doc = PDFKit.PDFDocument;

// 1. Deckblatt und eindeutige Identifikation
function coverPage(doc: Doc, dossier: ProductionDossierContent): void {
  const id = dossier.identification;

  doc.fontSize(TITLE_SIZE).font('Helvetica-Bold').text('Digitale Produktionsakte');
  doc.moveDown(0.3);
  doc.fontSize(HEADING_SIZE).font('Helvetica').text(id.dossierNumber);
  doc.moveDown(1.5);

  keyValues(doc, [
    ['Auftragsnummer', id.orderNumber],
    ['Seriennummer', id.serialNumber ?? '—'],
    ['Chargennummer', id.batchNumber ?? '—'],
    ['Produkt', `${dossier.context.productNumber} · ${dossier.context.productName}`],
    ['Projekt', `${dossier.context.projectNumber} · ${dossier.context.projectName}`],
  ]);

  doc.moveDown(1.5);
  doc.fontSize(BODY_SIZE).font('Helvetica-Oblique');
  doc.text(
    `Erzeugt am ${formatDateTime(dossier.generation.generatedAt)} durch ${dossier.generation.generatedBy}. ` +
      `Datenstand ${formatDateTime(id.dataAsOf)}. Vorlagenversion ${id.templateVersion}.`,
    { width: contentWidth(doc) },
  );
  doc.moveDown(0.5);
  doc.text(
    'Diese Akte wird bei jeder Erzeugung aus den Primärdaten abgeleitet. Sie enthält den ' +
      'tatsächlichen Herstellungsverlauf einschließlich Abweichungen, Sperren und Nacharbeiten.',
    { width: contentWidth(doc) },
  );
}

// 2. Projekt-, Kunden-, Auftrags- und Produktdaten
function contextSection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '2. Projekt, Kunde, Auftrag und Produkt');
  const c = dossier.context;
  keyValues(doc, [
    ['Kunde', c.customerName ? `${c.customerNumber ?? '—'} · ${c.customerName}` : '—'],
    ['Standort', `${c.siteCode} · ${c.siteName}`],
    ['Auftragsstatus', c.orderStatus],
    ['Menge', String(c.quantity)],
    ['Geplant', `${formatDate(c.plannedStartAt)} – ${formatDate(c.plannedEndAt)}`],
    ['Tatsächlich', `${formatDateTime(c.actualStartAt)} – ${formatDateTime(c.actualEndAt)}`],
  ]);
}

// 3. + 4. verwendete Fertigungsplanrevision und Dokumente
function planAndDocumentsSection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '3. Verwendete Fertigungsplanrevision');
  const plan = dossier.planRevision;
  keyValues(doc, [
    ['Plan', `${plan.planNumber} · ${plan.planName}`],
    ['Revision', plan.revisionNumber],
    ['Status', plan.status],
    [
      'Freigegeben',
      `${formatDateTime(plan.releasedAt)}${plan.releasedBy ? ` durch ${plan.releasedBy}` : ''}`,
    ],
  ]);

  section(doc, '4. Verwendete Dokumente und Revisionen');
  if (dossier.documents.length === 0) {
    muted(doc, 'Diesem Auftrag sind keine Dokumente verbindlich zugeordnet.');
    return;
  }

  for (const document of dossier.documents) {
    doc.fontSize(BODY_SIZE).font('Helvetica-Bold');
    doc.text(`${document.documentNumber} Rev. ${document.revisionNumber} — ${document.title}`);
    doc.font('Helvetica');
    doc.text(
      `Status: ${document.revisionStatus}` +
        `${document.revisionStatus !== 'RELEASED' ? ' (zum Zeitpunkt der Aktenerzeugung nicht mehr die gültige Revision)' : ''}` +
        ` · Freigegeben: ${formatDateTime(document.releasedAt)}` +
        ` · Gebunden an Schritt(e): ${document.boundToStepNumbers.join(', ')}`,
      { width: contentWidth(doc) },
    );
    doc.text(`SHA-256: ${document.fileHashSha256 ?? '— keine Datei hinterlegt —'}`);
    doc.moveDown(0.5);
  }
}

// 5.–7. Schritte mit Bestätigungen, Prüfungen und Nachweisen
function stepsSection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '5.–7. Arbeitsschritte, Bestätigungen und Nachweise');

  if (dossier.steps.length === 0) {
    muted(doc, 'Für diesen Auftrag sind keine Arbeitsschritte angelegt.');
    return;
  }

  for (const step of dossier.steps) {
    ensureSpace(doc, 120);
    doc.fontSize(HEADING_SIZE - 1).font('Helvetica-Bold');
    const kind = step.stepKind === 'PRODUCTION' ? '' : ` [${step.stepKind}]`;
    const attempt = step.attemptNumber > 1 ? ` (Versuch ${step.attemptNumber})` : '';
    doc.text(`Schritt ${step.stepNumber}${attempt}: ${step.title}${kind}`);

    doc.fontSize(BODY_SIZE).font('Helvetica');
    doc.text(
      `Status: ${step.status} · Ausgeführt von: ${step.startedBy ?? '—'} · ` +
        `Start: ${formatDateTime(step.startedAt)} · Abschluss: ${formatDateTime(step.completedAt)}` +
        (step.nonConformanceNumber ? ` · Abweichung: ${step.nonConformanceNumber}` : ''),
      { width: contentWidth(doc) },
    );

    for (const confirmation of step.confirmations) {
      doc.text(
        `Bestätigt von ${confirmation.confirmedBy} am ${formatDateTime(confirmation.confirmedAt)} ` +
          `(${confirmation.signatureMethod}, Text v${confirmation.confirmationTextVersion}, ` +
          `Digest ${confirmation.signatureData.slice(0, 16)}…)`,
        { width: contentWidth(doc) },
      );
    }

    if (step.secondApproval) {
      const approval = step.secondApproval;
      doc.text(
        `Unabhängige Prüfung: ${approval.reviewerStatus} · Ausführend: ${approval.executor} · ` +
          `Prüfend: ${approval.reviewer ?? '— ausstehend —'} · ${formatDateTime(approval.reviewedAt)}` +
          (approval.reviewerReason ? ` · Begründung: ${approval.reviewerReason}` : ''),
        { width: contentWidth(doc) },
      );
    }

    for (const item of step.evidence.checklist) {
      doc.text(
        `  Checkliste ${item.itemNumber}. ${item.text}: ${item.response}` +
          (item.comment ? ` — ${item.comment}` : '') +
          ` (${item.respondedBy}, ${formatDateTime(item.respondedAt)})`,
        { width: contentWidth(doc) },
      );
    }

    for (const measurement of step.evidence.measurements) {
      const verdict = measurement.isWithinTolerance ? 'in Toleranz' : 'AUSSERHALB TOLERANZ';
      doc.text(
        `  Messwert ${measurement.characteristicNumber}. ${measurement.name}: ` +
          `${measurement.measuredValue}${measurement.unit ? ` ${measurement.unit}` : ''} ` +
          `[${measurement.lowerLimit ?? '−∞'} … ${measurement.upperLimit ?? '+∞'}] — ${verdict}` +
          (measurement.equipment ? ` · Prüfmittel: ${measurement.equipment}` : '') +
          (measurement.calibrationValidUntil
            ? ` (kalibriert bis ${formatDate(measurement.calibrationValidUntil)})`
            : '') +
          ` (${measurement.measuredBy}, ${formatDateTime(measurement.measuredAt)})`,
        { width: contentWidth(doc) },
      );
    }

    for (const photo of step.evidence.photos) {
      doc.text(
        `  Foto ${photo.category ?? 'ohne Kategorie'}: ${photo.uploadStatus}` +
          ` · SHA-256 ${photo.fileHashSha256 ?? '—'}` +
          ` (${photo.capturedBy}, ${formatDateTime(photo.uploadedAt ?? photo.takenAt)})`,
        { width: contentWidth(doc) },
      );
    }

    doc.moveDown(0.6);
  }
}

// 8. NCRs, Entscheidungen, Sperren und Nacharbeiten
function qualitySection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '8. Abweichungen, Sperren und Entscheidungen');

  if (dossier.nonConformances.length === 0) {
    muted(doc, 'Keine Abweichungen erfasst.');
  }
  for (const ncr of dossier.nonConformances) {
    ensureSpace(doc, 90);
    doc.fontSize(BODY_SIZE).font('Helvetica-Bold');
    doc.text(
      `${ncr.ncrNumber} — ${ncr.isBlocking ? 'BLOCKIEREND' : 'nicht blockierend'} · ${ncr.status}`,
    );
    doc.font('Helvetica');
    doc.text(
      `Priorität ${ncr.priority}${ncr.errorCategory ? ` · Fehlerart ${ncr.errorCategory}` : ''}` +
        `${ncr.affectedStepNumber !== null ? ` · Schritt ${ncr.affectedStepNumber}` : ''}`,
      { width: contentWidth(doc) },
    );
    doc.text(ncr.description, { width: contentWidth(doc) });
    doc.text(`Gemeldet von ${ncr.discoveredBy} am ${formatDateTime(ncr.discoveredAt)}`, {
      width: contentWidth(doc),
    });
    if (ncr.assessmentNotes)
      doc.text(`Bewertung: ${ncr.assessmentNotes}`, { width: contentWidth(doc) });
    if (ncr.immediateAction)
      doc.text(`Sofortmaßnahme: ${ncr.immediateAction}`, { width: contentWidth(doc) });
    if (ncr.rootCause) doc.text(`Ursache: ${ncr.rootCause}`, { width: contentWidth(doc) });
    if (ncr.dispositionType) {
      doc.text(
        `Disposition: ${ncr.dispositionType} — ${ncr.dispositionReason ?? '—'} ` +
          `(${ncr.dispositionBy ?? '—'}, ${formatDateTime(ncr.dispositionAt)})`,
        { width: contentWidth(doc) },
      );
    }
    doc.moveDown(0.5);
  }

  if (dossier.holds.length > 0) {
    doc
      .fontSize(HEADING_SIZE - 1)
      .font('Helvetica-Bold')
      .text('Sperren');
    doc.fontSize(BODY_SIZE).font('Helvetica');
    for (const hold of dossier.holds) {
      doc.text(
        `${hold.isActive ? 'AKTIV' : 'aufgehoben'} · ${hold.scopeType} · ${hold.holdReason}` +
          (hold.releaseCondition ? ` · Freigabebedingung: ${hold.releaseCondition}` : '') +
          ` · gesetzt von ${hold.appliedBy} am ${formatDateTime(hold.appliedAt)}` +
          (hold.releasedAt
            ? ` · aufgehoben von ${hold.releasedBy ?? '—'} am ${formatDateTime(hold.releasedAt)}` +
              (hold.releaseReason ? ` (${hold.releaseReason})` : '')
            : ''),
        { width: contentWidth(doc) },
      );
    }
    doc.moveDown(0.5);
  }

  if (dossier.conflictDecisions.length > 0) {
    doc
      .fontSize(HEADING_SIZE - 1)
      .font('Helvetica-Bold')
      .text('Synchronisationskonflikte und Entscheidungen');
    doc.fontSize(BODY_SIZE).font('Helvetica');
    for (const conflict of dossier.conflictDecisions) {
      doc.text(
        `${conflict.conflictType} · ${conflict.status} · erkannt ${formatDateTime(conflict.detectedAt)}: ${conflict.summary}`,
        { width: contentWidth(doc) },
      );
      for (const decision of conflict.decisions) {
        doc.text(
          `  → ${decision.decisionType} durch ${decision.decidedBy} am ${formatDateTime(decision.decidedAt)}: ` +
            `${decision.reason}${decision.resultingAction ? ` [${decision.resultingAction}]` : ''}`,
          { width: contentWidth(doc) },
        );
      }
    }
    doc.moveDown(0.5);
  }
}

// 9. Endprüfung und Produktfreigabe
function finalReleaseSection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '9. Endprüfung und Produktfreigabe');
  const release = dossier.finalRelease;

  keyValues(doc, [
    ['Auftrag abgeschlossen', release.orderCompleted ? 'ja' : 'nein'],
    ['Abschlusszeitpunkt', formatDateTime(release.completedAt)],
    [
      'Letzter abgeschlossener Schritt',
      release.finalStepNumber !== null
        ? `${release.finalStepNumber} · ${release.finalStepTitle ?? '—'}` +
          (release.finalStepConfirmedBy ? ` (bestätigt von ${release.finalStepConfirmedBy})` : '')
        : '—',
    ],
    ['Offene blockierende Abweichungen', String(release.openBlockingNonConformances)],
    ['Aktive Sperren', String(release.activeHolds)],
  ]);

  doc.moveDown(0.4);
  doc.fontSize(BODY_SIZE).font('Helvetica-Bold');
  doc.text(
    release.releasable
      ? 'Aus Sicht dieser Akte steht der Produktfreigabe nichts entgegen.'
      : 'Diese Akte weist offene Punkte aus — eine Produktfreigabe ist auf ihrer Grundlage nicht belegt.',
    { width: contentWidth(doc) },
  );

  doc.moveDown(0.4);
  const decision = release.decision;
  if (!decision) {
    // Still the honest answer, and still worth printing: an empty section
    // would read as "nothing to report" rather than "nobody has decided".
    doc.font('Helvetica-Oblique');
    doc.text(
      'Für diesen Auftrag liegt keine Produktfreigabe-Entscheidung vor. Abgeschlossen ist nicht ' +
        'freigegeben — die Freigabe ist eine Entscheidung einer berechtigten Person.',
      { width: contentWidth(doc) },
    );
    return;
  }

  doc
    .font('Helvetica-Bold')
    .text(
      decision.decision === 'RELEASED' ? 'Produkt freigegeben.' : 'Produktfreigabe abgelehnt.',
      { width: contentWidth(doc) },
    );
  keyValues(doc, [
    ['Entschieden von', decision.decidedBy ?? '—'],
    ['Entschieden am', formatDateTime(decision.decidedAt)],
    ['Begründung', decision.reason],
    [
      'Grundlage zum Entscheidungszeitpunkt',
      `Auftragsstatus ${decision.basis.orderStatus}, ` +
        `${decision.basis.completedSteps}/${decision.basis.totalSteps} Schritte abgeschlossen, ` +
        `${decision.basis.openBlockingNonConformances} offene blockierende Abweichung(en), ` +
        `${decision.basis.activeHolds} aktive Sperre(n)`,
    ],
    [
      'Bestätigung',
      `Text v${decision.confirmationTextVersion}, Digest ${decision.signatureData.slice(0, 16)}…`,
    ],
  ]);
  doc.font('Helvetica-Oblique').fontSize(BODY_SIZE);
  doc.text(decision.confirmationText, { width: contentWidth(doc) });
}

// 10. relevanter Audit-Auszug und Erzeugungsmetadaten
function auditSection(doc: Doc, dossier: ProductionDossierContent): void {
  section(doc, '10. Beteiligte, Audit-Auszug und Erzeugung');

  doc.fontSize(BODY_SIZE).font('Helvetica-Bold').text('Beteiligte');
  doc.font('Helvetica');
  if (dossier.participants.length === 0) muted(doc, 'Keine Beteiligten erfasst.');
  for (const participant of dossier.participants) {
    doc.text(
      `${participant.displayName} (${participant.email}) — Rollen aktuell: ${participant.roles.join(', ') || '—'}`,
      { width: contentWidth(doc) },
    );
  }
  doc.font('Helvetica-Oblique').fontSize(BODY_SIZE - 1);
  doc.text(
    'Rollen werden zum Zeitpunkt der Aktenerzeugung gelesen; eine Rollenhistorie wird nicht geführt.',
    { width: contentWidth(doc) },
  );
  doc.moveDown(0.6);

  doc
    .fontSize(BODY_SIZE)
    .font('Helvetica-Bold')
    .text(`Audit-Auszug (${dossier.auditTrail.length} Ereignisse)`);
  doc.font('Helvetica').fontSize(BODY_SIZE - 1);
  for (const event of dossier.auditTrail) {
    ensureSpace(doc, 24);
    doc.text(
      `${formatDateTime(event.serverTimestamp)} · ${event.eventType} · ${event.resourceType} · ` +
        `${event.actor ?? 'System'}${event.result ? ` · ${event.result}` : ''}` +
        `${event.source ? ` · ${event.source}` : ''}${event.reason ? ` · ${event.reason}` : ''}`,
      { width: contentWidth(doc) },
    );
  }

  doc.moveDown(0.8);
  doc.fontSize(BODY_SIZE).font('Helvetica-Bold').text('Erzeugungsmetadaten');
  doc.font('Helvetica');
  keyValues(doc, [
    ['Erzeugt am', formatDateTime(dossier.generation.generatedAt)],
    ['Erzeugt durch', dossier.generation.generatedBy],
    ['Vorlagenversion', dossier.generation.templateVersion],
    ['Datenstand', formatDateTime(dossier.identification.dataAsOf)],
    ['Nachweisdateien', String(dossier.generation.evidenceFiles.length)],
  ]);
}

// ── layout helpers ───────────────────────────────────────────

function section(doc: Doc, title: string): void {
  ensureSpace(doc, 80);
  doc.moveDown(1);
  doc.fontSize(HEADING_SIZE).font('Helvetica-Bold').text(title);
  doc
    .moveTo(MARGIN, doc.y + 2)
    .lineTo(doc.page.width - MARGIN, doc.y + 2)
    .stroke();
  doc.moveDown(0.6);
  doc.fontSize(BODY_SIZE).font('Helvetica');
}

function keyValues(doc: Doc, rows: Array<[string, string]>): void {
  doc.fontSize(BODY_SIZE);
  for (const [key, value] of rows) {
    ensureSpace(doc, 16);
    doc.font('Helvetica-Bold').text(`${key}: `, { continued: true });
    doc.font('Helvetica').text(value);
  }
}

function muted(doc: Doc, text: string): void {
  doc
    .fontSize(BODY_SIZE)
    .font('Helvetica-Oblique')
    .text(text, { width: contentWidth(doc) });
  doc.font('Helvetica');
}

function contentWidth(doc: Doc): number {
  return doc.page.width - MARGIN * 2;
}

/** pdfkit adds pages on overflow by itself, but a heading landing on the last
 *  line of a page with its content on the next is the classic ugly result —
 *  so blocks that belong together ask for room first. */
function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > doc.page.height - MARGIN) doc.addPage();
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return '—';
  return value.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '—';
  return value.toLocaleDateString('de-DE', { dateStyle: 'medium' });
}
