'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createSiteAction,
  createDepartmentAction,
  createWorkCenterAction,
  createCustomerAction,
  inviteUserAction,
  assignRoleAction,
  revokeRoleAction,
  clearConfirmationPinAction,
  type AdminFormState,
} from '@/app/admin/actions';

// Siehe CreateProductForm: `'use server'`-Dateien exportieren nur async
// Funktionen, deshalb lebt der Initialzustand auf der Client-Seite.
const INITIAL_ADMIN_STATE: AdminFormState = { error: null, result: null };

/**
 * Die Formulare der Administration.
 *
 * Jedes hängt an `useActionState` und zeigt Ablehnungen inline — dieselbe
 * Bauart wie Export, Produktfreigabe und Dokumentbindung, und aus demselben
 * Grund: eine doppelte Kundennummer ist eine Antwort, kein Absturz.
 */

const ROLE_CODES = [
  'ADMIN',
  'QUALITY_MANAGER',
  'PROJECT_LEAD',
  'PRODUCTION_MANAGER',
  'WORKER',
  'INSPECTOR',
  'AUDITOR',
] as const;

function Feedback({ state, id }: { state: AdminFormState; id: string }) {
  return (
    <>
      {state.error && (
        <p id={id} role="alert" className="error-text">
          {state.error}
        </p>
      )}
      {state.result && (
        <p aria-live="polite" className="success-text">
          ✓ {state.result}
        </p>
      )}
    </>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="touch-target">
      {pending ? 'Wird gespeichert…' : label}
    </button>
  );
}

export function CreateSiteForm() {
  const [state, action] = useActionState(createSiteAction, INITIAL_ADMIN_STATE);
  return (
    <form action={action} className="card">
      <h3>Standort anlegen</h3>
      <label>
        Kürzel
        <input name="code" required maxLength={50} />
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        Ort (optional)
        <input name="location" maxLength={255} />
      </label>
      <label>
        Zeitzone (optional, Vorgabe UTC)
        <input name="timezone" maxLength={64} placeholder="Europe/Vienna" />
      </label>
      <Feedback state={state} id="site-form-error" />
      <Submit label="Standort anlegen" />
    </form>
  );
}

export function CreateDepartmentForm({ sites }: { sites: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createDepartmentAction, INITIAL_ADMIN_STATE);
  if (sites.length === 0) {
    // Ohne Standort gibt es nichts, woran eine Abteilung hängen könnte. Ein
    // Formular mit leerer Pflicht-Auswahlliste wäre eine Sackgasse.
    return <p className="empty-state">Erst einen Standort anlegen, dann Abteilungen.</p>;
  }
  return (
    <form action={action} className="card">
      <h3>Abteilung anlegen</h3>
      <label>
        Standort
        <select name="siteId" required defaultValue={sites[0]?.id}>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        Kürzel (optional, organisationsweit eindeutig)
        <input name="code" maxLength={50} />
      </label>
      <Feedback state={state} id="department-form-error" />
      <Submit label="Abteilung anlegen" />
    </form>
  );
}

export function CreateWorkCenterForm({
  departments,
}: {
  departments: { id: string; name: string; site: { name: string } }[];
}) {
  const [state, action] = useActionState(createWorkCenterAction, INITIAL_ADMIN_STATE);
  if (departments.length === 0) {
    return <p className="empty-state">Erst eine Abteilung anlegen, dann Arbeitsplätze.</p>;
  }
  return (
    <form action={action} className="card">
      <h3>Arbeitsplatz anlegen</h3>
      <label>
        Abteilung
        <select name="departmentId" required defaultValue={departments[0]?.id}>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.site.name} · {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        Betriebsmittel-Referenz (optional)
        <input name="equipmentRef" maxLength={255} />
      </label>
      <Feedback state={state} id="work-center-form-error" />
      <Submit label="Arbeitsplatz anlegen" />
    </form>
  );
}

export function CreateCustomerForm() {
  const [state, action] = useActionState(createCustomerAction, INITIAL_ADMIN_STATE);
  return (
    <form action={action} className="card">
      <h3>Kunde anlegen</h3>
      <label>
        Kundennummer
        <input name="customerNumber" required maxLength={50} />
      </label>
      <label>
        Name
        <input name="name" required maxLength={255} />
      </label>
      <label>
        E-Mail (optional)
        <input name="email" type="email" maxLength={255} />
      </label>
      <label>
        Telefon (optional)
        <input name="phone" maxLength={50} />
      </label>
      <label>
        Adresse (optional)
        <textarea name="address" rows={2} />
      </label>
      <Feedback state={state} id="customer-form-error" />
      <Submit label="Kunde anlegen" />
    </form>
  );
}

export function InviteUserForm({ sites }: { sites: { id: string; name: string }[] }) {
  const [state, action] = useActionState(inviteUserAction, INITIAL_ADMIN_STATE);
  return (
    <form action={action} className="card">
      <h3>Person einladen</h3>
      <p className="muted">
        Angelegt wird eine Einladung, kein fertiges Konto: die Anmeldung gehört dem
        Identitätsanbieter. Nach dem ersten Login setzt die Person ihre Bestätigungs-PIN selbst —
        vorher kann sie nichts abschließen.
      </p>
      <label>
        E-Mail
        <input name="email" type="email" required maxLength={255} />
      </label>
      <label>
        Anzeigename
        <input name="displayName" required maxLength={255} />
      </label>
      <label>
        Personalnummer
        <input name="employeeNumber" required maxLength={50} />
      </label>
      <label>
        Rolle
        <select name="roleCode" required defaultValue="WORKER">
          {ROLE_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <label>
        Standort (optional)
        <select name="siteId" defaultValue="">
          <option value="">— keiner —</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <Feedback state={state} id="invite-form-error" />
      <Submit label="Einladen" />
    </form>
  );
}

export function RoleForms({ userId, roleCodes }: { userId: string; roleCodes: string[] }) {
  const [assignState, assign] = useActionState(assignRoleAction, INITIAL_ADMIN_STATE);
  const [revokeState, revoke] = useActionState(revokeRoleAction, INITIAL_ADMIN_STATE);
  const assignable = ROLE_CODES.filter((code) => !roleCodes.includes(code));

  return (
    <div className="actions">
      {assignable.length > 0 && (
        <form action={assign}>
          <input type="hidden" name="userId" value={userId} />
          <select name="roleCode" aria-label="Rolle zuweisen" defaultValue={assignable[0]}>
            {assignable.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <button type="submit" className="link-button">
            zuweisen
          </button>
          <Feedback state={assignState} id={`assign-error-${userId}`} />
        </form>
      )}

      {roleCodes.length > 0 && (
        <form action={revoke}>
          <input type="hidden" name="userId" value={userId} />
          <select name="roleCode" aria-label="Rolle entziehen" defaultValue={roleCodes[0]}>
            {roleCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <button type="submit" className="link-button">
            entziehen
          </button>
          <Feedback state={revokeState} id={`revoke-error-${userId}`} />
        </form>
      )}
    </div>
  );
}

export function ClearPinForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(clearConfirmationPinAction, INITIAL_ADMIN_STATE);
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <label>
        Grund
        <input name="reason" required maxLength={500} placeholder="PIN vergessen" />
      </label>
      <button type="submit" className="link-button">
        PIN löschen
      </button>
      <Feedback state={state} id={`clear-pin-error-${userId}`} />
    </form>
  );
}
