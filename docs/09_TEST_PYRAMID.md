# 9. Testpyramide und Abnahmekriterien

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Testpyramide – Übersicht

```
                    ▲
                   ╱ ╲
                  ╱E2E╲              wenige, teuer, hoher Wert
                 ╱─────╲             (Hauptflüsse pro Rolle)
                ╱       ╲
               ╱Contract ╲           API/Event/ERP-Verträge
              ╱───────────╲
             ╱  Integration╲         PostgreSQL + S3 real
            ╱───────────────╲
           ╱   Property/Model╲       ungültige Statusfolgen
          ╱───────────────────╲
         ╱      Unit Tests     ╲     viele, schnell, günstig
        ╱─────────────────────────╲  (State Machines, Toleranzen, Rechte)
       ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
```

---

## Ebene 1: Unit Tests

**Fokus:** Zustandsautomaten, Toleranzberechnung, Abhängigkeitsauflösung, Berechtigungslogik – isoliert, ohne DB/Netzwerk.

### Beispiele

```typescript
describe('canStartWorkStep', () => {
  it('rejects when status is not READY', async () => {
    const step = buildWorkStep({ status: 'LOCKED' });
    const result = await canStartWorkStep({ step, userId: 'u1', releaseToken: validToken });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NOT_READY');
  });

  it('rejects when release token workStepId mismatches', async () => {
    const step = buildWorkStep({ id: 'ws-2', status: 'READY' });
    const tokenForOtherStep = buildToken({ workStepInstanceId: 'ws-1' });
    const result = await canStartWorkStep({ step, userId: 'u1', releaseToken: tokenForOtherStep });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INVALID_RELEASE_TOKEN');
  });

  it('rejects when qualification expired at execution time', async () => {
    const step = buildWorkStep({ requiredQualification: 'WELDING_CERT' });
    mockQualification({ userId: 'u1', code: 'WELDING_CERT', expiresAt: pastDate() });
    const result = await canStartWorkStep({ step, userId: 'u1', releaseToken: validToken });
    expect(result.reason).toBe('NOT_QUALIFIED');
  });
});

describe('measurement tolerance evaluation', () => {
  it.each([
    [2.1, 1.8, 2.2, true],
    [1.7, 1.8, 2.2, false],
    [2.3, 1.8, 2.2, false],
  ])('value=%f lower=%f upper=%f → withinTolerance=%s', (value, lower, upper, expected) => {
    expect(isWithinTolerance(value, lower, upper)).toBe(expected);
  });
});

describe('second approval constraint', () => {
  it('rejects when executor equals reviewer', () => {
    expect(() => validateSecondApproval({ executorId: 'u1', reviewerId: 'u1' }))
      .toThrow('SAME_PERSON_REVIEW_DENIED');
  });
});
```

**Abdeckungsziel:** ≥90% für Domänenschicht (State Machines, Guards, Berechnungen).

---

## Ebene 2: Property-/Model-based Tests

**Fokus:** Systematische Exploration ungültiger Statusfolgen und Workflowgraphen, die manuell nicht alle erdacht würden.

```typescript
import fc from 'fast-check';

const ALL_STATUSES: WorkStepStatus[] = [
  'LOCKED', 'READY', 'IN_PROGRESS', 'PAUSED', 'COMPLETED_PENDING_SYNC',
  'WAITING_FOR_SERVER', 'VALIDATING', 'AWAITING_SECOND_APPROVAL',
  'COMPLETED', 'COMPLETION_REJECTED', 'BLOCKED', 'SKIP_REQUEST_PENDING_SYNC',
  'SKIP_REQUESTED', 'SKIPPED', 'REWORK_REQUIRED', 'SUPERSEDED'
];

const VALID_TRANSITIONS = new Set([
  'LOCKED->READY', 'READY->IN_PROGRESS', 'IN_PROGRESS->PAUSED',
  // ... vollständige Liste aus 03_STATE_MACHINES.md
]);

it('only explicitly whitelisted transitions succeed', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...ALL_STATUSES),
      fc.constantFrom(...ALL_STATUSES),
      (from, to) => {
        const key = `${from}->${to}`;
        const result = attemptTransitionSync(from, to);
        if (VALID_TRANSITIONS.has(key)) {
          expect(result.allowed).toBe(true);
        } else {
          expect(result.allowed).toBe(false);
        }
      }
    ),
    { numRuns: 500 }  // deckt alle 16×16 = 256 Kombinationen mehrfach ab
  );
});

// Plan-Graph Zyklen-Erkennung
it('rejects any cyclic dependency graph', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ from: fc.nat(20), to: fc.nat(20) }), { minLength: 1, maxLength: 30 }),
      (edges) => {
        const graph = buildGraph(edges);
        const hasCycle = detectCycle(graph);
        const validationResult = validatePlanGraph(graph);
        expect(validationResult.valid).toBe(!hasCycle);
      }
    )
  );
});
```

