import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProject } from '@/domain/projects/project-queries';
import { listProductsForProject } from '@/domain/projects/lookup-queries';
import { ImportIfcForm } from './ImportIfcForm';

export default async function ImportIfcPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const [project, products] = await Promise.all([
    getProject(actor, params.id),
    listProductsForProject(actor, params.id),
  ]);

  return (
    <main>
      <h1>Gebäudemodell importieren — {project.name}</h1>

      <p>
        Aus einer IFC-Datei wird ein Fertigungsplan im Entwurf. Die Arbeitsschritte kommen aus dem
        Merkmal <code>Arbeitsvorgang</code> der Bauteile; die Zahl davor bestimmt die Reihenfolge in
        der Fertigungsstraße. Jeder erzeugte Schritt verlangt beim Abschluss die Bestätigung des
        Ausführenden per PIN.
      </p>

      {products.length === 0 ? (
        <p role="alert">
          Für dieses Projekt ist noch kein Produkt angelegt. Ein Fertigungsplan gehört immer zu
          einem Produkt — bitte zuerst eines anlegen.
        </p>
      ) : (
        <ImportIfcForm projectId={project.id} products={products} />
      )}
    </main>
  );
}
