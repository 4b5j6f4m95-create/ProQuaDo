import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getNonConformance } from '@/domain/quality/ncr-queries';
import { StatusChip } from '@/components/StatusChip';
import {
  assessNonConformanceAction,
  containNonConformanceAction,
  createReinspectionStepAction,
  createReworkStepAction,
  disposeNonConformanceAction,
  releaseProductionHoldAction,
} from '../../actions';

/**
 * NCR-Bewertung und Disposition (docs/07 C2). The available actions follow
 * the state machine — each form is rendered only in the status where its
 * transition is legal, and the server re-checks it anyway.
 */
export default async function NonConformanceDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const ncr = await getNonConformance(actor, params.id);
  const activeHolds = ncr.holds.filter((hold) => hold.isActive);

  return (
    <main>
      <p>
        <Link href="/quality/ncrs">← Abweichungen</Link>
      </p>
      <h1>
        {ncr.ncrNumber}: {ncr.description.slice(0, 80)}
      </h1>
      <p>
        <span className={`status-chip ${ncr.isBlocking ? 'status-blocked' : ''}`}>
          {ncr.isBlocking ? '⛔ blockierend' : '○ nicht blockierend'}
        </span>
        <span className="status-chip">Status: {ncr.status}</span>
        <span className="status-chip">Priorität: {ncr.priority}</span>
      </p>

      <section className="card">
        <h2>Kontext</h2>
        <p>
          Auftrag:{' '}
          <Link href={`/production-orders/${ncr.productionOrder.id}`}>
            {ncr.productionOrder.orderNumber}
          </Link>{' '}
          <StatusChip status={ncr.productionOrder.status} />
          {ncr.productionOrder.serialNumber ? ` · SN ${ncr.productionOrder.serialNumber}` : ''}
        </p>
        <p>Produkt: {ncr.product.name}</p>
        {ncr.workStepInstance && (
          <p>
            Arbeitsschritt:{' '}
            <Link href={`/work-steps/${ncr.workStepInstance.id}`}>
              {ncr.workStepInstance.stepNumber}. {ncr.workStepInstance.planStep.title}
            </Link>{' '}
            <StatusChip status={ncr.workStepInstance.status} />
          </p>
        )}
        {ncr.inspectionCharacteristic && (
          <p>
            Prüfmerkmal: {ncr.inspectionCharacteristic.name} (Toleranz{' '}
            {ncr.inspectionCharacteristic.lowerLimit?.toString() ?? '−∞'} –{' '}
            {ncr.inspectionCharacteristic.upperLimit?.toString() ?? '+∞'}
            {ncr.inspectionCharacteristic.unit ? ` ${ncr.inspectionCharacteristic.unit}` : ''})
          </p>
        )}
        <p>Beschreibung: {ncr.description}</p>
        {ncr.errorCategory && <p>Fehlerart: {ncr.errorCategory}</p>}
        {ncr.immediateAction && <p>Sofortmaßnahme: {ncr.immediateAction}</p>}
        {ncr.rootCause && <p>Ursache: {ncr.rootCause}</p>}
        {ncr.assessmentNotes && <p>Bewertung: {ncr.assessmentNotes}</p>}
        {ncr.dispositionType && (
          <p>
            Disposition: {ncr.dispositionType} — {ncr.dispositionReason}
          </p>
        )}
      </section>

      {activeHolds.length > 0 && (
        <section className="card blocked-card">
          <h2>Aktive Sperren</h2>
          {activeHolds.map((hold) => (
            <div key={hold.id}>
              <p>
                {hold.scopeType}: {hold.holdReason}
                {hold.releaseCondition && (
                  <>
                    <br />
                    <strong>Freigabebedingung:</strong> {hold.releaseCondition}
                  </>
                )}
              </p>
              <form action={releaseProductionHoldAction}>
                <input type="hidden" name="nonConformanceId" value={ncr.id} />
                <input type="hidden" name="productionHoldId" value={hold.id} />
                <label>
                  Begründung der Aufhebung
                  <input name="releaseReason" required maxLength={500} />
                </label>
                <button type="submit">Sperre aufheben</button>
              </form>
            </div>
          ))}
        </section>
      )}

      {ncr.derivedSteps.length > 0 && (
        <section className="card">
          <h2>Nacharbeit und Nachprüfung</h2>
          <ul>
            {ncr.derivedSteps.map((derived) => (
              <li key={derived.id}>
                {derived.stepKind === 'REWORK' ? '🔁 Nacharbeit' : '🔍 Nachprüfung'} (Versuch{' '}
                {derived.attemptNumber}) —{' '}
                <Link href={`/work-steps/${derived.id}`}>Schritt {derived.stepNumber}</Link>{' '}
                <StatusChip status={derived.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {ncr.status === 'OPEN' && (
        <form action={assessNonConformanceAction} className="card">
          <h2>Bewerten</h2>
          <label>
            Bewertung / Begründung
            <textarea name="assessmentNotes" rows={3} required maxLength={4000} />
          </label>
          <label>
            Klassifikation
            <select name="isBlocking" defaultValue="unchanged">
              <option value="unchanged">
                unverändert ({ncr.isBlocking ? 'blockierend' : 'nicht blockierend'})
              </option>
              <option value="true">blockierend</option>
              <option value="false">nicht blockierend</option>
            </select>
          </label>
          <label>
            Priorität
            <select name="priority" defaultValue={ncr.priority}>
              <option value="CRITICAL">Kritisch</option>
              <option value="HIGH">Hoch</option>
              <option value="MEDIUM">Mittel</option>
              <option value="LOW">Gering</option>
            </select>
          </label>
          <input type="hidden" name="nonConformanceId" value={ncr.id} />
          <button type="submit">Bewertung speichern</button>
        </form>
      )}

      {ncr.status === 'ASSESSMENT_REQUIRED' && (
        <form action={containNonConformanceAction} className="card">
          <h2>Sofortmaßnahme</h2>
          <input type="hidden" name="nonConformanceId" value={ncr.id} />
          <label>
            Sofortmaßnahme
            <textarea name="immediateAction" rows={2} required maxLength={4000} />
          </label>
          <label>
            Ursachenanalyse
            <textarea name="rootCause" rows={2} maxLength={4000} />
          </label>
          <button type="submit">Eindämmung erfassen</button>
        </form>
      )}

      {ncr.status === 'CONTAINMENT' && (
        <form action={createReworkStepAction} className="card">
          <h2>Nacharbeit</h2>
          <p>
            Erzeugt einen eigenen Nacharbeitsschritt, verknüpft mit dem ursprünglichen Schritt. Die
            fehlerhafte Erstausführung bleibt unverändert in der Historie.
          </p>
          <input type="hidden" name="nonConformanceId" value={ncr.id} />
          <button type="submit">Nacharbeit erstellen</button>
        </form>
      )}

      {ncr.status === 'REINSPECTION' && (
        <form action={createReinspectionStepAction} className="card">
          <h2>Nachprüfung</h2>
          <p>Erzeugt den Nachprüfungsschritt — ausführbar nur mit Prüfberechtigung.</p>
          <input type="hidden" name="nonConformanceId" value={ncr.id} />
          <button type="submit">Nachprüfung erstellen</button>
        </form>
      )}

      {(ncr.status === 'ASSESSMENT_REQUIRED' ||
        ncr.status === 'CONTAINMENT' ||
        ncr.status === 'AWAITING_DISPOSITION') && (
        <form action={disposeNonConformanceAction} className="card">
          <h2>Disposition</h2>
          <input type="hidden" name="nonConformanceId" value={ncr.id} />
          <label>
            Entscheidung
            <select name="dispositionType" required>
              <option value="REWORK">Nacharbeit erforderlich</option>
              <option value="CONCESSION">Konzession (mit Begründung)</option>
              <option value="SCRAP">Ausschuss</option>
            </select>
          </label>
          <label>
            Begründung
            <textarea name="dispositionReason" rows={3} required maxLength={4000} />
          </label>
          <button type="submit" className="primary">
            Disposition festlegen
          </button>
        </form>
      )}
    </main>
  );
}
