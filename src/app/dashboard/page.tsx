import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getDashboard } from '@/domain/dashboard/dashboard-queries';
import { StatusChip } from '@/components/StatusChip';

/** Dashboard — docs/07_WIREFLOWS_UX.md B1. */
export default async function DashboardPage() {
  const actor = await requirePageAuth();
  const { metrics, openDecisions, orders } = await getDashboard(actor);

  return (
    <main>
      <h1>Übersicht</h1>

      <section className="metric-row">
        <MetricCard label="Aktive Aufträge" value={metrics.activeOrders} />
        <MetricCard label="Verspätete Aufträge" value={metrics.overdueOrders} warn />
        <MetricCard label="Offene Abweichungen" value={metrics.openNonConformances} warn />
        <MetricCard label="Gesperrte Aufträge" value={metrics.blockedOrders} warn />
      </section>

      <h2>Offene Entscheidungen ({openDecisions.length})</h2>
      {openDecisions.length === 0 ? (
        <p className="notice">Derzeit wartet keine Entscheidung auf Sie.</p>
      ) : (
        openDecisions.map((decision) => (
          <section key={`${decision.kind}-${decision.id}`} className="card">
            <p>
              <strong>{decision.label}</strong> · {decision.detail}
            </p>
            <p className="muted">Offen seit {decision.since.toLocaleString('de-DE')}</p>
            <Link className="button-link" href={decision.href}>
              Entscheiden →
            </Link>
          </section>
        ))
      )}

      <h2>Auftragsübersicht</h2>
      {orders.length === 0 ? (
        <p className="notice">Keine laufenden Aufträge.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Auftrag</th>
              <th>Produkt</th>
              <th>Fortschritt</th>
              <th>Status</th>
              <th>Verantwortlich</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.productionOrderId}>
                <td>
                  <Link href={`/production-orders/${order.productionOrderId}`}>
                    {order.orderNumber}
                  </Link>
                  {order.isOverdue && <span className="status-chip status-blocked">verspätet</span>}
                </td>
                <td>{order.productName}</td>
                <td>
                  {order.progressPercent}% ({order.completedSteps}/{order.totalSteps})
                  {order.pendingSteps > 0 && (
                    // docs/07 B1: locally finished steps are shown, but never
                    // counted into the percentage.
                    <>
                      <br />
                      <span className="muted">
                        + {order.pendingSteps} lokal abgeschlossen, Serverprüfung ausstehend
                      </span>
                    </>
                  )}
                </td>
                <td>
                  <StatusChip status={order.status} />
                </td>
                <td>{order.assignees.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function MetricCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`card metric-card${warn && value > 0 ? ' blocked-card' : ''}`}>
      <p className="metric-value">{value}</p>
      <p className="metric-label">{label}</p>
    </div>
  );
}
