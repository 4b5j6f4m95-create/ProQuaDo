// Pure requirement evaluation — no database, no I/O. This is the single
// definition of "is this step complete?", used in three places that must
// never disagree:
//   1. the tablet UI, to enable/disable the "Abschließen" button and show
//      what is still missing (docs/07 A2),
//   2. validateAndCompleteWorkStep(), as the authoritative server-side gate
//      (docs/03 "Abschlussvalidierung"),
//   3. unit tests, which can exercise every combination without a database.
//
// Point 2 is the one that counts: the UI's evaluation is a convenience, and
// a client that skips it gains nothing, because the server re-evaluates
// from its own data before anything is marked COMPLETED.

export interface ChecklistItemDefinition {
  id: string;
  itemNumber: number;
  text: string;
  isRequired: boolean;
}

export interface PhotoRequirementDefinition {
  id: string;
  category: string;
  minCount: number;
  maxCount: number | null;
}

export interface InspectionCharacteristicDefinition {
  id: string;
  characteristicNumber: number;
  name: string;
  isRequired: boolean;
  unit: string | null;
}

export interface StepRequirementDefinition {
  /** PlanStep.photoRequired — the coarse switch. True with an empty
   *  photoRequirements list means "at least one photo, any category". */
  photoRequired: boolean;
  signatureRequired: boolean;
  fourEyesRequired: boolean;
  checklistItems: readonly ChecklistItemDefinition[];
  photoRequirements: readonly PhotoRequirementDefinition[];
  inspectionCharacteristics: readonly InspectionCharacteristicDefinition[];
}

export interface CapturedChecklistResponse {
  checklistItemId: string;
  response: string; // OK | NOK | N/A
}

export interface CapturedPhoto {
  photoRequirementId: string | null;
  photoCategory: string | null;
  /** Only COMPLETED uploads count as evidence — a photo whose upload broke
   *  off or whose hash did not verify is not evidence (Negativtest #7). */
  uploadStatus: string;
}

export interface CapturedMeasurement {
  inspectionCharacteristicId: string;
  isWithinTolerance: boolean;
  measuredValue: string;
}

export interface CapturedEvidence {
  checklistResponses: readonly CapturedChecklistResponse[];
  photos: readonly CapturedPhoto[];
  measurements: readonly CapturedMeasurement[];
  hasConfirmation: boolean;
}

export interface RequirementGap {
  code: string;
  detail: string;
  affectedField?: string;
}

export interface RequirementEvaluation {
  /** True only when nothing is missing AND no measurement is out of
   *  tolerance — i.e. the step may be completed. */
  satisfied: boolean;
  /** Missing/unanswered obligations (→ MISSING_REQUIRED_EVIDENCE, 422). */
  gaps: RequirementGap[];
  /** Recorded but out-of-tolerance measurements (→ MEASUREMENT_OUT_OF_TOLERANCE,
   *  422). Kept separate because the two map to different API error codes
   *  and, from Phase 4 on, to different consequences (NCR vs. re-capture). */
  toleranceViolations: RequirementGap[];
}