---

## Ebene 3: Integrationstests

**Fokus:** Reale PostgreSQL-Instanz (Testcontainers) + Objektspeicher-Emulator (MinIO/LocalStack).

```typescript
describe('validateAndCompleteWorkStep (integration)', () => {
  let db: TestDatabase;
  let s3: TestObjectStorage;

  beforeEach(async () => {
    db = await startTestPostgres();  // Testcontainers
    s3 = await startTestMinio();
    await seedBaseData(db);
  });

  it('completes step atomically with audit + outbox in same transaction', async () => {
    const step = await createReadyWorkStep(db, { photoRequired: true });
    await uploadPhotoEvidence(db, s3, step.id, validPhotoBuffer);

    const result = await validateAndCompleteWorkStep({
      workStepInstanceId: step.id,
      submissionId: 'sub-1'
    });

    expect(result.status).toBe('COMPLETED');

    // Verify atomicity: audit AND outbox exist together
    const audit = await db.auditEvents.findMany({ where: { resourceId: step.id } });
    const outbox = await db.outboxEvents.findMany({ where: { aggregateId: step.id } });
    expect(audit.length).toBeGreaterThan(0);
    expect(outbox.length).toBeGreaterThan(0);
  });

  it('rolls back everything on validation failure mid-transaction', async () => {
    const step = await createReadyWorkStep(db, { measurementRequired: true });
    await submitOutOfToleranceMeasurement(db, step.id);

    const result = await validateAndCompleteWorkStep({ workStepInstanceId: step.id });

    expect(result.status).toBe('COMPLETION_REJECTED');
    const reloaded = await db.workStepInstances.findUnique({ where: { id: step.id } });
    expect(reloaded.status).not.toBe('COMPLETED');  // kein Teilzustand
  });
});
```

---

## Ebene 4: Contract Tests

**Fokus:** API-Schema-Konformität, Event-Schema-Versionierung, ERP-Adapter-Verträge.

```typescript
describe('API Contract: POST /work-steps/{id}/start', () => {
  it('matches OpenAPI schema for success response', async () => {
    const response = await request(app).post('/api/v1/work-steps/ws-1/start').send(validPayload);
    expect(response.body).toMatchSchema(openApiSchemas.StartWorkStepResponse);
  });

  it('matches RFC-7807 error schema on failure', async () => {
    const response = await request(app).post('/api/v1/work-steps/invalid/start').send({});
    expect(response.status).toBe(404);
    expect(response.body).toMatchSchema(openApiSchemas.ApiError);
  });
});

describe('Event Contract: work_step.completed', () => {
  it('payload matches registered schema version 1.0', () => {
    const event = buildCompletedEvent();
    expect(validateEventSchema('work_step.completed', '1.0', event.payload)).toBe(true);
  });
});
```

---

## Ebene 5: PWA-/Sync-Tests

**Fokus:** Verbindungsabbruch, Wiederholung, beschädigte Uploads – simuliert mit Network-Throttling/Chaos-Injection.

```typescript
describe('Offline sync resilience', () => {
  it('resumes photo upload from last confirmed chunk after connection drop', async () => {
    const uploadState = await startPhotoUpload(largePhotoBuffer);
    await simulateNetworkDrop({ afterBytes: 1_000_000 });

    const resumed = await resumeUpload(uploadState.photoId);
    expect(resumed.uploadedBytes).toBe(largePhotoBuffer.length);
    expect(resumed.duplicateChunks).toBe(0);
  });

  it('does not create duplicate work step completion on repeated sync', async () => {
    const command = buildCompletionCommand({ idempotencyKey: 'idem-1' });
    await syncCommands([command]);
    await syncCommands([command]);  // retry, e.g. after timeout

    const submissions = await db.completionSubmissions.findMany({
      where: { workStepInstanceId: command.workStepInstanceId }
    });
    expect(submissions).toHaveLength(1);
  });

  it('blocks next step start while offline without valid release token', async () => {
    const client = await createOfflineClient();
    const nextStep = await client.getWorkStep('ws-2');
    expect(nextStep.status).toBe('LOCKED');

    await expect(client.startWorkStep('ws-2')).rejects.toThrow('WORK_STEP_NOT_READY');
  });
});
```

---

## Ebene 6: End-to-End Tests

**Fokus:** Wichtigste Rollen und Produktionsflüsse, Browser-basiert (Playwright).

