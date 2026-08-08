// Matches docs/03_STATE_MACHINES.md §5 "Non-Conformance (NCR) Status
// Machine" and the status list in MASTERPROMPT.md Kap. 9.
export type NonConformanceStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'ASSESSMENT_REQUIRED'
  | 'CONTAINMENT'
  | 'REWORK'
  | 'REINSPECTION'
  | 'AWAITING_DISPOSITION'
  | 'CLOSED'
  | 'CANCELLED';

const VALID_TRANSITIONS: Record<NonConformanceStatus, readonly NonConformanceStatus[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['ASSESSMENT_REQUIRED', 'CANCELLED'],
  ASSESSMENT_REQUIRED: ['CONTAINMENT', 'AWAITING_DISPOSITION', 'CANCELLED'],
  // The documented machine allows containment to go straight to disposition
  // when no rework is needed ("no rework needed" branch in docs/03 §5).
  CONTAINMENT: ['REWORK', 'AWAITING_DISPOSITION', 'CANCELLED'],
  REWORK: ['REINSPECTION', 'AWAITING_DISPOSITION', 'CANCELLED'],
  REINSPECTION: ['AWAITING_DISPOSITION', 'REWORK', 'CANCELLED'],
  // A disposition of "Nacharbeit erforderlich" sends it back into rework
  // rather than closing it (docs/03 §5: "requires action → REWORK").
  AWAITING_DISPOSITION: ['CLOSED', 'REWORK', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export function isValidNonConformanceTransition(
  from: NonConformanceStatus,
  to: NonConformanceStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** An NCR still influences production until it is closed or cancelled —
 *  this is the predicate behind "offene blockierende NCR" (Negativtest #10). */
export function isNonConformanceOpen(status: NonConformanceStatus): boolean {
  return status !== 'CLOSED' && status !== 'CANCELLED';
}

export type DispositionType = 'REWORK' | 'CONCESSION' | 'SCRAP';

/**
 * Server-side classification (MASTERPROMPT.md Kap. 9: "Der Server
 * klassifiziert anhand konfigurierter Regeln ... Bis zur Serverentscheidung
 * gilt bei potenziell kritischen Kategorien die konservative Sperrregel").
 *
 * The rule set is deliberately hard-coded and conservative for the MVP: a
 * configurable rule engine appears in no phase of docs/10 and is therefore a
 * post-MVP concern, not a scheduled one. Until it exists,
 * guessing "probably not blocking" would be the one failure mode with
 * physical consequences. A reporter can raise the classification but never
 * lower it — only a QM assessment may do that, with a reason.
 */
const ALWAYS_BLOCKING_CATEGORIES = [
  'MASSABWEICHUNG_KRITISCH',
  'MATERIALFEHLER',
  'FUNKTIONSFEHLER',
  'SICHERHEITSRELEVANT',
  'MEASUREMENT_OUT_OF_TOLERANCE',
] as const;

export function classifyBlocking(input: {
  errorCategory?: string | null;
  priority: string;
  reporterSuggestsBlocking?: boolean;
}): boolean {
  if (input.reporterSuggestsBlocking) return true;
  if (input.priority === 'CRITICAL' || input.priority === 'HIGH') return true;
  if (
    input.errorCategory &&
    (ALWAYS_BLOCKING_CATEGORIES as readonly string[]).includes(input.errorCategory)
  ) {
    return true;
  }
  return false;
}
