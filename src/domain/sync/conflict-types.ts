/**
 * The conflict vocabulary — docs/03_STATE_MACHINES.md §6 "Konflikttypen" and
 * docs/06_OFFLINE_SYNC_CONFLICT.md "Konfliktbehandlung".
 *
 * This module is pure data and pure functions: the list of conflicts, which
 * decisions each one admits, and how each is worded for the person who has
 * to decide. It has no database access on purpose — it is imported by the
 * server (to validate a decision) and could be imported by an offline client
 * (to render a conflict it received) without dragging Prisma along.
 */

export const CONFLICT_TYPES = [
  'REVISION_CONFLICT',
  'PERMISSION_REVOKED',
  'ENTITY_VERSION_CONFLICT',
  'DUPLICATE_COMMAND',
  'ORDER_ON_HOLD',
  'BLOCKING_NCR',
  'MISSING_OR_CORRUPT_EVIDENCE',
] as const;

export type ConflictType = (typeof CONFLICT_TYPES)[number];

/**
 * DUPLICATE_COMMAND is in the list for completeness — docs/03 counts it as a
 * conflict type — but it is the one that resolves itself: the idempotency
 * key matched, the original result is returned, nothing is pending. It never
 * produces a `sync_conflicts` row, and therefore has no decisions.
 */
export const SELF_RESOLVING_CONFLICTS: readonly ConflictType[] = ['DUPLICATE_COMMAND'];

export const DECISION_TYPES = [
  // docs/06, REVISION_CONFLICT: the five options a responsible person has.
  'ACCEPT_AS_VALID',
  'ADDITIONAL_INSPECTION_REQUIRED',
  'REWORK_REQUIRED',
  'REPEAT_REQUIRED',
  'PRODUCTION_HOLD',
  // Applicable to the conflicts that are a matter of timing or of a
  // rejected precondition rather than of the executed work itself.
  'RETRY_AFTER_RESOLUTION',
  'REQUEST_REUPLOAD',
  'DISCARD_SUBMISSION',
] as const;

export type ConflictDecisionType = (typeof DECISION_TYPES)[number];

/**
 * Which decisions each conflict admits. Not cosmetic: the server rejects a
 * decision that is not listed here, so a client cannot, say, "accept as
 * valid" a completion whose photo evidence is corrupt.
 */
export const DECISIONS_BY_CONFLICT: Record<ConflictType, readonly ConflictDecisionType[]> = {
  REVISION_CONFLICT: [
    'ACCEPT_AS_VALID',
    'ADDITIONAL_INSPECTION_REQUIRED',
    'REWORK_REQUIRED',
    'REPEAT_REQUIRED',
    'PRODUCTION_HOLD',
    'DISCARD_SUBMISSION',
  ],
  // The captured work is preserved as a historical fact (docs/06
  // "preserveAsHistoricalFact") — but ACCEPT_AS_VALID is deliberately NOT
  // offered. Waving through a completion made by someone who no longer holds
  // the permission is precisely what docs/04 forbids ("wird nicht
  // automatisch freigegeben"), and doing it by proxy is the same act with a
  // different signature on it. What a responsible person can do is order an
  // independent re-check, or refuse the completion claim while keeping every
  // captured measurement and photo.
  PERMISSION_REVOKED: ['ADDITIONAL_INSPECTION_REQUIRED', 'DISCARD_SUBMISSION'],
  // The server moved on under the device. There is nothing to judge about
  // the work — the device has to re-read and re-submit, or the submission is
  // dropped.
  ENTITY_VERSION_CONFLICT: ['RETRY_AFTER_RESOLUTION', 'DISCARD_SUBMISSION'],
  DUPLICATE_COMMAND: [],
  ORDER_ON_HOLD: ['RETRY_AFTER_RESOLUTION', 'DISCARD_SUBMISSION'],
  // A blocking deviation is a quality matter, and quality's own workflow
  // (assess → contain → rework → reinspect) is where it belongs.
  BLOCKING_NCR: ['REWORK_REQUIRED', 'RETRY_AFTER_RESOLUTION', 'DISCARD_SUBMISSION'],
  MISSING_OR_CORRUPT_EVIDENCE: ['REQUEST_REUPLOAD', 'REPEAT_REQUIRED', 'DISCARD_SUBMISSION'],
};

export function isDecisionAllowed(
  conflictType: ConflictType,
  decision: ConflictDecisionType,
): boolean {
  return DECISIONS_BY_CONFLICT[conflictType]?.includes(decision) ?? false;
}

export const CONFLICT_TYPE_LABEL: Record<ConflictType, string> = {
  REVISION_CONFLICT: 'Dokument- oder Planrevision geändert',
  PERMISSION_REVOKED: 'Berechtigung vor der Synchronisation entzogen',
  ENTITY_VERSION_CONFLICT: 'Datensatz zwischenzeitlich serverseitig geändert',
  DUPLICATE_COMMAND: 'Kommando bereits verarbeitet',
  ORDER_ON_HOLD: 'Auftrag gesperrt',
  BLOCKING_NCR: 'Blockierende Abweichung offen',
  MISSING_OR_CORRUPT_EVIDENCE: 'Nachweis fehlt oder ist beschädigt',
};

export const DECISION_LABEL: Record<ConflictDecisionType, string> = {
  ACCEPT_AS_VALID: 'Weiterhin gültig – keine Auswirkung',
  ADDITIONAL_INSPECTION_REQUIRED: 'Zusatzprüfung erforderlich',
  REWORK_REQUIRED: 'Nacharbeit erforderlich',
  REPEAT_REQUIRED: 'Wiederholung erforderlich',
  PRODUCTION_HOLD: 'Produktsperre',
  RETRY_AFTER_RESOLUTION: 'Erneut übertragen, sobald die Ursache behoben ist',
  REQUEST_REUPLOAD: 'Nachweis erneut übertragen lassen',
  DISCARD_SUBMISSION: 'Abschlussmeldung verwerfen (Erfassung bleibt erhalten)',
};

/** What the decision does, in one sentence, for the confirmation screen —
 *  docs/07: a decision surface must state its consequence before it is
 *  taken, not after. */
export const DECISION_CONSEQUENCE: Record<ConflictDecisionType, string> = {
  ACCEPT_AS_VALID:
    'Der Arbeitsschritt wird mit der ursprünglich verwendeten Revision abgeschlossen; die Entscheidung wird vermerkt.',
  ADDITIONAL_INSPECTION_REQUIRED:
    'Es wird eine nicht blockierende Abweichung angelegt, über die eine Nachprüfung eingeplant wird.',
  REWORK_REQUIRED:
    'Es wird eine blockierende Abweichung angelegt; Nacharbeit und Nachprüfung laufen über den Qualitätsprozess.',
  REPEAT_REQUIRED:
    'Die Ausführung bleibt historisch erhalten und wird als überholt markiert; der Schritt wird mit der aktuellen Revision neu freigegeben.',
  PRODUCTION_HOLD: 'Der Auftrag wird gesperrt, bis die Sperre ausdrücklich aufgehoben wird.',
  RETRY_AFTER_RESOLUTION:
    'Es wird nichts verändert; das Gerät darf das Kommando erneut senden, sobald die Ursache behoben ist.',
  REQUEST_REUPLOAD:
    'Der beanstandete Nachweis wird zur erneuten Übertragung angefordert; der Schritt bleibt in Bearbeitung.',
  DISCARD_SUBMISSION:
    'Die Abschlussmeldung wird verworfen. Checklisten, Fotos und Messwerte bleiben erhalten — der Schritt ist wieder in Bearbeitung.',
};
