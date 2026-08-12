import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listMyOrders } from '@/domain/production-orders/order-queries';
import { StatusChip } from '@/components/StatusChip';

/**
 * "Meine Aufträge" (docs/07_WIREFLOWS_UX.md A1) — the tablet entry point.
 * Only assigned orders appear, and that is enforced by the query, not by
 * this page (see listMyOrders).
 */
export default async function MyOrdersPage() {
  const actor = await requirePageAuth();
  const orders = await listMyOrders(actor);

  return (
    <main className="tablet">
      <h1>Meine Aufträge</h1>

      {orders.length === 0 && (
        <p className="empty-state">
          Ihnen ist derzeit kein laufender Produktionsauftrag zugewiesen.
        </p>
      )}

      {orders.map((order) => (
        <section key={order.id} className="card touch-card">
          <h2>{order.orderNumber}</h2>
          <p className="card-subtitle">
            {order.productName}
            {order.serialNumber ? ` · SN ${order.serialNumber}` : ''}
          </p>
          <p>
            {order.currentStep ? (
              <>
                Schritt {order.currentStep.stepNumber} von {order.totalSteps} ·{' '}
                <StatusChip status={order.currentStep.status} />
              </>
            ) : (
              <>
                {order.completedSteps} von {order.totalSteps} Schritten abgeschlossen ·{' '}
                <StatusChip status={order.status} />
              </>
            )}
          </p>

          {order.currentStep ? (
            <Link className="button-link" href={`/work-steps/${order.currentStep.id}`}>
              Öffnen →
            </Link>
          ) : (
            // No actionable step: either everything is done, or the next
            // step is still LOCKED because the server has not released it.
            // Deliberately no clickable "Weiter" here — docs/07 A7.
            <p className="muted">Aktuell ist für Sie kein Arbeitsschritt freigegeben.</p>
          )}
          <p>
            <Link className="action-link" href={`/production-orders/${order.id}`}>
              Auftragsdetails
            </Link>
          </p>
        </section>
      ))}
    </main>
  );
}
