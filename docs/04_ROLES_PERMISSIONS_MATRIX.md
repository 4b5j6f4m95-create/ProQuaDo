# 4. Rollen-, Rechte- und Freigabematrix

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Grundprinzip

RBAC wird serverseitig durchgesetzt und durch ABAC-Kontext (Organisation, Standort, Projekt, Abteilung, Qualifikation, Objektstatus) ergänzt. **UI-Ausblendung ist keine Zugriffskontrolle** – jede API-Route validiert eigenständig.

```
Autorisierungsentscheidung = f(
  Rolle(n) des Users,
  Berechtigungsatome der Rolle(n),
  ABAC-Kontext (Org, Site, Projekt, Department),
  Objektstatus (z.B. RELEASED, LOCKED),
  Qualifikationsgültigkeit,
  Vier-Augen-Regel (executor ≠ reviewer)
)
```

---

## Rollen-Übersicht

| Rolle | Code | System-Rolle |
|-------|------|--------------|
| Administrator | `ADMIN` | ja |
| Qualitätsmanager | `QUALITY_MANAGER` | ja |
| Projektleiter / Arbeitsvorbereitung | `PROJECT_LEAD` | ja |
| Produktionsleiter | `PRODUCTION_MANAGER` | ja |
| Produktionsmitarbeiter | `WORKER` | ja |
| Prüfer | `INSPECTOR` | ja |
| Auditor / Read-only | `AUDITOR` | ja |

Rollen sind konfigurierbar erweiterbar (custom roles je Organisation), Berechtigungsatome bleiben aber fest kodiert im System.

---

## Berechtigungsatome (Permission Codes)

Format: `<resource>.<action>`

### Identity & Organization
```
organization.manage
site.manage
user.manage
role.manage
qualification.manage
delegation.create
```

### Projects & Documents
```
project.create
project.view
project.update
document.upload
document.revise
document.review
document.approve
document.release
document.withdraw
document.view
```

### Production Planning
```
production_plan.create
production_plan.update
production_plan.review
production_plan.approve
production_plan.release
work_step_definition.create
work_step_definition.update
```

### Production Execution
```
production_order.create
production_order.schedule
production_order.assign
production_order.view
work_step.execute
work_step.pause
work_step.view
work_step.complete_locally
completion_submission.validate
second_approval.decide
skip_request.create
skip_request.decide
```

### Quality
```
ncr.create
ncr.assess
ncr.disposition
ncr.view
rework.create
rework.execute
reinspection.execute
production_hold.create
production_hold.release
equipment.manage
calibration.manage
```

### Audit & Reporting
```
audit.view
report.generate
export.create
dossier.export
```

---

## Rollen × Berechtigungen Matrix

| Berechtigung | ADMIN | QUALITY_MANAGER | PROJECT_LEAD | PRODUCTION_MANAGER | WORKER | INSPECTOR | AUDITOR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| organization.manage | ✓ | | | | | | |
| site.manage | ✓ | | | | | | |
| user.manage | ✓ | | | | | | |
| role.manage | ✓ | | | | | | |
| qualification.manage | ✓ | ✓ | | | | | |
| delegation.create | ✓ | ✓ | ✓ | ✓ | | | |
| project.create | | | ✓ | | | | |
| project.view | ✓ | ✓ | ✓ | ✓ | (zugewiesen) | (zugewiesen) | ✓ (read) |
| project.update | | | ✓ | | | | |
| document.upload | | | ✓ | | | | |
| document.revise | | | ✓ | | | | |
| document.review | | ✓ | ✓ | | | | |
| document.approve | | ✓ | ✓* | | | | |
| document.release | | ✓ | ✓* | | | | |
| document.withdraw | | ✓ | | | | | |
| document.view | ✓ | ✓ | ✓ | ✓ | ✓ (zugewiesen) | ✓ (zugewiesen) | ✓ (read) |
| production_plan.create | | | ✓ | | | | |
| production_plan.update | | | ✓ | | | | |
| production_plan.review | | ✓ | | | | | |
| production_plan.approve | | ✓ | | | | | |
| production_plan.release | | | ✓* | | | | |
| work_step_definition.create | | | ✓ | | | | |
| production_order.create | | | | ✓ | | | |
| production_order.schedule | | | | ✓ | | | |
| production_order.assign | | | | ✓ | | | |
| production_order.view | ✓ | ✓ | ✓ | ✓ | ✓ (zugewiesen) | ✓ (zugewiesen) | ✓ (read) |
| work_step.execute | | | | | ✓ | | |
| work_step.pause | | | | | ✓ | | |
| work_step.view | ✓ | ✓ | ✓ | ✓ | ✓ (zugewiesen) | ✓ (zugewiesen) | ✓ (read) |
| work_step.complete_locally | | | | | ✓ | | |
| completion_submission.validate | | ✓ | ✓** | | | | |
| second_approval.decide | | ✓ | | | | ✓ | |
| skip_request.create | | | | | ✓ | | |
| skip_request.decide | | ✓ | ✓** | | | | |
| ncr.create | | ✓ | ✓ | ✓ | ✓ | ✓ | |
| ncr.assess | | ✓ | | | | | |
| ncr.disposition | | ✓ | | | | | |
| ncr.view | ✓ | ✓ | ✓ | ✓ | (zugewiesen) | ✓ | ✓ (read) |
| rework.create | | ✓ | ✓** | | | | |
| rework.execute | | | | | ✓ | | |
| reinspection.execute | | | | | | ✓ | |
| production_hold.create | | ✓ | ✓ | ✓ | | | |
| production_hold.release | | ✓ | ✓** | | | | |
| equipment.manage | | ✓ | | | | | |
| calibration.manage | | ✓ | | | | | |
| audit.view | ✓ | ✓ | ✓ (eigene) | ✓ (eigene) | | | ✓ |
| report.generate | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| export.create | | ✓ | ✓ | | | | ✓ |
| dossier.export | ✓ | ✓ | ✓ | | | | ✓ |

