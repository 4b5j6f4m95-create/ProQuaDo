import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProject } from '@/domain/projects/project-queries';
import { listProductsForProject } from '@/domain/projects/lookup-queries';
import { createProductionPlanAction } from '@/app/production-plans/actions';

export default async function NewProductionPlanPage({ params }: { params: { id: string } }) {
  const actor = await requirePageAuth();
  const [project, products] = await Promise.all([
    getProject(actor, params.id),
    listProductsForProject(actor, params.id),
  ]);

  return (
    <main>
      <h1>Neuer Fertigungsplan — {project.name}</h1>
      <form action={createProductionPlanAction}>
        <input type="hidden" name="projectId" value={project.id} />
        <label>
          Plannummer
          <input name="planNumber" required maxLength={50} />
        </label>
        <label>
          Name
          <input name="name" required maxLength={255} />
        </label>
        <label>
          Produkt
          <select name="productId" required>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Plan anlegen (Rev. 01, DRAFT)</button>
      </form>
    </main>
  );
}
