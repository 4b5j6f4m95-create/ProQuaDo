import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listNonConformances } from '@/domain/quality/ncr-queries';
import { StatusChip } from '@/components/StatusChip';

/** NCR-Übersicht (docs/07 C1). */
export default async function NonConformanceListPage({
  searchParams,
}: {
  searchParams: { open?: string; blocking?: string };
}) {
  const actor = await requirePageAuth();
  const openOnly = searchParams.open !== 'false';
  const blockingOnly = searchParams.blocking === 'true';
  const ncrs = await listNonConformances(actor, { openOnly, blockingOnly });

  return (
    <main>
      <h1>Qualitätsmanagement · Abweichungen</h1>

      <div className="actions">
        <Link className={openOnly ? 'button-link' : ''} href="/quality/ncrs?open=true">
          Offen
        </Link>
        <Link className={!openOnly ? 'button-link' : ''} href="/quality/ncrs?open=false">
          Alle
        </Link>
        <Link
          className={blockingOnly ? 'button-link' : ''}
          href={`/quality/ncrs?open=${openOnly}&blocking=true`}
        >
          Nur blockierend
        </Link>
      </div>

      {ncrs.length === 0 && <p className="empty-state">Keine Abweichungen gefunden.</p>}

      {ncrs.map((ncr) => (
        <section key={ncr.id} className="card">
          <h2>
            <Link href={`/quality/ncrs/${ncr.id}`}>{ncr.ncrNumber}</Link>{' '}
            <span className={`status-chip ${ncr.isBlocking ? 'status-blocked' : ''}`}>
              {ncr.isBlocking ? '⛔ blockierend' : '○ nicht blockierend'}
            </span>
            <StatusChip status={ncr.status === 'CLOSED' ? 'COMPLETED' : 'BLOCKED'} />
          </h2>
          <p>
            {ncr.productionOrder.orderNumber}
            {ncr.workStepInstance ? ` · Schritt ${ncr.workStepInstance.stepNumber}` : ''} ·{' '}
            {ncr.product.name}
          </p>
          <p>
            {ncr.description} — Status: <strong>{ncr.status}</strong> · Priorität {ncr.priority}
          </p>
        </section>
      ))}
    </main>
  );
}
