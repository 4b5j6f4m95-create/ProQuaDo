import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProductionOrder } from '@/domain/production-orders/order-queries';
import { listAssignableUsers } from '@/domain/projects/lookup-queries';
import {
  isValidProductionOrderTransition,
  type ProductionOrderStatus,
} from '@/domain/production-orders/production-order-status';
import { StatusChip } from '@/components/StatusChip';
import {
  assignProductionOrderAction,
  releaseProductionOrderAction,
  transitionProductionOrderStatusAction,
} from '../actions';

/** Order detail for planning/production management: assignments, release,
 *  and the full step list with server-owned statuses. */
export default async function ProductionOrderPage({ params }: { params: { id: string } }) {
  const actor = await requirePageAuth();
  const order = await getProductionOrder(actor, params.id);

  // Only roles that may assign can see the user picker at all; everyone
  // else gets the page without it (the server would reject them anyway).
  const assignableUsers = await listAssignableUsers(actor).catch(() => []);

  const canPlan = isValidProductionOrderTransition(
    order.status as ProductionOrderStatus,
    'PLANNED',
  );
  const canRelease = isValidProductionOrderTransition(
    order.status as ProductionOrderStatus,
    'RELEASED',
  );

  return (
    <main>
      <p>
        <Link href={`/projects/${order.project.id}`}>← {order.project.name}</Link>
      </p>
      <h1>
        {order.orderNumber} — {order.product.name}
      </h1>
      <p>
        <StatusChip status={order.status} />
        {order.serialNumber ? ` · SN ${order.serialNumber}` : ''} · Menge {order.quantity}
      </p>
      <p>
        Fertigungsplan:{' '}
        <Link href={`/production-plans/${order.productionPlanRevision.id}`}>
          Rev. {order.productionPlanRevision.revisionNumber}
        </Link>{' '}
        <StatusChip status={order.productionPlanRevision.status} />
      </p>

      <div className="actions">
        {canPlan && (
          <form action={transitionProductionOrderStatusAction}>
            <input type="hidden" name="productionOrderId" value={order.id} />
            <input type="hidden" name="toStatus" value="PLANNED" />
            <input type="hidden" name="expectedVersion" value={order.version} />
            <button type="submit">Einplanen</button>
          </form>
        )}
        {canRelease && (
          <form action={releaseProductionOrderAction}>
            <input type="hidden" name="productionOrderId" value={order.id} />
            <input type="hidden" name="expectedVersion" value={order.version} />
            <button type="submit">Auftrag freigeben</button>
          </form>
        )}
      </div>

      <h2>Zuweisungen</h2>
      {order.assignments.length === 0 ? (
        <p className="muted">Noch niemand zugewiesen — ohne Zuweisung kann niemand ausführen.</p>
      ) : (
        <ul>
          {order.assignments.map((assignment) => (
            <li key={assignment.id}>
              {assignment.user.displayName ?? assignment.user.email}
              {assignment.role ? ` (${assignment.role})` : ''}
            </li>
          ))}
        </ul>
      )}

      {assignableUsers.length > 0 && (
        <form action={assignProductionOrderAction}>
          <input type="hidden" name="productionOrderId" value={order.id} />
          <label>
            Mitarbeiter
            <select name="userId" required>
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName ?? user.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rolle im Auftrag
            <input name="role" placeholder="z. B. EXECUTOR" maxLength={50} />
          </label>
          <button type="submit">Zuweisen</button>
        </form>
      )}

      <h2>Arbeitsschritte</h2>
      {order.workStepInstances.length === 0 ? (
        <p className="muted">
          Die Arbeitsschritte entstehen bei der Freigabe des Auftrags aus der Planrevision.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Titel</th>
              <th>Status</th>
              <th>Vier-Augen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {order.workStepInstances.map((instance) => (
              <tr key={instance.id}>
                <td>{instance.stepNumber}</td>
                <td>{instance.planStep.title}</td>
                <td>
                  <StatusChip status={instance.status} />
                </td>
                <td>{instance.planStep.fourEyesRequired ? '✓' : ''}</td>
                <td>
                  <Link href={`/work-steps/${instance.id}`}>Öffnen</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