`*` = nur wenn organisationsweit berechtigt konfiguriert (Standardregel: QM entscheidet fachliche Freigaben)
`**` = kontextabhängig, meist QM primär zuständig, PL nur bei expliziter Delegation

**Wichtig:** Admin-Rolle erhält **keine automatische fachliche Freigabeberechtigung** – siehe Geschäftsgrundsatz 1 im Masterprompt.

---

## ABAC-Kontextregeln

Jede Autorisierungsprüfung berücksichtigt zusätzlich:

| Kontext-Dimension | Regel |
|---|---|
| **Organisation** | User darf nur auf `organization_id` seiner Zugehörigkeit zugreifen |
| **Standort (Site)** | Optional eingeschränkt auf zugewiesene Standorte |
| **Projektzuordnung** | `project_members` Eintrag erforderlich für nicht-globale Rollen |
| **Abteilung** | Work Steps ggf. nur für zugewiesene Abteilung sichtbar/ausführbar |
| **Qualifikation** | `employee_qualifications` muss gültig sein (nicht abgelaufen) zum Zeitpunkt der Aktion |
| **Objektstatus** | z.B. `document.release` nur wenn Status = APPROVED |
| **Zuweisung** | Worker sieht nur `order_assignments`-relevante Aufträge |

### Beispiel-Autorisierungsfunktion

```typescript
interface AuthzContext {
  userId: UUID;
  organizationId: UUID;
  action: string;          // 'work_step.execute'
  resource: {
    type: string;
    id: UUID;
    organizationId: UUID;
    projectId?: UUID;
    departmentId?: UUID;
    status?: string;
    requiredQualification?: string;
  };
}

async function can(context: AuthzContext): Promise<Decision> {
  // 1. Mandant Check (hard boundary)
  if (context.organizationId !== context.resource.organizationId) {
    return { allowed: false, reason: 'CROSS_TENANT_ACCESS_DENIED' };
  }

  // 2. RBAC Check
  const permissions = await getUserPermissions(context.userId);
  if (!permissions.includes(context.action)) {
    return { allowed: false, reason: 'PERMISSION_DENIED' };
  }

  // 3. ABAC Context Check
  if (context.resource.projectId) {
    const isMember = await isProjectMember(context.userId, context.resource.projectId);
    const hasGlobalAccess = permissions.includes('*.all_projects');
    if (!isMember && !hasGlobalAccess) {
      return { allowed: false, reason: 'NOT_PROJECT_MEMBER' };
    }
  }

  // 4. Qualification Check (if applicable)
  if (context.resource.requiredQualification) {
    const qualified = await isCurrentlyQualified(
      context.userId,
      context.resource.requiredQualification
    );
    if (!qualified) {
      return { allowed: false, reason: 'QUALIFICATION_EXPIRED_OR_MISSING' };
    }
  }

  // 5. Object Status Check
  // (handled by domain service guard, not generic authz)

  return { allowed: true };
}
```

