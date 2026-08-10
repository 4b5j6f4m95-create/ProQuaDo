import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProject } from '@/domain/projects/project-queries';
import { listDocuments } from '@/domain/documents/document-queries';
import { listProductionPlans } from '@/domain/production-plans/plan-queries';
import { listProductionOrders } from '@/domain/production-orders/order-queries';
import { transitionProjectStatusAction } from '../actions';
import { isValidProjectTransition, type ProjectStatus } from '@/domain/projects/project-status';
import { StatusChip } from '@/components/StatusChip';

const ALL_STATUSES: ProjectStatus[] = [
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
];

export default async function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const [project, documents, plans, orders] = await Promise.all([
    getProject(actor, params.id),
    listDocuments(actor, { projectId: params.id }),
    listProductionPlans(actor, { projectId: params.id }),
    listProductionOrders(actor, { projectId: params.id }),
  ]);

  const nextStatuses = ALL_STATUSES.filter((s) =>
    isValidProjectTransition(project.status as ProjectStatus, s),
  );

  return (
    <main>
      <p>
        <Link href="/projects">← Projekte</Link>
      </p>
      <h1>
        {project.projectNumber} — {project.name}
      </h1>
      <p>
        Kunde: {project.customer.name} · Status:{' '}
        <span className="status-badge">{project.status}</span>
      </p>

      {nextStatuses.length > 0 && (
        <div className="actions">
          {nextStatuses.map((status) => (
            <form key={status} action={transitionProjectStatusAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="toStatus" value={status} />
              <input type="hidden" name="expectedVersion" value={project.version} />
              <button type="submit">→ {status}</button>
            </form>
          ))}
        </div>
      )}

      <h2>Dokumente</h2>
      <table>
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Titel</th>
            <th>Aktuelle Revision</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id}>
              <td>{doc.documentNumber}</td>
              <td>
                <Link href={`/documents/${doc.id}`}>{doc.title}</Link>
              </td>
              <td>
                {doc.revisions[0] ? (
                  <>
                    Rev. {doc.revisions[0].revisionNumber}{' '}
                    <span className="status-badge">{doc.revisions[0].status}</span>
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link href={`/projects/${project.id}/documents/new`}>+ Dokument hochladen</Link>

      <h2>Fertigungspläne</h2>
      <table>
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Name</th>
            <th>Aktuelle Revision</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.planNumber}</td>
              <td>{plan.name}</td>
              <td>
                {plan.revisions[0] ? (
                  <Link href={`/production-plans/${plan.revisions[0].id}`}>
                    Rev. {plan.revisions[0].revisionNumber}{' '}
                    <span className="status-badge">{plan.revisions[0].status}</span>
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link href={`/projects/${project.id}/plans/new`}>+ Fertigungsplan anlegen</Link>

      <h2>Produktionsaufträge</h2>
      <table>
        <thead>
          <tr>
            <th>Auftrag</th>
            <th>Produkt</th>
            <th>Seriennummer</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <Link href={`/production-orders/${order.id}`}>{order.orderNumber}</Link>
              </td>
              <td>{order.product.name}</td>
              <td>{order.serialNumber ?? '—'}</td>
              <td>
                <StatusChip status={order.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link href={`/projects/${project.id}/orders/new`}>+ Produktionsauftrag anlegen</Link>
    </main>
  );
}