export function evaluateStepRequirements(
  definition: StepRequirementDefinition,
  evidence: CapturedEvidence,
): RequirementEvaluation {
  const gaps: RequirementGap[] = [];
  const toleranceViolations: RequirementGap[] = [];

  const responseByItemId = new Map(
    evidence.checklistResponses.map((r) => [r.checklistItemId, r.response]),
  );
  for (const item of definition.checklistItems) {
    const response = responseByItemId.get(item.id);
    if (item.isRequired && !response) {
      gaps.push({
        code: 'CHECKLIST_ITEM_UNANSWERED',
        detail: `Checklistenpunkt ${item.itemNumber} „${item.text}" ist nicht beantwortet.`,
        affectedField: `checklistItem:${item.id}`,
      });
      continue;
    }
    // A "not OK" answer is a deviation, not a completion — the conservative
    // reading of Geschäftsgrundsatz 4 ("Abweichungen vollständig melden").
    // Unlike an out-of-tolerance measurement, this does NOT raise an NCR
    // automatically: a checklist item carries no error category the server
    // could classify from (see classifyBlocking). The worker either
    // corrects the answer or reports the deviation via "Abweichung melden"
    // (docs/07 A9), which is what turns it into an NCR with a disposition.
    if (response === 'NOK') {
      gaps.push({
        code: 'CHECKLIST_ITEM_NOT_OK',
        detail: `Checklistenpunkt ${item.itemNumber} „${item.text}" ist mit NOK bewertet — Abweichung muss behandelt werden.`,
        affectedField: `checklistItem:${item.id}`,
      });
    }
  }

  const completedPhotos = evidence.photos.filter((p) => p.uploadStatus === 'COMPLETED');
  for (const requirement of definition.photoRequirements) {
    const matching = completedPhotos.filter(
      (p) => p.photoRequirementId === requirement.id || p.photoCategory === requirement.category,
    );
    if (matching.length < requirement.minCount) {
      gaps.push({
        code: 'PHOTO_REQUIREMENT_UNMET',
        detail: `Fotos „${requirement.category}": ${matching.length} von mindestens ${requirement.minCount} vorhanden.`,
        affectedField: `photoRequirement:${requirement.id}`,
      });
    } else if (requirement.maxCount !== null && matching.length > requirement.maxCount) {
      gaps.push({
        code: 'PHOTO_REQUIREMENT_EXCEEDED',
        detail: `Fotos „${requirement.category}": ${matching.length} übersteigt das Maximum von ${requirement.maxCount}.`,
        affectedField: `photoRequirement:${requirement.id}`,
      });
    }
  }
  if (
    definition.photoRequired &&
    definition.photoRequirements.length === 0 &&
    completedPhotos.length === 0
  ) {
    gaps.push({
      code: 'PHOTO_REQUIREMENT_UNMET',
      detail: 'Für diesen Arbeitsschritt ist mindestens ein Foto erforderlich.',
      affectedField: 'photo',
    });
  }

  const measurementByCharacteristicId = new Map(
    evidence.measurements.map((m) => [m.inspectionCharacteristicId, m]),
  );
  for (const characteristic of definition.inspectionCharacteristics) {
    const measurement = measurementByCharacteristicId.get(characteristic.id);
    if (!measurement) {
      if (characteristic.isRequired) {
        gaps.push({
          code: 'MEASUREMENT_MISSING',
          detail: `Messwert „${characteristic.name}" wurde nicht erfasst.`,
          affectedField: `inspectionCharacteristic:${characteristic.id}`,
        });
      }
      continue;
    }
    if (!measurement.isWithinTolerance) {
      toleranceViolations.push({
        code: 'MEASUREMENT_OUT_OF_TOLERANCE',
        detail: `Messwert „${characteristic.name}" = ${measurement.measuredValue}${
          characteristic.unit ? ` ${characteristic.unit}` : ''
        } liegt außerhalb der Toleranz.`,
        affectedField: `inspectionCharacteristic:${characteristic.id}`,
      });
    }
  }

  if (definition.signatureRequired && !evidence.hasConfirmation) {
    gaps.push({
      code: 'CONFIRMATION_MISSING',
      detail: 'Die Bestätigung (Signatur/PIN) des Ausführenden fehlt.',
      affectedField: 'confirmation',
    });
  }

  return {
    satisfied: gaps.length === 0 && toleranceViolations.length === 0,
    gaps,
    toleranceViolations,
  };
}

/** Count of outstanding obligations — what the tablet lists under "Offene
 *  Anforderungen". Everything the server would currently reject, including
 *  the confirmation and any out-of-tolerance value: the worker should see all
 *  of it. What may *block the button* is a narrower question — see below. */
export function openRequirementCount(evaluation: RequirementEvaluation): number {
  return evaluation.gaps.length + evaluation.toleranceViolations.length;
}

/**
 * What must still be supplied before the completion button is worth pressing
 * — deliberately narrower than `openRequirementCount`.
 *
 * Two exclusions, both of which broke something real while the button was
 * gated on the full count:
 *
 *  - **`CONFIRMATION_MISSING`.** It is the gap the confirmation dialog itself
 *    closes; the PIN field is standing right there. Counting it meant the
 *    button was disabled at "(1 fehlend)" for every step with
 *    `signatureRequired` — which is every step — so **no step could be
 *    completed from the online screen at all**. The service was fine
 *    throughout: `submitWorkStepCompletion` writes the StepConfirmation and
 *    only then validates, so by the time the server looks, the gap is gone.
 *
 *  - **Tolerance violations.** A missing photo is incompleteness the worker
 *    can resolve. A measurement outside its limits is a verdict, and the
 *    server's response to it is to reject the completion *and raise a
 *    blocking NCR* (Abnahmeszenario D). Blocking the button meant the
 *    attempt never reached the server, so the NCR was never raised and the
 *    scenario was unreachable from the interface — quality would simply
 *    never hear about the deviation.
 *
 * docs/07 A2's "Abschließen (2 fehlend) [deaktiviert]" is about missing
 * evidence, which is exactly what is left here.
 */
export function requirementsBlockingCompletion(
  evaluation: RequirementEvaluation,
): RequirementGap[] {
  return evaluation.gaps.filter((gap) => gap.code !== 'CONFIRMATION_MISSING');
}
