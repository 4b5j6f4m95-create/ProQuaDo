import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { assembleProductionDossier } from '@/domain/dossier/assemble-dossier';
import { listDossierExports } from '@/domain/dossier/export-dossier';
import { describeBlockers } from '@/domain/quality/product-release';
import { can } from '@/lib/authz/can';
import { StatusChip } from '@/components/StatusChip';
import { DossierExportForm } from '@/components/DossierExportForm';
import { ProductReleaseForm } from '@/components/ProductReleaseForm';

/**
 * Die digitale Produktionsakte auf dem Bildschirm — dieselben zehn Abschnitte
 * wie im PDF, damit niemand exportieren muss, um zu sehen, was drinsteht
 * (Abnahmeszenario F: "sieht mit Berechtigung lückenlos …").
 */
export default async function DossierPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const dossier = await assembleProductionDossier(actor, params.id);
  const exports = await listDossierExports(actor, params.id);
  const decision = dossier.finalRelease.decision;
  // Whether to OFFER the decision. The server decides whether to accept one.
  const mayDecide = (
    await can({
      userId: actor.userId,
      organizationId: actor.organizationId,
      action: 'product_release.decide',
    })
  ).allowed;

  return (
    <main>
      <p>
        <Link href={`/production-orders/${params.id}`}>← {dossier.identification.orderNumber}</Link>
      </p>

      <h1>Produktionsakte</h1>
      <p className="muted">
        Datenstand {dossier.identification.dataAsOf.toLocaleString('de-DE')} · Vorlagenversion{' '}
        {dossier.identification.templateVersion}. Diese Ansicht wird bei jedem Aufruf aus den
        Primärdaten abgeleitet.
      </p>

      <section className="card">
        <h2>1.–2. Identifikation und Auftragsdaten</h2>
        <dl className="key-values">
          <Row k="Auftrag" v={dossier.identification.orderNumber} />
          <Row k="Seriennummer" v={dossier.identification.serialNumber ?? '—'} />
          <Row k="Charge" v={dossier.identification.batchNumber ?? '—'} />
          <Row
            k="Produkt"
            v={`${dossier.context.productNumber} · ${dossier.context.productName}`}
          />
          <Row
            k="Projekt"
            v={`${dossier.context.projectNumber} · ${dossier.context.projectName}`}
          />
          <Row k="Kunde" v={dossier.context.customerName ?? '—'} />
          <Row k="Standort" v={`${dossier.context.siteCode} · ${dossier.context.siteName}`} />
          <Row k="Status" v={dossier.context.orderStatus} />
        </dl>
      </section>

      <section className="card">
        <h2>3.–4. Plan- und Dokumentrevisionen</h2>
        <p>
          {dossier.planRevision.planNumber} · {dossier.planRevision.planName} — Rev.{' '}
          {dossier.planRevision.revisionNumber} <StatusChip status={dossier.planRevision.status} />
        </p>
        {dossier.documents.length === 0 ? (
          <p className="muted">Keine Dokumente verbindlich zugeordnet.</p>
        ) : (
          <ul>
            {dossier.documents.map((document) => (
              <li key={`${document.documentNumber}-${document.revisionNumber}`}>
                {document.documentNumber} Rev. {document.revisionNumber} — {document.title}{' '}
                <StatusChip status={document.revisionStatus} />
                {document.revisionStatus !== 'RELEASED' && (
                  <span className="muted">
                    {' '}
                    — zum Zeitpunkt der Ausführung verbindlich, inzwischen ersetzt
                  </span>
                )}
                <br />
                <span className="muted">
                  Schritt(e) {document.boundToStepNumbers.join(', ')} · SHA-256{' '}
                  {document.fileHashSha256?.slice(0, 16) ?? '—'}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>5.–7. Arbeitsschritte, Bestätigungen und Nachweise</h2>
        {dossier.steps.map((step) => (
          <section key={step.workStepInstanceId} className="card">
            <h3>
              Schritt {step.stepNumber}
              {step.attemptNumber > 1 ? ` (Versuch ${step.attemptNumber})` : ''}: {step.title}{' '}
              <StatusChip status={step.status} />
              {step.stepKind !== 'PRODUCTION' && (
                <span className="status-chip">{step.stepKind}</span>
              )}
            </h3>
            <p className="muted">
              Ausgeführt von {step.startedBy ?? '—'} ·{' '}
              {step.startedAt?.toLocaleString('de-DE') ?? '—'} bis{' '}
              {step.completedAt?.toLocaleString('de-DE') ?? '—'}
              {step.nonConformanceNumber && ` · Abweichung ${step.nonConformanceNumber}`}
            </p>

            {step.confirmations.map((confirmation, index) => (
              <p key={index}>
                ✓ Bestätigt von {confirmation.confirmedBy} am{' '}
                {confirmation.confirmedAt.toLocaleString('de-DE')} ({confirmation.signatureMethod})
              </p>
            ))}

            {step.secondApproval && (
              <p>
                👥 Unabhängige Prüfung: {step.secondApproval.reviewerStatus} · ausführend{' '}
                {step.secondApproval.executor} · prüfend{' '}
                {step.secondApproval.reviewer ?? 'ausstehend'}
              </p>
            )}

            {step.evidence.checklist.length > 0 && (
              <ul>
                {step.evidence.checklist.map((item, index) => (
                  <li key={index}>
                    {item.itemNumber}. {item.text}: <strong>{item.response}</strong>
                    {item.comment && ` — ${item.comment}`}
                  </li>
                ))}
              </ul>
            )}

            {step.evidence.measurements.map((measurement, index) => (
              <p key={index}>
                📏 {measurement.name}: {measurement.measuredValue} {measurement.unit ?? ''} [
                {measurement.lowerLimit ?? '−∞'} … {measurement.upperLimit ?? '+∞'}] —{' '}
                {measurement.isWithinTolerance ? (
                  <span className="status-chip status-done">in Toleranz</span>
                ) : (
                  <span className="status-chip status-blocked">außerhalb Toleranz</span>
                )}
                {measurement.equipment && ` · ${measurement.equipment}`}
              </p>
            ))}

            {step.evidence.photos.map((photo) => (
              <p key={photo.id} className="muted">
                📷 {photo.category ?? 'Foto'} · {photo.uploadStatus} · SHA-256{' '}
                {photo.fileHashSha256?.slice(0, 16) ?? '—'}…
              </p>
            ))}
          </section>
        ))}
      </section>

      <section className="card">
        <h2>8. Abweichungen, Sperren und Entscheidungen</h2>
        {dossier.nonConformances.length === 0 && dossier.holds.length === 0 && (
          <p className="muted">Keine Abweichungen und keine Sperren.</p>
        )}
        {dossier.nonConformances.map((ncr) => (
          <p key={ncr.ncrNumber}>
            <strong>{ncr.ncrNumber}</strong> ·{' '}
            {ncr.isBlocking ? 'blockierend' : 'nicht blockierend'} ·{' '}
            <StatusChip status={ncr.status} />
            <br />
            {ncr.description}
            {ncr.dispositionType && (
              <>
                <br />
                <span className="muted">
                  Disposition: {ncr.dispositionType} — {ncr.dispositionReason ?? '—'}
                </span>
              </>
            )}
          </p>
        ))}
        {dossier.holds.map((hold, index) => (
          <p key={index}>
            {hold.isActive ? '⛔ AKTIV' : '✓ aufgehoben'} · {hold.holdReason}
          </p>
        ))}
        {dossier.conflictDecisions.map((conflict, index) => (
          <p key={index}>
            ⚠ {conflict.conflictType} · {conflict.status} — {conflict.summary}
            {conflict.decisions.map((decision, decisionIndex) => (
              <span key={decisionIndex}>
                <br />
                <span className="muted">
                  → {decision.decisionType} durch {decision.decidedBy}: {decision.reason}
                </span>
              </span>
            ))}
          </p>
        ))}
      </section>

      <section
        className={`card${
          decision
            ? decision.decision === 'RELEASED'
              ? ' done-card'
              : ' blocked-card'
            : dossier.finalRelease.releasable
              ? ' done-card'
              : ' blocked-card'
        }`}
      >
        <h2>9. Endprüfung und Produktfreigabe</h2>
        <p>
          Auftrag abgeschlossen: {dossier.finalRelease.orderCompleted ? 'ja' : 'nein'} · Offene
          blockierende Abweichungen: {dossier.finalRelease.openBlockingNonConformances} · Aktive
          Sperren: {dossier.finalRelease.activeHolds}
        </p>
        <p>
          <strong>
            {dossier.finalRelease.releasable
              ? 'Aus Sicht dieser Akte steht der Produktfreigabe nichts entgegen.'
              : 'Diese Akte weist offene Punkte aus — eine Produktfreigabe ist auf ihrer Grundlage nicht belegt.'}
          </strong>
        </p>

        {decision ? (
          <>
            <p>
              <strong>
                {decision.decision === 'RELEASED'
                  ? 'Produkt freigegeben'
                  : 'Produktfreigabe abgelehnt'}
              </strong>{' '}
              von {decision.decidedBy ?? '—'} am {decision.decidedAt.toLocaleString('de-DE')}
            </p>
            <dl className="key-values">
              <Row k="Begründung" v={decision.reason} />
              <Row
                k="Grundlage zum Entscheidungszeitpunkt"
                v={
                  `Auftragsstatus ${decision.basis.orderStatus} · ` +
                  `${decision.basis.completedSteps}/${decision.basis.totalSteps} Schritte · ` +
                  `${decision.basis.openBlockingNonConformances} offene blockierende Abweichung(en) · ` +
                  `${decision.basis.activeHolds} aktive Sperre(n)`
                }
              />
              <Row
                k="Bestätigung"
                v={`Text v${decision.confirmationTextVersion}, Digest ${decision.signatureData.slice(0, 16)}…`}
              />
            </dl>
            <p className="muted">{decision.confirmationText}</p>
          </>
        ) : (
          <p className="muted">
            Für diesen Auftrag liegt keine Produktfreigabe-Entscheidung vor. Abgeschlossen ist nicht
            freigegeben.
          </p>
        )}

        {/* Offered only where a decision is still open and the viewer may
            make one. Both conditions are re-checked server-side — this is
            what to show, not what is allowed. */}
        {mayDecide && decision?.decision !== 'RELEASED' && (
          <ProductReleaseForm
            productionOrderId={params.id}
            blockers={describeBlockers({
              orderStatus: dossier.context.orderStatus,
              openBlockingNonConformances: dossier.finalRelease.openBlockingNonConformances,
              activeHolds: dossier.finalRelease.activeHolds,
              completedSteps: 0,
              totalSteps: 0,
            })}
          />
        )}
      </section>

      <section className="card">
        <h2>10. Beteiligte und Audit-Auszug</h2>
        <ul>
          {dossier.participants.map((participant) => (
            <li key={participant.userId}>
              {participant.displayName} — {participant.roles.join(', ') || '—'}
            </li>
          ))}
        </ul>
        <details>
          <summary>Audit-Auszug ({dossier.auditTrail.length} Ereignisse)</summary>
          <ul>
            {dossier.auditTrail.map((event, index) => (
              <li key={index} className="muted">
                {event.serverTimestamp.toLocaleString('de-DE')} · {event.eventType} ·{' '}
                {event.actor ?? 'System'}
                {event.result && ` · ${event.result}`}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <DossierExportForm productionOrderId={params.id} />

      {exports.length > 0 && (
        <section className="card">
          <h2>Frühere Exporte</h2>
          <ul>
            {exports.map((exported) => (
              <li key={exported.id}>
                {exported.productionDossier.dossierNumber} · {exported.format} ·{' '}
                <StatusChip status={exported.status} /> ·{' '}
                {exported.requestedAt.toLocaleString('de-DE')}
                {exported.fileHashSha256 && (
                  <>
                    <br />
                    <span className="muted">
                      SHA-256 {exported.fileHashSha256.slice(0, 32)}… · {exported.entryCount ?? 0}{' '}
                      Einträge · Datenstand{' '}
                      {exported.productionDossier.dataAsOf.toLocaleString('de-DE')}
                    </span>
                  </>
                )}
                {exported.failureReason && (
                  <>
                    <br />
                    <span className="error-text">{exported.failureReason}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
