import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listProjects } from '@/domain/projects/project-queries';
import { listSites, listCustomers } from '@/domain/projects/lookup-queries';
import { createProjectAction } from './actions';

export default async function ProjectsPage() {
  const actor = await requirePageAuth();
  const [projects, sites, customers] = await Promise.all([
    listProjects(actor),
    listSites(actor),
    listCustomers(actor),
  ]);

  return (
    <main>
      <h1>Projekte</h1>

      <table>
        <thead>
          <tr>
            <th>Nummer</th>
            <th>Name</th>
            <th>Kunde</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>{project.projectNumber}</td>
              <td>
                <Link href={`/projects/${project.id}`}>{project.name}</Link>
              </td>
              <td>{project.customer.name}</td>
              <td>
                <span className="status-badge">{project.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Neues Projekt anlegen</h2>
      <form action={createProjectAction}>
        <label>
          Projektnummer
          <input name="projectNumber" required maxLength={50} />
        </label>
        <label>
          Name
          <input name="name" required maxLength={255} />
        </label>
        <label>
          Standort
          <select name="siteId" required>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kunde
          <select name="customerId" required>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Beschreibung
          <textarea name="description" rows={3} />
        </label>
        <button type="submit">Projekt anlegen</button>
      </form>
    </main>
  );
}
