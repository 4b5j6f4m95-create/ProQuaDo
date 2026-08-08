// System role → permission grants, transcribed verbatim from the "Rollen ×
// Berechtigungen Matrix" in docs/04_ROLES_PERMISSIONS_MATRIX.md.
//
// Permissions marked `*` or `**` in that matrix (organisationsweit
// konfigurierbar bzw. kontextabhängig/Delegation) are by default NOT
// included in PROJECT_LEAD's grant below where the matrix's footnote gives
// an alternative default holder — masterprompt.md Kap. 0 requires a
// conservative default for open points, and QM decides document approval/
// release by default. `production_plan.release` is the one exception: the
// matrix has NO other role holding it at all, and masterprompt.md Kap. 3
// lists production plan authorship/release as a core Projektleiter
// responsibility ("Arbeitsschritte, Abhängigkeiten... definieren"), unlike
// document release which Kap. 3 explicitly assigns to QM's "fachlich
// vorgesehene Freigaben". Excluding it here would mean NO ONE could ever
// release a plan — not a conservative default, just a functional gap.

export const SYSTEM_ROLES = {
  ADMIN: {
    name: 'Administrator',
    permissions: [
      'organization.manage',
      'site.manage',
      'user.manage',
      'role.manage',
      'qualification.manage',
      'delegation.create',
      'project.view',
      'document.view',
      'production_order.view',
      'work_step.view',
      'ncr.view',
      'device.manage',
      'sync_conflict.view',
      'audit.view',
      'report.generate',
      'dossier.export',
    ],
  },
  QUALITY_MANAGER: {
    name: 'Qualitätsmanager',
    permissions: [
      'qualification.manage',
      'delegation.create',
      'project.view',
      'document.review',
      'document.approve',
      'document.release',
      'document.withdraw',
      'document.view',
      'production_plan.review',
      'production_plan.approve',
      'production_order.view',
      'work_step.view',
      'completion_submission.validate',
      'second_approval.decide',
      'skip_request.decide',
      'ncr.create',
      'ncr.assess',
      'ncr.disposition',
      'ncr.view',
      'rework.create',
      'production_hold.create',
      'production_hold.release',
      'equipment.manage',
      'calibration.manage',
      'sync_conflict.view',
      'sync_conflict.decide',
      'audit.view',
      'report.generate',
      'export.create',
      'dossier.export',
    ],
  },
  PROJECT_LEAD: {
    name: 'Projektleiter / Arbeitsvorbereitung',
    permissions: [
      'delegation.create',
      'project.create',
      'project.view',
      'project.update',
      'document.upload',
      'document.revise',
      'document.review',
      'document.view',
      'production_plan.create',
      'production_plan.update',
      'production_plan.release',
      'work_step_definition.create',
      'work_step_definition.update',
      'production_order.view',
      'work_step.view',
      'ncr.create',
      'ncr.view',
      'sync_conflict.view',
      'sync_conflict.decide',
      'audit.view',
      'report.generate',
      'export.create',
      'dossier.export',
    ],
  },
  PRODUCTION_MANAGER: {
    name: 'Produktionsleiter',
    permissions: [
      'delegation.create',
      'project.view',
      'production_order.create',
      'production_order.schedule',
      'production_order.assign',
      'production_order.view',
      'work_step.view',
      'ncr.create',
      'ncr.view',
      'production_hold.create',
      'sync_conflict.view',
      'audit.view',
      'report.generate',
    ],
  },
  WORKER: {
    name: 'Produktionsmitarbeiter',
    permissions: [
      'project.view',
      'document.view',
      'production_order.view',
      'work_step.execute',
      'work_step.pause',
      'work_step.view',
      'work_step.complete_locally',
      'skip_request.create',
      'ncr.create',
      'ncr.view',
      // Phase 5: the offline device pushes its outbox as the worker who
      // captured the data. Without this atom the entire sync API is closed
      // to exactly the role it exists for.
      'sync.execute',
      // The matrix grants WORKER `rework.execute`; it was missing from this
      // transcription until Phase 4 needed it, which meant nobody could
      // execute a rework step (INSPECTOR holds `reinspection.execute` for
      // the verification that follows).
      'rework.execute',
    ],
  },
  INSPECTOR: {
    name: 'Prüfer',
    permissions: [
      'project.view',
      'document.view',
      'production_order.view',
      'work_step.view',
      'second_approval.decide',
      'ncr.create',
      'ncr.view',
      'reinspection.execute',
      'sync.execute',
    ],
  },
  AUDITOR: {
    name: 'Auditor / Read-only',
    permissions: [
      'project.view',
      'document.view',
      'production_order.view',
      'work_step.view',
      'ncr.view',
      'audit.view',
      'report.generate',
      'export.create',
      'dossier.export',
    ],
  },
} as const;

export type SystemRoleCode = keyof typeof SYSTEM_ROLES;
