import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProject } from '@/domain/projects/project-queries';
import { listReleasedPlanRevisionsForProject } from '@/domain/projects/lookup-queries';
import { createProductionOrderAction } from '@/app/production-orders/actions';

export default async function NewProductionOrderPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const [project, planRevisions] = await Promise.all([
    getProject(actor, params.id),
    listReleasedPlanRevisionsForProject(actor, params.id),
  ]);

  return (
    <main>
      <p>
        <Link href={`/projects/${project.id}`}>← {project.name}</Link>
      </p>
      <h1>Neuer Produktionsauftrag — {project.name}</h1>

      {planRevisions.length === 0 ? (
        <p className="notice">
          Für dieses Projekt ist noch keine Fertigungsplan-Revision freigegeben. Ein
          Produktionsauftrag kann nur gegen einen freigegebenen Plan angelegt werden.
        </p>
      ) : (
        <form action={createProductionOrderAction}>
          <input type="hidden" name="projectId" value={project.id} />
          <label>
            Auftragsnummer
            <input name="orderNumber" required maxLength={50} placeholder="AUF-2026-0001" />
          </label>
          <label>
            Fertigungsplan (freigegeben)
            {/* Value carries productId and revisionId together: the plan
                revision determines the product, and the server re-validates
                that they match (createProductionOrder). */}
            <select name="planSelection" required>
              {planRevisions.map((revision) => (
                <option
                  key={revision.id}
                  value={`${revision.productionPlan.productId}:${revision.id}`}
                >
                  {revision.productionPlan.product.name} · {revision.productionPlan.planNumber} Rev.{' '}
                  {revision.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seriennummer
            <input name="serialNumber" maxLength={50} placeholder="SN-2026-00001" />
          </label>
          <label>
            Chargennummer
            <input name="batchNumber" maxLength={50} />
          </label>
          <label>
            Menge
            <input name="quantity" type="number" min={1} defaultValue={1} />
          </label>
          <button type="submit">Auftrag anlegen (DRAFT)</button>
        </form>
      )}
    </main>
  );
}
