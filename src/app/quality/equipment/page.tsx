import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { listMeasuringEquipment } from '@/domain/quality/measuring-equipment';
import { createMeasuringEquipmentAction, recordCalibrationAction } from '../actions';

/** Prüfmittelverwaltung (docs/07 C3). */
export default async function MeasuringEquipmentPage() {
  const actor = await requirePageAuth();
  const equipment = await listMeasuringEquipment(actor);

  return (
    <main>
      <h1>Qualitätsmanagement · Prüfmittel</h1>

      <table>
        <thead>
          <tr>
            <th>Nr.</th>
            <th>Bezeichnung</th>
            <th>Kalibrierung</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {equipment.map((item) => (
            <tr key={item.id}>
              <td>{item.equipmentNumber}</td>
              <td>
                {item.name}
                {item.location ? ` · ${item.location}` : ''}
              </td>
              <td>
                {item.nextCalibrationDueAt
                  ? `bis ${item.nextCalibrationDueAt.toLocaleDateString('de-DE')}`
                  : '—'}
              </td>
              <td>
                {/* Status is text + icon, never colour alone (docs/07 F). */}
                {item.isUsable ? (
                  <span className="status-chip status-done">✓ einsatzbereit</span>
                ) : (
                  <span className="status-chip status-blocked">
                    🔴 gesperrt: {item.blockReason}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {equipment.length === 0 && <p className="empty-state">Noch keine Prüfmittel erfasst.</p>}

      <h2>Prüfmittel anlegen</h2>
      <form action={createMeasuringEquipmentAction}>
        <label>
          Nummer
          <input name="equipmentNumber" required maxLength={50} placeholder="PM-042" />
        </label>
        <label>
          Bezeichnung
          <input name="name" required maxLength={255} placeholder="Messschieber" />
        </label>
        <label>
          Hersteller
          <input name="manufacturer" maxLength={255} />
        </label>
        <label>
          Einheit
          <input name="measurementUnit" maxLength={20} placeholder="mm" />
        </label>
        <label>
          Standort
          <input name="location" maxLength={255} />
        </label>
        <button type="submit">Anlegen</button>
      </form>

      {equipment.length > 0 && (
        <>
          <h2>Kalibrierung erfassen</h2>
          <form action={recordCalibrationAction}>
            <label>
              Prüfmittel
              <select name="measuringEquipmentId" required>
                {equipment.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.equipmentNumber} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kalibriert am
              <input name="calibratedAt" type="date" required />
            </label>
            <label>
              Nächste Kalibrierung fällig
              <input name="nextCalibrationDueAt" type="date" required />
            </label>
            <label>
              Kalibriert durch
              <input name="calibratedBy" maxLength={255} />
            </label>
            <button type="submit">Kalibrierung speichern</button>
          </form>
        </>
      )}
    </main>
  );
}
