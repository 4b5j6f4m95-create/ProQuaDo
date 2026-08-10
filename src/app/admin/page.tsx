import { requirePageAuth } from '@/lib/authz/require-page-auth';
import {
  listSites,
  listCustomers,
  listDepartmentsWithWorkCenters,
} from '@/domain/projects/lookup-queries';
import { listUsersForAdministration } from '@/domain/identity/user-administration';
import {
  CreateSiteForm,
  CreateDepartmentForm,
  CreateWorkCenterForm,
  CreateCustomerForm,
  InviteUserForm,
  RoleForms,
  ClearPinForm,
} from '@/components/AdminForms';

/**
 * Administration: Standorte, Kunden, Menschen.
 *
 * Der Bildschirm, ohne den ein Pilot ohne Altsystem nicht anfangen kann —
 * bis Phase 7 entstanden alle drei ausschließlich im Seed. Die Reihenfolge auf
 * der Seite ist die, in der sie gebraucht werden: ohne Standort und Kunde kein
 * Projekt, ohne Benutzer niemand, der daran arbeitet.
 *
 * **Produkte stehen hier nicht.** Sie hängen am Projekt und werden dort
 * angelegt, von der Projektleitung — `product.manage` liegt nicht bei der
 * Administration.
 */
export default async function AdminPage() {
  const actor = await requirePageAuth();
  const [users, sites, customers, departments] = await Promise.all([
    listUsersForAdministration(actor),
    listSites(actor),
    listCustomers(actor),
    listDepartmentsWithWorkCenters(actor),
  ]);

  return (
    <main>
      <h1>Administration</h1>

      <h2>Standorte</h2>
      {sites.length === 0 ? (
        <p className="empty-state">
          Noch kein Standort. Ohne Standort lässt sich kein Projekt anlegen.
        </p>
      ) : (
        <ul>
          {sites.map((site) => (
            <li key={site.id}>
              <strong>{site.code}</strong> — {site.name}
              {site.location ? ` (${site.location})` : ''} · {site.timezone}
            </li>
          ))}
        </ul>
      )}
      <CreateSiteForm />

      {/* Abteilung und Arbeitsplatz stehen direkt hinter dem Standort, weil
          sie an ihm hängen — und der Planschritt verweist optional auf beide. */}
      <h2>Abteilungen und Arbeitsplätze</h2>
      {departments.length === 0 ? (
        <p className="empty-state">
          Noch keine Abteilung. Ein Planschritt kann ohne sie auskommen — wer Zuständigkeiten
          abbilden will, legt hier an.
        </p>
      ) : (
        <ul>
          {departments.map((department) => (
            <li key={department.id}>
              <strong>{department.site.name}</strong> · {department.name}
              {department.code ? ` (${department.code})` : ''}
              {department.workCenters.length > 0 && (
                <ul>
                  {department.workCenters.map((workCenter) => (
                    <li key={workCenter.id}>{workCenter.name}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <CreateDepartmentForm sites={sites} />
      <CreateWorkCenterForm departments={departments} />

      <h2>Kunden</h2>
      {customers.length === 0 ? (
        <p className="empty-state">Noch kein Kunde. Ohne Kunde lässt sich kein Projekt anlegen.</p>
      ) : (
        <ul>
          {customers.map((customer) => (
            <li key={customer.id}>
              <strong>{customer.customerNumber}</strong> — {customer.name}
            </li>
          ))}
        </ul>
      )}
      <CreateCustomerForm />

      <h2>Personen</h2>
      <table>
        <thead>
          <tr>
            <th>E-Mail</th>
            <th>Name</th>
            <th>Personalnr.</th>
            <th>Rollen</th>
            <th>Status</th>
            <th>PIN</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.displayName ?? '—'}</td>
              <td>{user.employee?.employeeNumber ?? '—'}</td>
              <td>
                {user.roleCodes.join(', ') || '—'}
                <RoleForms userId={user.id} roleCodes={user.roleCodes} />
              </td>
              <td>
                {user.awaitingFirstLogin ? (
                  <span className="status-badge">wartet auf ersten Login</span>
                ) : (
                  <span className="status-badge">verknüpft</span>
                )}
              </td>
              <td>
                {user.hasConfirmationPin ? (
                  <ClearPinForm userId={user.id} />
                ) : (
                  // Ohne PIN kann die Person nichts abschließen — das ist der
                  // Normalzustand direkt nach der Einladung und kein Fehler,
                  // aber es muss sichtbar sein.
                  <span className="warning-text">keine PIN gesetzt</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <InviteUserForm sites={sites} />
    </main>
  );
}
