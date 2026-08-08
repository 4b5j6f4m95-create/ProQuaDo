import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listSyncConflicts } from '@/domain/sync/conflicts';
import { CONFLICT_TYPE_LABEL } from '@/domain/sync/conflict-types';
import { StatusChip } from '@/components/StatusChip';

/** Konfliktcenter — docs/07 B4. The list; one conflict per row, newest
 *  open ones first, because an open conflict means a step is standing
 *  still on the shop floor. */
export default async function SyncConflictsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const actor = await requirePageAuth();
  const status =
    searchParams.status === 'RESOLVED' || searchParams.status === 'ALL'
      ? searchParams.status
      : 'OPEN';
  const conflicts = await listSyncConflicts(actor, { status });

  return (
    <main>
      <h1>Konfliktcenter</h1>
      <p className="muted">
        Konflikte aus der Synchronisation offline erfasster Arbeit. Kein Konflikt wird automatisch
        aufgelöst — jeder wird von einer berechtigten Person entschieden und dokumentiert.
      </p>

      <p className="actions">
        <Link className="button-link" href="/sync/conflicts?status=OPEN">
          Offen
        </Link>
        <Link className="button-link" href="/sync/conflicts?status=RESOLVED">
          Entschieden
        </Link>
        <Link className="button-link" href="/sync/conflicts?status=ALL">
          Alle
        </Link>
      </p>

      {conflicts.length === 0 && (
        <p className="notice">
          {status === 'OPEN'
            ? 'Derzeit sind keine Konflikte offen.'
            : 'Keine Konflikte in dieser Auswahl.'}
        </p>
      )}

      {conflicts.map((conflict) => (
        <section key={conflict.id} className="card">
          <h2>
            <Link href={`/sync/conflicts/${conflict.id}`}>
              {CONFLICT_TYPE_LABEL[conflict.conflictType] ?? conflict.conflictType}
            </Link>
          </h2>
          <p>
            <StatusChip status={conflict.status} />
            {conflict.orderNumber && ` · Auftrag ${conflict.orderNumber}`}
            {conflict.stepNumber !== null && ` · Schritt ${conflict.stepNumber}`}
            {conflict.stepTitle && ` – ${conflict.stepTitle}`}
          </p>
          <p>{conflict.summary}</p>
          <p className="muted">
            Erkannt am {conflict.detectedAt.toLocaleString('de-DE')}
            {conflict.status === 'OPEN' && conflict.availableDecisions.length > 0 && (
              <> · {conflict.availableDecisions.length} Entscheidungsmöglichkeiten</>
            )}
          </p>
          {conflict.status === 'OPEN' && (
            <Link className="button-link" href={`/sync/conflicts/${conflict.id}`}>
              Entscheiden →
            </Link>
          )}
        </section>
      ))}
    </main>
  );
}
