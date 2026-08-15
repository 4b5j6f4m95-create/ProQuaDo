import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getSyncConflict } from '@/domain/sync/conflicts';
import { DECISION_LABEL, type ConflictDecisionType } from '@/domain/sync/conflict-types';
import { StatusChip } from '@/components/StatusChip';
import { ConflictDecisionForm } from '@/components/ConflictDecisionForm';

interface RevisionMismatch {
  documentNumber: string;
  documentTitle: string;
  usedRevisionNumber: string;
  currentRevisionNumber: string | null;
  currentRevisionReleasedAt: string | null;
  changeReason: string | null;
}

/** Konfliktdetail und Entscheidung — docs/07 B4. */
export default async function SyncConflictPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const conflict = await getSyncConflict(actor, params.id);
  const detail = (conflict.detail ?? {}) as Record<string, unknown>;
  const mismatches = Array.isArray(detail.mismatches)
    ? (detail.mismatches as RevisionMismatch[])
    : [];
  const missingBindings = Array.isArray(detail.missingBindings)
    ? (detail.missingBindings as Array<{ documentNumber: string; revisionNumber: string }>)
    : [];

  return (
    <main>
      <p>
        <Link className="action-link" href="/sync/conflicts">
          ← Konfliktcenter
        </Link>
      </p>

      <h1>Konflikt: {conflict.conflictType}</h1>
      <p>
        <StatusChip status={conflict.status} /> · {conflict.typeLabel}
      </p>

      <section className="card">
        <h2>Betroffener Vorgang</h2>
        {conflict.productionOrder ? (
          <p>
            Auftrag:{' '}
            <Link href={`/production-orders/${conflict.productionOrder.id}`}>
              {conflict.productionOrder.orderNumber}
            </Link>
            {conflict.productionOrder.serialNumber &&
              ` · Serie ${conflict.productionOrder.serialNumber}`}
          </p>
        ) : (
          <p className="muted">Kein Produktionsauftrag zugeordnet.</p>
        )}
        {conflict.workStepInstance && (
          <p>
            Schritt:{' '}
            <Link href={`/work-steps/${conflict.workStepInstance.id}`}>
              {conflict.workStepInstance.stepNumber} – {conflict.workStepInstance.planStep.title}
            </Link>{' '}
            <StatusChip status={conflict.workStepInstance.status} />
          </p>
        )}
        <p>{conflict.summary}</p>
        <p className="muted">Erkannt am {conflict.detectedAt.toLocaleString('de-DE')}</p>
      </section>

      {mismatches.length > 0 && (
        <section className="card blocked-card">
          <h2>Revisionsunterschied</h2>
          {mismatches.map((mismatch) => (
            <div key={mismatch.documentNumber}>
              <p>
                <strong>
                  {mismatch.documentNumber} — {mismatch.documentTitle}
                </strong>
              </p>
              <p>
                Ausgeführt mit: Rev. {mismatch.usedRevisionNumber}
                <br />
                Aktuell gültig: Rev. {mismatch.currentRevisionNumber ?? '— keine freigegebene —'}
                {mismatch.currentRevisionReleasedAt &&
                  ` (seit ${new Date(mismatch.currentRevisionReleasedAt).toLocaleDateString('de-DE')})`}
              </p>
              {mismatch.changeReason && (
                <p>
                  Unterschied laut Änderungsgrund: <em>{mismatch.changeReason}</em>
                </p>
              )}
            </div>
          ))}
          <p className="muted">
            Die Ausführung bleibt mit der ursprünglich verwendeten Revision dokumentiert. Sie wird
            durch keine Entscheidung auf die neue Revision umgeschrieben.
          </p>
        </section>
      )}

      {missingBindings.length > 0 && (
        <section className="card blocked-card">
          <h2>Nicht belegte Unterlagen</h2>
          <ul>
            {missingBindings.map((binding) => (
              <li key={`${binding.documentNumber}-${binding.revisionNumber}`}>
                {binding.documentNumber} Rev. {binding.revisionNumber} — das Gerät hat nicht
                gemeldet, dass diese verbindliche Unterlage bei der Ausführung vorlag.
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflict.syncCommand && (
        <section className="card">
          <h2>Vom Gerät übertragen</h2>
          <p>
            Kommando: <code>{conflict.syncCommand.commandType}</code>
            <br />
            Erfasst am: {conflict.syncCommand.clientTimestamp.toLocaleString('de-DE')}
          </p>
          <p className="muted">
            Die offline erfassten Daten bleiben unverändert erhalten, unabhängig davon, wie
            entschieden wird.
          </p>
        </section>
      )}

      {conflict.decisions.length > 0 && (
        <section className="card">
          <h2>Entscheidungen</h2>
          <ul>
            {conflict.decisions.map((decision) => (
              <li key={decision.id}>
                <strong>
                  {DECISION_LABEL[decision.decisionType as ConflictDecisionType] ??
                    decision.decisionType}
                </strong>{' '}
                · {decision.decidedAt.toLocaleString('de-DE')}
                <br />
                {decision.reason}
                {decision.resultingAction && (
                  <>
                    <br />
                    <span className="muted">→ {decision.resultingAction}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflict.status === 'OPEN' ? (
        <ConflictDecisionForm
          conflictId={conflict.id}
          availableDecisions={conflict.availableDecisions}
        />
      ) : (
        <p className="notice">Dieser Konflikt wurde bereits entschieden.</p>
      )}
    </main>
  );
}
