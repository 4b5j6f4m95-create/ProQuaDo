import { requirePageAuth } from '@/lib/authz/require-page-auth';
import {
  getProductionPlanRevision,
  listBindableDocumentRevisions,
} from '@/domain/production-plans/plan-queries';
import {
  isPlanStructureEditable,
  type PlanRevisionStatus,
} from '@/domain/production-plans/plan-revision-status';
import { BindDocumentForm, UnbindDocumentButton } from '@/components/StepDocumentBindingForms';
import {
  addChecklistItemAction,
  addInspectionCharacteristicAction,
  addPhotoRequirementAction,
  addPlanStepAction,
  addPlanStepDependencyAction,
  submitPlanForReviewAction,
  approvePlanAction,
  rejectPlanAction,
  releasePlanAction,
} from '../actions';

export default async function ProductionPlanRevisionPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const revision = await getProductionPlanRevision(actor, params.id);
  const editable = isPlanStructureEditable(revision.status as PlanRevisionStatus);
  const nextStepNumber = revision.steps.length + 1;
  // Only needed while the plan can still be edited — a released plan shows
  // its bindings but offers no choices.
  const bindableRevisions = editable
    ? await listBindableDocumentRevisions(actor, revision.productionPlan.projectId)
    : [];

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
      {revision.steps.map((step) => (
        <section key={step.id} className="card">
          <h3>
            {step.stepNumber}. {step.title}
          </h3>
          <p>
            Vorgänger:{' '}
            {step.predecessorLinks.length > 0
              ? step.predecessorLinks
                  .map(
                    (dep) => revision.steps.find((s) => s.id === dep.predecessorStepId)?.stepNumber,
                  )
                  .join(', ')
              : '—'}
            {step.fourEyesRequired ? ' · 👥 Vier-Augen-Pflicht' : ''}
          </p>

          <h4>Checkliste</h4>
          <ul>
            {step.checklistItems.map((item) => (
              <li key={item.id}>
                {item.itemNumber}. {item.text}
                {item.isRequired ? '' : ' (optional)'}
              </li>
            ))}
            {step.checklistItems.length === 0 && <li className="muted">—</li>}
          </ul>

          <h4>Fotoanforderungen</h4>
          <ul>
            {step.photoRequirements.map((requirement) => (
              <li key={requirement.id}>
                📷 {requirement.category}: min. {requirement.minCount}
                {requirement.maxCount ? `, max. ${requirement.maxCount}` : ''}
              </li>
            ))}
            {step.photoRequirements.length === 0 && (
              <li className="muted">{step.photoRequired ? 'mindestens ein Foto' : '—'}</li>
            )}
          </ul>

          <h4>Prüfmerkmale</h4>
          <ul>
            {step.inspectionCharacteristics.map((characteristic) => (
              <li key={characteristic.id}>
                📏 {characteristic.name}: {characteristic.nominalValue?.toString() ?? '—'}
                {characteristic.unit ? ` ${characteristic.unit}` : ''} (Toleranz{' '}
                {characteristic.lowerLimit?.toString() ?? '−∞'} –{' '}
                {characteristic.upperLimit?.toString() ?? '+∞'})
              </li>
            ))}
            {step.inspectionCharacteristics.length === 0 && <li className="muted">—</li>}
          </ul>

          {/* Which released revision is binding for this step. The list a
              worker sees on the tablet, and the set the offline revision
              conflict is computed against (Abnahmeszenario C). */}
          <h4>Verbindliche Dokumente</h4>
          <ul>
            {step.documentBindings.map((binding) => (
              <li key={binding.id}>
                📄 {binding.documentRevision.document.documentNumber} Rev.{' '}
                {binding.documentRevision.revisionNumber} — {binding.documentRevision.title}
                {binding.pageNumber ? `, S. ${binding.pageNumber}` : ''}
                {binding.markerLabel ? ` (${binding.markerLabel})` : ''}
                {editable && (
                  <UnbindDocumentButton
                    productionPlanRevisionId={revision.id}
                    planStepId={step.id}
                    bindingId={binding.id}
                  />
                )}
              </li>
            ))}
            {step.documentBindings.length === 0 && <li className="muted">—</li>}
          </ul>

          {editable && (
            <div className="requirement-forms">
              <form action={addChecklistItemAction}>
                <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
                <input type="hidden" name="planStepId" value={step.id} />
                <input type="hidden" name="itemNumber" value={step.checklistItems.length + 1} />
                <label>
                  Checklistenpunkt
                  <input name="text" required maxLength={500} />
                </label>
                <button type="submit">+ Checklistenpunkt</button>
              </form>

              <form action={addPhotoRequirementAction}>
                <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
                <input type="hidden" name="planStepId" value={step.id} />
                <label>
                  Fotokategorie
                  <input name="category" required maxLength={50} placeholder="TYPENSCHILD" />
                </label>
                <label>
                  Mindestanzahl
                  <input name="minCount" type="number" min={1} defaultValue={1} />
                </label>
                <label>
                  Höchstanzahl (optional)
                  <input name="maxCount" type="number" min={1} />
                </label>
                <button type="submit">+ Fotoanforderung</button>
              </form>

              <form action={addInspectionCharacteristicAction}>
                <input type="hidden" name="productionPlanRevisionId" value={revision.id} />
                <input type="hidden" name="planStepId" value={step.id} />
                <input
                  type="hidden"
                  name="characteristicNumber"
                  value={step.inspectionCharacteristics.length + 1}
                />
                <label>
                  Prüfmerkmal
                  <input name="name" required maxLength={255} placeholder="Spaltmaß" />
                </label>
                <label>
                  Sollwert
                  <input name="nominalValue" inputMode="decimal" placeholder="2.0" />
                </label>
                <label>
                  Untere Toleranz
                  <input name="lowerLimit" inputMode="decimal" placeholder="1.8" />
                </label>
                <label>
                  Obere Toleranz
                  <input name="upperLimit" inputMode="decimal" placeholder="2.2" />
                </label>
                <label>
                  Einheit
                  <input name="unit" maxLength={20} placeholder="mm" />
                </label>
                <button type="submit">+ Prüfmerkmal</button>
              </form>

              {bindableRevisions.length > 0 ? (
                // Keyed on the number of bindings so the form remounts — and
                // its message resets — whenever the list it talks about
                // changes. Without this, "Revision 01 ist bereits verknüpft"
                // survives the removal of that very binding and then states
                // something untrue.
                <BindDocumentForm
                  key={step.documentBindings.length}
                  productionPlanRevisionId={revision.id}
                  planStepId={step.id}
                  revisions={bindableRevisions}
                />
              ) : (
                // Said plainly rather than shown as an empty dropdown: the
                // usual reason is that the project's drawings exist but have
                // not been released yet, and that is a different problem from
                // "there are no documents".
                <p className="muted">
                  Keine freigegebene Dokumentrevision in diesem Projekt — erst freigeben, dann
                  binden.
                </p>
              )}
            </div>
          )}
        </section>
      ))}

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
