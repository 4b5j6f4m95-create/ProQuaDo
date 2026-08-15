import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getDashboard } from '@/domain/dashboard/dashboard-queries';
import { StatusChip } from '@/components/StatusChip';

/** Dashboard — docs/07_WIREFLOWS_UX.md B1. */
export default async function DashboardPage() {
  const actor = await requirePageAuth();
  const { metrics, openDecisions, orders } = await getDashboard(actor);
  // Der Knopf des Entscheidungsbands führt zur ersten wartenden
  // Entscheidung. Über den Index statt über eine Zusicherung: die Liste
  // kann leer sein, und dann gibt es das Band ohnehin nicht.
  const firstDecision = openDecisions[0];

  return (
    <main>
      {/* „Von wann" gehört zu jeder Zahl, die hier steht — Entwurf 1e. */}
      <div className="page-head">
        <h1>Übersicht</h1>
        <p className="page-subtitle">
          Stand {new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      </div>

      <section className="metric-row">
        <MetricCard label="Aktive Aufträge" value={metrics.activeOrders} />
        <MetricCard label="Verspätete Aufträge" value={metrics.overdueOrders} tone="warn" />
        <MetricCard label="Offene Abweichungen" value={metrics.openNonConformances} tone="danger" />
        <MetricCard label="Gesperrte Aufträge" value={metrics.blockedOrders} tone="danger" />
      </section>

      {/* Ein Band statt einer Karte je Vorgang (Entwurf 1e). Bei zwei
          Entscheidungen sind zwei Karten Platzverschwendung; bei acht
          wären acht Karten eine Wand, durch die niemand mehr sieht, dass
          überhaupt etwas dringend ist. Die Liste bleibt vollständig —
          gekürzt wird nichts, nur enger gesetzt. */}
      <h2>Offene Entscheidungen ({openDecisions.length})</h2>
      {openDecisions.length === 0 ? (
        // **Nicht `.notice`.** Vorher stand hier eine bernsteinfarbene
        // Hinweisbox — und das ging, solange der besetzte Zustand weiße
        // Karten waren. Seit das Band selbst bernsteinfarben ist, sähe
        // „nichts zu tun" genauso alarmierend aus wie „zwei
        // Entscheidungen warten". Eine Farbe, die beide Zustände meint,
        // meint keinen.
        <p className="muted">Derzeit wartet keine Entscheidung auf Sie.</p>
      ) : (
        <div className="decision-banner">
          <div>
            {openDecisions.map((decision, index) => (
              <span key={`${decision.kind}-${decision.id}`}>
                {index > 0 && ' · '}
                <strong>{decision.label}</strong> — {decision.detail}{' '}
                <span className="muted">(seit {decision.since.toLocaleDateString('de-DE')})</span>
              </span>
            ))}
          </div>
          {/* Führt zur ersten wartenden Entscheidung. Ein Band mit einem
              Knopf, der irgendwohin führt, wäre schlechter als keiner. */}
          {firstDecision && (
            <Link className="button-link" href={firstDecision.href}>
              Jetzt entscheiden →
            </Link>
          )}
        </div>
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
                  {/* Balken **und** Zahl (Entwurf 1e). Ein Balken allein
                      zwingt zum Schätzen, und „6 von 18" ist die Auskunft,
                      nicht „ungefähr ein Drittel". Der Balken ist
                      `aria-hidden`: er wiederholt für das Auge, was die
                      Zahl daneben schon sagt — vorgelesen wäre er Lärm. */}
                  <span
                    className={`progress-bar${
                      order.isOverdue
                        ? ' is-overdue'
                        : order.completedSteps === 0
                          ? ' is-planned'
                          : ''
                    }`}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${order.progressPercent}%` }} />
                  </span>
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

/**
 * Eine Zelle des Kennzahlenstreifens.
 *
 * `tone` färbt **nur bei einem Wert über null**. Eine rote Null ist keine
 * Warnung, sondern ein gelöstes Problem — und ein Streifen, in dem drei
 * von vier Zellen dauerhaft rot leuchten, weil sie es der Sorte nach sind,
 * hört nach zwei Tagen auf, gelesen zu werden.
 */
function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'danger';
}) {
  const active = tone && value > 0 ? (tone === 'warn' ? ' warn-card' : ' blocked-card') : '';
  return (
    <div className={`metric-card${active}`}>
      <p className="metric-value">{value}</p>
      <p className="metric-label">{label}</p>
    </div>
  );
}