```typescript
test('Worker completes step online, next step releases immediately', async ({ page }) => {
  await loginAs(page, 'worker@test.local');
  await page.goto('/orders/AUF-2026-0142');
  await page.click('[data-testid=start-step-7]');
  await fillChecklist(page, allItemsOk);
  await capturePhoto(page, 'typenschild');
  await enterMeasurement(page, 'spaltmass', 2.1);
  await page.click('[data-testid=complete-step]');
  await enterPin(page, '1234');
  await page.click('[data-testid=confirm]');

  await expect(page.locator('[data-testid=step-status]')).toHaveText('Abgeschlossen');
  await expect(page.locator('[data-testid=next-step-status]')).toHaveText('READY');
});

test('QM resolves blocking NCR and unlocks successor', async ({ page }) => {
  await loginAs(page, 'qm@test.local');
  await page.goto('/ncr/NCR-0089');
  await page.click('[data-testid=disposition-rework]');
  await page.fill('[data-testid=reason]', 'Nacharbeit gemäß Verfahren X');
  await page.click('[data-testid=submit]');

  await expect(page.locator('[data-testid=ncr-status]')).toHaveText('REWORK');
});

test('Full offline-to-online completion flow', async ({ page, context }) => {
  await loginAs(page, 'worker@test.local');
  await preloadReleasedStep(page, 'ws-2');
  await context.setOffline(true);

  await completeStepLocally(page, 'ws-2');
  await expect(page.locator('[data-testid=status]')).toHaveText(
    'Lokal abgeschlossen – Serverfreigabe ausstehend.'
  );
  await expect(page.locator('[data-testid=next-step-locked]')).toBeVisible();

  await context.setOffline(false);
  await waitForSync(page);

  await expect(page.locator('[data-testid=status]')).toHaveText('Abgeschlossen');
  await expect(page.locator('[data-testid=next-step-status]')).toHaveText('READY');
});
```

---

## Ebene 7: Security Tests

**Fokus:** Mandantentrennung, IDOR, Uploads, Session, Rechteentzug.

```typescript
describe('Security: Tenant Isolation', () => {
  it('returns 404 (not 403) when accessing another org resource', async () => {
    const orgAUser = await createUser({ orgId: 'org-a' });
    const orgBStep = await createWorkStep({ orgId: 'org-b' });

    const response = await authenticatedRequest(orgAUser)
      .get(`/api/v1/work-steps/${orgBStep.id}`);

    expect(response.status).toBe(404);
    expect(response.body.detail).not.toContain(orgBStep.id);  // kein Leak
  });
});

describe('Security: Upload validation', () => {
  it('rejects executable disguised as image', async () => {
    const response = await uploadFile('malicious.exe.jpg', executableBuffer);
    expect(response.body.malwareScanStatus).toBe('INFECTED');
  });

  it('rejects oversized upload', async () => {
    const response = await uploadFile('huge.pdf', buffer(300 * 1024 * 1024));
    expect(response.status).toBe(413);
  });
});

describe('Security: Session & Permission Revocation', () => {
  it('immediately blocks action after role removed mid-session', async () => {
    const user = await createUser({ roles: ['WORKER'] });
    const token = await login(user);
    await removeRole(user.id, 'WORKER');

    const response = await authenticatedRequest(token).post('/api/v1/work-steps/ws-1/start');
    expect(response.status).toBe(403);
  });
});
```

---

## Ebene 8: Performance-/Lasttests

**Fokus:** Sync nach Schichtende (viele Geräte gleichzeitig), große Produktionsakten, Dashboard-Queries.

```
Szenario: Schichtwechsel-Sync
  - 200 Tablets synchronisieren gleichzeitig
  - Ziel: p95 Sync-Response < 3s, keine Deadlocks
  - Tool: k6 oder Artillery

Szenario: Große Produktionsakte
  - Auftrag mit 500 Arbeitsschritten, 2000 Fotos
  - Ziel: PDF-Export < 30s (async Job), ZIP-Export < 60s

Szenario: Dashboard unter Last
  - 50 gleichzeitige Projektleiter-Dashboards
  - Ziel: p95 API-Antwort < 500ms bei korrekter Pagination/Indizierung
```

---

## Ebene 9: Accessibility- und Browser-/Tablet-Tests

