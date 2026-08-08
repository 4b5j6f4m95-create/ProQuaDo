// Matches the Decision shape from docs/03_STATE_MACHINES.md "Zentrale
// Domänenoperationen": not just a boolean, but a machine-readable reason
// code plus an optional human-readable German message for the UI.
export interface Decision {
  allowed: boolean;
  reason?: DenialReason;
  message?: string;
}

export type DenialReason =
  'PERMISSION_DENIED' | 'NOT_QUALIFIED' | 'CROSS_TENANT_ACCESS_DENIED' | 'UNAUTHENTICATED';

const REASON_MESSAGES: Record<DenialReason, string> = {
  PERMISSION_DENIED: 'Sie besitzen nicht die erforderliche Berechtigung für diese Aktion.',
  NOT_QUALIFIED: 'Die erforderliche Qualifikation liegt nicht oder nicht mehr gültig vor.',
  CROSS_TENANT_ACCESS_DENIED: 'Zugriff verweigert.',
  UNAUTHENTICATED: 'Bitte melden Sie sich an.',
};

export function deny(reason: DenialReason, message?: string): Decision {
  return { allowed: false, reason, message: message ?? REASON_MESSAGES[reason] };
}

export function allow(): Decision {
  return { allowed: true };
}
