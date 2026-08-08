import {
  evaluateStepRequirements,
  openRequirementCount,
  type CapturedEvidence,
  type StepRequirementDefinition,
} from '../step-requirements';

const NOTHING_REQUIRED: StepRequirementDefinition = {
  photoRequired: false,
  signatureRequired: false,
  fourEyesRequired: false,
  checklistItems: [],
  photoRequirements: [],
  inspectionCharacteristics: [],
};

const NO_EVIDENCE: CapturedEvidence = {
  checklistResponses: [],
  photos: [],
  measurements: [],
  hasConfirmation: false,
};

describe('evaluateStepRequirements', () => {
  it('is satisfied when a step demands nothing', () => {
    const result = evaluateStepRequirements(NOTHING_REQUIRED, NO_EVIDENCE);
    expect(result.satisfied).toBe(true);
    expect(openRequirementCount(result)).toBe(0);
  });

  describe('checklist', () => {
    const definition: StepRequirementDefinition = {
      ...NOTHING_REQUIRED,
      checklistItems: [
        { id: 'item-1', itemNumber: 1, text: 'Sichtprüfung', isRequired: true },
        { id: 'item-2', itemNumber: 2, text: 'Notiz', isRequired: false },
      ],
    };

    it('reports an unanswered required item', () => {
      const result = evaluateStepRequirements(definition, NO_EVIDENCE);
      expect(result.satisfied).toBe(false);
      expect(result.gaps.map((g) => g.code)).toEqual(['CHECKLIST_ITEM_UNANSWERED']);
      expect(result.gaps[0]?.affectedField).toBe('checklistItem:item-1');
    });

    it('ignores an unanswered optional item', () => {
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        checklistResponses: [{ checklistItemId: 'item-1', response: 'OK' }],
      });
      expect(result.satisfied).toBe(true);
    });

    it('blocks completion while a NOK answer is unresolved', () => {
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        checklistResponses: [{ checklistItemId: 'item-1', response: 'NOK' }],
      });
      expect(result.satisfied).toBe(false);
      expect(result.gaps.map((g) => g.code)).toEqual(['CHECKLIST_ITEM_NOT_OK']);
    });

    it('accepts N/A as an answer', () => {
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        checklistResponses: [{ checklistItemId: 'item-1', response: 'N/A' }],
      });
      expect(result.satisfied).toBe(true);
    });
  });

  describe('photos (Negativtest #6)', () => {
    it('requires at least one photo when the coarse flag is set', () => {
      const result = evaluateStepRequirements(
        { ...NOTHING_REQUIRED, photoRequired: true },
        NO_EVIDENCE,
      );
      expect(result.satisfied).toBe(false);
      expect(result.gaps.map((g) => g.code)).toEqual(['PHOTO_REQUIREMENT_UNMET']);
    });

    it('does not count a photo whose upload never completed', () => {
      const result = evaluateStepRequirements(
        { ...NOTHING_REQUIRED, photoRequired: true },
        {
          ...NO_EVIDENCE,
          photos: [
            { photoRequirementId: null, photoCategory: null, uploadStatus: 'PENDING' },
            { photoRequirementId: null, photoCategory: null, uploadStatus: 'FAILED' },
          ],
        },
      );
      expect(result.satisfied).toBe(false);
    });

    it('enforces per-category minimum and maximum counts', () => {
      const definition: StepRequirementDefinition = {
        ...NOTHING_REQUIRED,
        photoRequired: true,
        photoRequirements: [{ id: 'req-1', category: 'TYPENSCHILD', minCount: 2, maxCount: 3 }],
      };
      const photo = (uploadStatus: string) => ({
        photoRequirementId: 'req-1',
        photoCategory: 'TYPENSCHILD',
        uploadStatus,
      });

      expect(
        evaluateStepRequirements(definition, {
          ...NO_EVIDENCE,
          photos: [photo('COMPLETED')],
        }).gaps.map((g) => g.code),
      ).toEqual(['PHOTO_REQUIREMENT_UNMET']);

      expect(
        evaluateStepRequirements(definition, {
          ...NO_EVIDENCE,
          photos: [photo('COMPLETED'), photo('COMPLETED')],
        }).satisfied,
      ).toBe(true);

      expect(
        evaluateStepRequirements(definition, {
          ...NO_EVIDENCE,
          photos: [photo('COMPLETED'), photo('COMPLETED'), photo('COMPLETED'), photo('COMPLETED')],
        }).gaps.map((g) => g.code),
      ).toEqual(['PHOTO_REQUIREMENT_EXCEEDED']);
    });

    it('matches a photo to its requirement by category when no id was set', () => {
      const definition: StepRequirementDefinition = {
        ...NOTHING_REQUIRED,
        photoRequired: true,
        photoRequirements: [{ id: 'req-1', category: 'DETAIL', minCount: 1, maxCount: null }],
      };
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        photos: [{ photoRequirementId: null, photoCategory: 'DETAIL', uploadStatus: 'COMPLETED' }],
      });
      expect(result.satisfied).toBe(true);
    });
  });

  describe('measurements (Negativtest #8)', () => {
    const definition: StepRequirementDefinition = {
      ...NOTHING_REQUIRED,
      inspectionCharacteristics: [
        {
          id: 'char-1',
          characteristicNumber: 1,
          name: 'Spaltmaß',
          isRequired: true,
          unit: 'mm',
        },
      ],
    };

    it('reports a missing required measurement', () => {
      const result = evaluateStepRequirements(definition, NO_EVIDENCE);
      expect(result.gaps.map((g) => g.code)).toEqual(['MEASUREMENT_MISSING']);
      expect(result.toleranceViolations).toHaveLength(0);
    });

    it('separates an out-of-tolerance value from a missing one', () => {
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        measurements: [
          { inspectionCharacteristicId: 'char-1', isWithinTolerance: false, measuredValue: '2.4' },
        ],
      });
      expect(result.satisfied).toBe(false);
      expect(result.gaps).toHaveLength(0);
      expect(result.toleranceViolations.map((v) => v.code)).toEqual([
        'MEASUREMENT_OUT_OF_TOLERANCE',
      ]);
      expect(result.toleranceViolations[0]?.detail).toContain('2.4 mm');
    });

    it('is satisfied by an in-tolerance value', () => {
      const result = evaluateStepRequirements(definition, {
        ...NO_EVIDENCE,
        measurements: [
          { inspectionCharacteristicId: 'char-1', isWithinTolerance: true, measuredValue: '2.1' },
        ],
      });
      expect(result.satisfied).toBe(true);
    });
  });

  it('requires a confirmation when the step demands a signature', () => {
    const definition: StepRequirementDefinition = { ...NOTHING_REQUIRED, signatureRequired: true };
    expect(evaluateStepRequirements(definition, NO_EVIDENCE).gaps.map((g) => g.code)).toEqual([
      'CONFIRMATION_MISSING',
    ]);
    expect(
      evaluateStepRequirements(definition, { ...NO_EVIDENCE, hasConfirmation: true }).satisfied,
    ).toBe(true);
  });

  it('reports every open obligation at once, not just the first', () => {
    const definition: StepRequirementDefinition = {
      photoRequired: true,
      signatureRequired: true,
      fourEyesRequired: false,
      checklistItems: [{ id: 'item-1', itemNumber: 1, text: 'Sichtprüfung', isRequired: true }],
      photoRequirements: [],
      inspectionCharacteristics: [
        { id: 'char-1', characteristicNumber: 1, name: 'Spaltmaß', isRequired: true, unit: 'mm' },
      ],
    };
    const result = evaluateStepRequirements(definition, NO_EVIDENCE);
    expect(openRequirementCount(result)).toBe(4);
  });
});