```typescript
test('Work step page meets WCAG 2.2 AA', async ({ page }) => {
  await page.goto('/orders/AUF-2026-0142/steps/7');
  const results = await new AxeBuilder({ page }).withTags(['wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

Matrix: Chrome/Safari (iOS/Android Tablet), Touch-Simulation, Landscape/Portrait.

---

## Ebene 10: Backup-Restore- und Migrationsproben

```
Wöchentlich automatisiert:
1. Restore letztes Backup in isolierte Umgebung
2. Verifiziere referenzielle Integrität (Audit ↔ Dateien ↔ DB)
3. Stichprobenhafter Vergleich: Produktionsakte vor/nach Restore identisch
4. Migrationen: forward-only, getestet gegen Produktionskopie vor jedem Release
```

---

## Unverzichtbare Negativtests (verbindlich aus Masterprompt)

| # | Test | Erwartetes Ergebnis | Testebene |
|---|---|---|---|
| 1 | Offline Schritt 5 abschließen, Schritt 6 starten | Start blockiert (`WORK_STEP_NOT_READY`) | PWA/Sync |
| 2 | Gefälschten `COMPLETED`-Status senden | Server weist ab, auditiert | Security + Unit |
| 3 | Abschlusskommando doppelt senden | Exakt ein Abschluss + Audit-Event | Integration |
| 4 | Dokumentrevision während Offline-Arbeit ändern | `REVISION_CONFLICT`, keine stille Umschreibung | Integration |
| 5 | Berechtigung vor Sync entziehen | Keine automatische Freigabe | Security |
| 6 | Fotoanforderung nicht erfüllt | Abschluss abgelehnt | Unit + Integration |
| 7 | Bildupload unvollständig/Hash falsch | Abschluss abgelehnt | Integration |
| 8 | Messwert außerhalb Toleranz | Prüfung negativ, NCR/Sperre gemäß Konfig | Unit + Integration |
| 9 | Ausführender versucht eigene Vier-Augen-Prüfung | Abgelehnt | Unit (DB Constraint) |
| 10 | Offene blockierende NCR | Nachfolger bleibt gesperrt | Integration |
| 11 | Abgelaufenes Prüfmittel bei Pflichtprüfung | Freigabe abgelehnt | Unit + Integration |
| 12 | Benutzer anderer Organisation errät Objekt-ID | 404/403 ohne Datenleck | Security |
| 13 | Parallele Syncs ändern dieselbe Entität | Kontrollierter Versionskonflikt | Integration |
| 14 | Serverausfall nach Dateiupload, vor Quittung | Wiederholung ohne Duplikat | PWA/Sync |
| 15 | Plan mit Zyklus freigeben | Validierungsfehler | Property-based |

**Diese 15 Tests sind CI-Gate:** Kein Merge in main ohne grüne Ausführung aller 15.

---

## Definition of Done (Checkliste pro Feature-Schnitt)

```markdown
- [ ] Fachliche Akzeptanzkriterien umgesetzt (inkl. Fehlerfälle)
- [ ] RBAC/ABAC serverseitig geprüft (nicht nur UI)
- [ ] Audit + Outbox transaktional geschrieben
- [ ] Migration vorwärts getestet + Restore-Weg verifiziert
- [ ] Unit Tests grün (Abdeckung ≥90% Domänenschicht)
- [ ] Integrationstests grün (reale DB/Storage)
- [ ] Relevante E2E-Tests grün
- [ ] Betroffene Negativtests aus obiger Liste grün
- [ ] TypeScript strict, kein `any` ohne Begründung
- [ ] Lint (ESLint) besteht ohne Warnungen
- [ ] Security Scan (SAST) ohne kritische Findings
- [ ] Accessibility Check (axe-core) ohne Violations
- [ ] Strukturierte Logs + relevante Metriken vorhanden
- [ ] Betriebsdokumentation aktualisiert (falls API/Config geändert)
- [ ] Keine kritischen TODOs im Code
- [ ] Keine bekannten Datenintegritätsfehler offen
```

---

## CI/CD-Pipeline-Gates

```yaml
# Konzeptionelle Pipeline-Stufen
stages:
  - lint_and_typecheck      # ESLint, tsc --noEmit
  - unit_tests               # Jest, Coverage-Gate 90% Domain
  - property_tests           # fast-check Suites
  - integration_tests        # Testcontainers PostgreSQL + MinIO
  - contract_tests           # OpenAPI + Event Schema Validation
  - security_negative_tests  # Die 15 verbindlichen Negativtests
  - build                    # Next.js Production Build
  - e2e_tests                # Playwright gegen Preview-Deployment
  - accessibility_tests      # axe-core gegen Preview-Deployment
  - sast_scan                 # Semgrep/CodeQL
  - dependency_scan           # Dependabot/Snyk
  - secret_scan                # gitleaks
  - deploy_staging
  - manual_acceptance         # dokumentierte manuelle Abnahme
  - deploy_production          # nur nach manueller Freigabe
```

---

## Nächste Schritte

→ **10_MVP_PLAN.md**: Priorisierter MVP- und Migrationsplan
