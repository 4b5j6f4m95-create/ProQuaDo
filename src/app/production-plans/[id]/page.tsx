import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getProductionPlanRevision } from '@/domain/production-plans/plan-queries';
import {
  isPlanStructureEditable,
  type PlanRevisionStatus,
} from '@/domain/production-plans/plan-revision-status';
import {
  addPlanStepAction,
  addPlanStepDependencyAction,
  submitPlanForReviewAction,
  approvePlanAction,
  rejectPlanAction,
  releasePlanAction,
} from '../actions';

export default async function ProductionPlanRevisionPage({ params }: { params: { id: string } }) {
  const actor = await requirePageAuth();
  const revision = await getProductionPlanRevision(actor, params.id);
  const editable = isPlanStructureEditable(revision.status as PlanRevisionStatus);
  const nextStepNumber = revision.steps.length + 1;

  return (
    <main>
      <h1>
        Fertigungsplan-Revision {revision.revisionNumber} —{' '}
        <span className="status-badge">{revision.status}</span>
      </h1>

      <div className="actions">
        {revision.status === 'DRAFT' && (
          <form action={submitPlanForReviewAction}>
            <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
            <button type="submit">Zur Prüfung einreichen</button>
          </form>
        )}
        {revision.status === 'IN_REVIEW' && (
          <>
            <form action={approvePlanAction}>
              <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
              <button type="submit">Genehmigen</button>
            </form>
            <form action={rejectPlanAction}>
              <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
              <button type="submit">Ablehnen</button>
            </form>
          </>
        )}
        {revision.status === 'APPROVED' && (
          <form action={releasePlanAction}>
            <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
            <button type="submit">Freigeben</button>
          </form>
        )}
      </div>

      <h2>Arbeitsschritte</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Titel</th>
            <th>Foto</th>
            <th>Vier-Augen</th>
            <th>Abhängigkeiten</th>
          </tr>
        </thead>
        <tbody>
          {revision.steps.map((step) => (
            <tr key={step.id}>
              <td>{step.stepNumber}</td>
              <td>{step.title}</td>
              <td>{step.photoRequired ? '✓' : ''}</td>
              <td>{step.fourEyesRequired ? '✓' : ''}</td>
              <td>
                {step.predecessorLinks.length > 0
                  ? step.predecessorLinks
                      .map(
                        (dep) =>
                          revision.steps.find((s) => s.id === dep.predecessorStepId)?.stepNumber,
                      )
                      .join(', ')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editable && (
        <>
          <h3>Arbeitsschritt hinzufügen</h3>
          <form action={addPlanStepAction}>
            <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
            <input type="hidden" name="stepNumber" value={nextStepNumber} />
            <label>
              Titel
              <input name="title" required maxLength={255} />
            </label>
            <label>
              <input type="checkbox" name="photoRequired" /> Foto-Pflicht
            </label>
            <label>
              <input type="checkbox" name="fourEyesRequired" /> Vier-Augen-Pflicht
            </label>
            <button type="submit">Schritt {nextStepNumber} hinzufügen</button>
          </form>

          {revision.steps.length >= 2 && (
            <>
              <h3>Abhängigkeit hinzufügen</h3>
              <form action={addPlanStepDependencyAction}>
                <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
                <label>
                  Vorgänger
                  <select name="predecessorStepId" required>
                    {revision.steps.map((step) => (
                      <option key={step.id} value={step.id}>
                        {step.stepNumber}. {step.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Abhängiger Schritt
                  <select name="dependentStepId" required>
                    {revision.steps.map((step) => (
                      <option key={step.id} value={step.id}>
                        {step.stepNumber}. {step.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Abhängigkeit anlegen</button>
              </form>
            </>
          )}
        </>
      )}
    </main>
  );
}
