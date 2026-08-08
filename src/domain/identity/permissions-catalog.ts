// Permission atom catalog — verbatim from docs/04_ROLES_PERMISSIONS_MATRIX.md.
// Adding a resource/action here is a conscious architectural decision, not
// a free-form string: every domain service checks against one of these
// codes via src/lib/authz/can.ts, never an ad-hoc string literal.

export interface PermissionDefinition {
  code: string;
  resource: string;
  action: string;
  name: string;
}

function perm(resource: string, action: string, name: string): PermissionDefinition {
  return { code: `${resource}.${action}`, resource, action, name };
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // Identity & Organization
  perm('organization', 'manage', 'Organisation verwalten'),
  perm('site', 'manage', 'Standorte verwalten'),
  perm('user', 'manage', 'Benutzer verwalten'),
  perm('role', 'manage', 'Rollen verwalten'),
  perm('qualification', 'manage', 'Qualifikationen verwalten'),
  perm('delegation', 'create', 'Stellvertretung anlegen'),

  // Projects & Documents
  perm('project', 'create', 'Projekt anlegen'),
  perm('project', 'view', 'Projekt ansehen'),
  perm('project', 'update', 'Projekt bearbeiten'),
  perm('document', 'upload', 'Dokument hochladen'),
  perm('document', 'revise', 'Dokument revisionieren'),
  perm('document', 'review', 'Dokument prüfen'),
  perm('document', 'approve', 'Dokument genehmigen'),
  perm('document', 'release', 'Dokument freigeben'),
  perm('document', 'withdraw', 'Dokument zurückziehen'),
  perm('document', 'view', 'Dokument ansehen'),

  // Production Planning
  perm('production_plan', 'create', 'Fertigungsplan anlegen'),
  perm('production_plan', 'update', 'Fertigungsplan bearbeiten'),
  perm('production_plan', 'review', 'Fertigungsplan prüfen'),
  perm('production_plan', 'approve', 'Fertigungsplan genehmigen'),
  perm('production_plan', 'release', 'Fertigungsplan freigeben'),
  perm('work_step_definition', 'create', 'Arbeitsschritt definieren'),
  perm('work_step_definition', 'update', 'Arbeitsschrittdefinition bearbeiten'),

  // Production Execution
  perm('production_order', 'create', 'Produktionsauftrag anlegen'),
  perm('production_order', 'schedule', 'Produktionsauftrag terminieren'),
  perm('production_order', 'assign', 'Produktionsauftrag zuweisen'),
  perm('production_order', 'view', 'Produktionsauftrag ansehen'),
  perm('work_step', 'execute', 'Arbeitsschritt ausführen'),
  perm('work_step', 'pause', 'Arbeitsschritt pausieren'),
  perm('work_step', 'view', 'Arbeitsschritt ansehen'),
  perm('work_step', 'complete_locally', 'Arbeitsschritt lokal abschließen'),
  perm('completion_submission', 'validate', 'Abschluss validieren'),
  perm('second_approval', 'decide', 'Vier-Augen-Entscheidung treffen'),
  perm('skip_request', 'create', 'Überspringantrag stellen'),
  perm('skip_request', 'decide', 'Überspringantrag entscheiden'),

  // Quality
  perm('ncr', 'create', 'Abweichung melden'),
  perm('ncr', 'assess', 'Abweichung bewerten'),
  perm('ncr', 'disposition', 'Abweichung disponieren'),
  perm('ncr', 'view', 'Abweichung ansehen'),
  perm('rework', 'create', 'Nacharbeit anlegen'),
  perm('rework', 'execute', 'Nacharbeit ausführen'),
  perm('reinspection', 'execute', 'Nachprüfung durchführen'),
  perm('production_hold', 'create', 'Sperre setzen'),
  perm('production_hold', 'release', 'Sperre aufheben'),
  perm('equipment', 'manage', 'Prüfmittel verwalten'),
  perm('calibration', 'manage', 'Kalibrierung verwalten'),

  // Audit & Reporting
  perm('audit', 'view', 'Audit Trail ansehen'),
  perm('report', 'generate', 'Bericht erzeugen'),
  perm('export', 'create', 'Export erstellen'),
  perm('dossier', 'export', 'Produktionsakte exportieren'),
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
