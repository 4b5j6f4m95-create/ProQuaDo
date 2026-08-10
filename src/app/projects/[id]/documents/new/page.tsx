import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProject } from '@/domain/projects/project-queries';
import { createDocumentAction } from '@/app/documents/actions';

export default async function NewDocumentPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const project = await getProject(actor, params.id);

  return (
    <main>
      <h1>Neues Dokument — {project.name}</h1>
      <form action={createDocumentAction}>
        <input type="hidden" name="projectId" value={project.id} />
        <label>
          Dokumentnummer
          <input name="documentNumber" required maxLength={50} />
        </label>
        <label>
          Titel
          <input name="title" required maxLength={255} />
        </label>
        <label>
          Kategorie
          <select name="category">
            <option value="DRAWING">Zeichnung</option>
            <option value="INSTRUCTION">Arbeitsanweisung</option>
            <option value="SPECIFICATION">Spezifikation</option>
            <option value="CHECKLIST">Checkliste</option>
          </select>
        </label>
        <button type="submit">Dokument anlegen (Rev. 01, DRAFT)</button>
      </form>
    </main>
  );
}