---

## Vier-Augen-Prinzip (Enforcement)

Kritische Aktionen erfordern zwei unterschiedliche, qualifizierte Personen:

| Aktion | Executor-Rolle | Reviewer-Rolle | DB-Constraint |
|---|---|---|---|
| Kritischer Arbeitsschritt | WORKER | INSPECTOR / QM | `executor_id != reviewer_id` |
| Freigabe kritischer Dokumentrevision | PROJECT_LEAD | QUALITY_MANAGER (optional) | Anwendungslogik + Audit |
| NCR-Disposition bei kritischer Kategorie | QUALITY_MANAGER | Zweiter QM oder Site Lead | Anwendungslogik |
| Sperrenaufhebung | Aussteller | Andere berechtigte Person | Anwendungslogik |

**Serverseitige Durchsetzung:**
```sql
ALTER TABLE second_approvals
  ADD CONSTRAINT check_diff_reviewer CHECK (executor_id != reviewer_id);
```

Zusätzlich Anwendungsebene: Prüft Qualifikation und zeitlich gültige Berechtigung des Reviewers vor Freigabe.

---

## Re-Authentifizierung für kritische Aktionen

Folgende Aktionen erfordern PIN/Re-Auth zusätzlich zur Session:

- `document.release`
- `production_plan.release`
- `ncr.disposition`
- `production_hold.release`
- `second_approval.decide`
- `work_step.complete_locally` (Signatur/PIN als Bestätigung)

**Implementierung:** Kurzlebiger "step-up" Auth-Token (z.B. 5 Minuten gültig) nach erfolgreicher PIN/Passwort-Bestätigung, unabhängig von der Hauptsession.

---

## Qualifikationen und Gültigkeit

```typescript
interface QualificationCheck {
  employeeId: UUID;
  qualificationCode: string;
  atTimestamp: Date;  // execution time, not "now" during audit
}

async function isCurrentlyQualified(check: QualificationCheck): Promise<boolean> {
  const record = await db.employeeQualifications.findFirst({
    where: {
      employeeId: check.employeeId,
      qualification: { code: check.qualificationCode },
      certifiedAt: { lte: check.atTimestamp },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: check.atTimestamp } }
      ]
    }
  });
  return record !== null;
}
```

**Regel:** Abgelaufene Qualifikationen verhindern **Start oder Freigabe** betroffener Schritte, nicht rückwirkend bereits abgeschlossene.

---

## Rechteänderungen und Offline-Konsequenzen

| Szenario | Verhalten |
|---|---|
| Recht wird online entzogen | Sofortige Wirkung bei nächster API-Anfrage |
| Recht wird entzogen während User offline war | Bereits offline erfasste Arbeit bleibt als historische Tatsache erhalten (nicht gelöscht) |
| Offline erfasste Arbeit nach Rechteentzug synchronisiert | Wird **nicht automatisch freigegeben** – landet in `CONFLICT_PERMISSION`, erfordert manuelle Entscheidung durch berechtigte Person |

---

## Stellvertretung (Delegation)

```sql
-- delegations table (siehe 02_DOMAIN_MODEL.md)
CHECK (delegating_user_id != delegated_user_id)
```

Regeln:
- Zeitlich begrenzt (`starts_at`, `expires_at` verpflichtend)
- Begründungspflicht (`reason` NOT NULL in Anwendungslogik)
- Auditierbar: jede Nutzung einer Delegation wird im Audit Trail mit `delegated_actor_id` vermerkt
- Delegierte Rechte sind Teilmenge der Rechte des Delegierenden (kein Rechte-Zugewinn)

---

## Auditor / Read-Only Zugriff

- Nur `GET`/Export-Operationen erlaubt
- Zugriff begrenzt nach:
  - Zweck (z.B. "Jahresaudit 2026")
  - Zeitraum (z.B. Q1 2026)
  - Mandant (`organization_id`)
- Lesezugriffe auf besonders sensible Akten (z.B. Personaldaten in NCRs) werden separat protokolliert

---

## Nächste Schritte

→ **05_API_CONTRACTS.md**: API- und Event-Verträge, Idempotenz, Fehlerformate
