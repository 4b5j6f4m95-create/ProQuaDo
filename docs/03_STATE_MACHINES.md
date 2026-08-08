# 3. Zustandsautomaten und Zustandsübergänge

**Dokumentversion:** 1.0  
**Status:** Foundation  
**Gültig ab:** 2026-08-08  

---

## Übersicht

Alle kritischen Entitäten folgen expliziten, serverseitig durchgesetzten State Machines. Transitionsregeln sind Guard Conditions, nicht versteckte Geschäftslogik im Code.

---

## 1. Production Order Status Machine

```
                    ┌─ CANCELLED
                    │
DRAFT ──plan──→ PLANNED ──release──→ RELEASED ──start──→ IN_PROGRESS ──complete──→ COMPLETED
                                          ↑                    │
                                          │                    ├─→ PAUSED (manual)
                                          │                    ├─→ ON_HOLD (manual)
                                          └────resume───────────┘

QUALITY_BLOCKED ←─── (NCR, Hold)
       ↓ (resolve NCR)
   IN_PROGRESS

Any → ARCHIVED (retention expired)
```

### Transitionsregeln

| Von | Zu | Bedingungen | Service |
|-----|----|-------------|---------|
| DRAFT | PLANNED | Projektleiter autorisiert, Auftragsdetails vollständig | releaseProductionOrder |
| PLANNED | RELEASED | Plan freigegeben, alle Dokumente verfügbar | releaseProductionOrder |
| RELEASED | IN_PROGRESS | Erster Schritt gestartet | releasedNextWorkStep |
| IN_PROGRESS | COMPLETED | Alle Schritte bestätigt, Endprüfung OK | completeProductionOrder |
| IN_PROGRESS | ON_HOLD | Produktionsleiter verhängt Hold | applyProductionHold |
| IN_PROGRESS | QUALITY_BLOCKED | Blockierende NCR offen | raiseNonConformance |
| ON_HOLD | IN_PROGRESS | Grund behoben | releaseProductionHold |
| QUALITY_BLOCKED | IN_PROGRESS | NCR behoben/freigegeben | resolveNonConformance |
| IN_PROGRESS | CANCELLED | Abbruch | cancelProductionOrder |
| * | ARCHIVED | Aufbewahrungsfrist abgelaufen | archiveProductionOrder (async) |

---

## 2. Work Step Instance Status Machine

```
LOCKED
  │
  ├─ (deps fulfilled, plan released)
  │
  ▼
READY ─ (start)──→ IN_PROGRESS
  ▲                    │
  │                    ├─ (pause) ──→ PAUSED ─ (resume) ──→ IN_PROGRESS
  │                    │
  │                    ├─ (complete locally) ──→ COMPLETED_PENDING_SYNC
  │                    │                            │
  │                    │                            ├─ (go offline)
  │                    │                            │
  │                    │                            ├─ (sync) ──→ WAITING_FOR_SERVER
  │                    │                                          │
  │                    │                                          ├─ (server validates)
  │                    │                                          │
  │                    │                                          ▼
  │                    │                                    VALIDATING
  │                    │                                         │
  │                    │        ┌────────────────────────────────┤
  │                    │        │                                │
  │                    │        ├─ (validation OK) ─→ COMPLETED  │
  │                    │        │                                │
  │                    │        ├─ (validation fail) ────────────┘
  │                    │        │
  │                    └───────→ COMPLETION_REJECTED
  │
  ├─ (skip request approved) ──→ SKIPPED
  │
  ├─ (NCR blocking) ──→ BLOCKED
  │                         │
  │                         ├─ (rework created)
  │                         │
  │                         ▼
  │                    REWORK_REQUIRED ─────┐
  │                                          │
  │                         ┌────────────────┘
  │                         │
  │                         ▼
  │                    IN_PROGRESS (rework)
  │
  └─ (superseded by plan change) ──→ SUPERSEDED

AWAITING_SECOND_APPROVAL (sub-state during VALIDATING)
  ├─ (reviewer approves)
  │   ▼
  ├─→ COMPLETED
  │
  └─ (reviewer rejects)
      ▼
      COMPLETION_REJECTED
```

### Transitionsregeln

| Von | Zu | Bedingungen | Service |
|-----|----|-------------|---------|
| LOCKED | READY | Abhängigkeiten erfüllt, Plan/Dokumente freigegeben, Server autorisiert | releaseEligibleSuccessors |
| READY | IN_PROGRESS | User autorisisiert, Release Token gültig, Gerät online oder offline mit Token | canStartWorkStep + startWorkStep |
| IN_PROGRESS | PAUSED | Mitarbeiter pausiert manuell | pauseWorkStep |
| PAUSED | IN_PROGRESS | Mitarbeiter setzt fort | resumeWorkStep |
| IN_PROGRESS | COMPLETED_PENDING_SYNC | Client hat alle Erforderungen erfüllt, lokal abgeschlossen | prepareLocalCompletion |
| COMPLETED_PENDING_SYNC | WAITING_FOR_SERVER | Synchronisation versendet Kommando | syncOutbox |
| WAITING_FOR_SERVER | VALIDATING | Server empfängt Validierungskommando | validateAndCompleteWorkStep |
| VALIDATING | AWAITING_SECOND_APPROVAL | Vier-Augen-Regel gilt und Reviewer zugewiesen | (intermediate state) |
| AWAITING_SECOND_APPROVAL | COMPLETED | Reviewer akzeptiert oder Auto-Approval | releaseSecondApproval |
| VALIDATING | COMPLETED | Vier-Augen nicht erforderlich, Validation OK | (direct) |
| VALIDATING | COMPLETION_REJECTED | Validation fehlgeschlagen (Foto, Messwert, Toleranz, etc.) | validateAndCompleteWorkStep |
| IN_PROGRESS | LOCKED | Dokumentrevision/Plan geändert, Auswirkung blockiert | resolveRevisionConflict |
| IN_PROGRESS | BLOCKED | Blockierende NCR geöffnet | raiseNonConformance |
| BLOCKED | IN_PROGRESS | NCR behoben/freigegeben | resolveNonConformance |
| READY, IN_PROGRESS | SKIP_REQUESTED | Offline Skip-Request eingegangen | requestSkip |
| SKIP_REQUESTED | SKIPPED | Genehmigt | decideSkip |
| SKIP_REQUESTED | IN_PROGRESS | Abgelehnt | decideSkip |
| IN_PROGRESS | REWORK_REQUIRED | NCR entstand, Nacharbeit erforderlich | raiseNonConformance + createReworkStep |
| * | SUPERSEDED | Plan geändert, Schritt veraltet | archiveWorkStepInstance |

---

## 3. Document Revision Status Machine

```
DRAFT
  │
  ├─ (upload complete, change reason set)
  │
  ▼
IN_REVIEW ─ (reviewer submits)
  │
  ├─ (approved) ──→ APPROVED ─ (release) ──→ RELEASED
  │                                              │
  │                                              ├─ (supersede) ──→ SUPERSEDED
  │                                              │
  │                                              └─ (withdraw) ──→ WITHDRAWN
  │
  └─ (rejected) ──→ DRAFT (zurück zur Überarbeitung)
```

### Transitionsregeln

| Von | Zu | Bedingungen | Service |
|-----|----|-------------|---------|
| DRAFT | IN_REVIEW | Datei vollständig hochgeladen, SHA-256 verifiziert, Malware-Scan OK | submitDocumentRevisionForReview |
| IN_REVIEW | APPROVED | QM/PM genehmigt Revision | approveDocumentRevision |
| IN_REVIEW | DRAFT | Reviewer lehnt ab mit Grund | rejectDocumentRevision |
| APPROVED | RELEASED | Projektleiter freigegeben (ggf. mit Vier-Augen) | releaseDocumentRevision |
| RELEASED | SUPERSEDED | Neuere Revision freigegeben | (automatic via new release) |
| RELEASED | WITHDRAWN | Fehler erkannt, Rückzug | withdrawDocumentRevision |
| * | ARCHIVED | Aufbewahrungsfrist abgelaufen | archiveDocument (async) |

**Regeln:**
- Nur RELEASED Revisionen dürfen neu Schritte verbindlich festlegen
- SUPERSEDED & WITHDRAWN Revisionen bleiben lesbar (audit)
- Wechsel zu RELEASED erzeugt Audit Event mit Freigabegrund

---

## 4. Production Plan Revision Status Machine

```
DRAFT ─ (submit for review)
  │
  ├─ (review complete)
  │
  ▼
IN_REVIEW ─ (approved)
  │
  ├─→ APPROVED ─ (release)
  │                │
  │                ├─→ RELEASED
  │                │      │
  │                │      ├─ (new revision created)
  │                │      │   ▼
  │                │      └─→ SUPERSEDED
  │                │
  │                └─ (cyclic dependency detected)
  │                     ▼
  │                  DRAFT (validation fail)
  │
  └─ (rejected)
       ▼
     DRAFT (überarbeiten)
```

### Transitionsregeln

| Von | Zu | Bedingungen | Service |
|-----|----|-------------|---------|
| DRAFT | IN_REVIEW | Plan-Struktur validiert, keine Zyklen, Schritte definiert | submitProductionPlanForReview |
| IN_REVIEW | APPROVED | QM validiert, Abhängigkeiten OK | approveProductionPlan |
| APPROVED | RELEASED | Projektleiter freigegeben | releaseProductionPlan |
| RELEASED | SUPERSEDED | Neue Version freigegeben | (automatic) |
| IN_REVIEW | DRAFT | Reviewer findet Fehler (z.B. Zyklus) | rejectProductionPlan + reason |
| RELEASED | * (LOCKED incoming orders) | Plan enthält Fehler | blockIncomingOrders + notifyPL |

**Regeln:**
- Zyklus-Check vor Freigabe erzwungen
- Neue Revision bei Änderung an RELEASED Revision
- Auswirkungsanalyse auf laufende Aufträge erzeugen

---

## 5. Non-Conformance (NCR) Status Machine

```
DRAFT
  │
  ├─ (submit)
  │
  ▼
OPEN ─ (QM assessment)
  │
  ├─→ ASSESSMENT_REQUIRED ─ (immediate containment)
  │                            │
  │                            ├─→ CONTAINMENT ─ (root cause analysis)
  │                            │                    │
  │                            │                    ├─→ REWORK (if product issue)
  │                            │                    │      │
  │                            │                    │      ├─→ REINSPECTION ─ (verification)
  │                            │                    │      │                      │
  │                            │                    │      │                      └─→ AWAITING_DISPOSITION
  │                            │                    │      │
  │                            │                    └─→ AWAITING_DISPOSITION
  │                            │
  │                            └─ (no rework needed)
  │                                 ▼
  │                            AWAITING_DISPOSITION ─ (QM decides)
  │                                                     │
  │                                                     ├─ (accepted) ──→ CLOSED
  │                                                     │
  │                                                     └─ (requires action) ──→ REWORK
  │
  └─ (cancel) ──→ CANCELLED
```

### Transitionsregeln

| Von | Zu | Bedingungen | Service |
|-----|----|-------------|---------|
| DRAFT | OPEN | Vollständig erfasst, Melder, Kategorie | submitNonConformance |
| OPEN | ASSESSMENT_REQUIRED | QM bewertet | assessNonConformance |
| ASSESSMENT_REQUIRED | CONTAINMENT | Sofortmaßnahme definiert | containNonConformance |
| CONTAINMENT | REWORK | Ursache erfordert Produktänderung | createReworkStep |
| REWORK | REINSPECTION | Nacharbeit durchgeführt | completeRework |
| REINSPECTION | AWAITING_DISPOSITION | Nachprüfung bestätigt/lehnt ab | completeReinspection |
| AWAITING_DISPOSITION | CLOSED | QM akzeptiert Lösung | disposeNonConformance |
| * | CANCELLED | NCR obsolet/doppelt | cancelNonConformance |

**Regeln:**
- Blockierend vs. Nicht-Blockierend wird serverseitig klassifiziert
- Blockierende NCR sperrt den Nachfolgeschritt
- CLOSED sperren wird automatisch aufgehoben (wenn BLOCKING)

---

## 6. Sync & Conflict State Machine

```
ONLINE
  │
  ├─ (connection lost)
  │
  ▼
OFFLINE ─ (work locally)
  │       - edit data
  │       - store in Outbox
  │       - maintain local state
  │
  ├─ (try sync)
  │   ▼
  SYNCING_OUTBOX ─ (send commands)
  │                 ▼
  │             OUTBOX_SENT
  │                 │
  │                 ├─ (server validates each command)
  │                 │   ▼
  │                 PROCESSING_RESPONSES
  │                 │
  │                 ├─ (idempotent dup) ──→ DUPLICATE
  │                 │
  │                 ├─ (permission revoked) ──→ CONFLICT_PERMISSION
  │                 │
  │                 ├─ (entity version mismatch) ──→ CONFLICT_VERSION
  │                 │
  │                 ├─ (doc revision changed) ──→ CONFLICT_REVISION
  │                 │
  │                 ├─ (order on hold) ──→ CONFLICT_ORDER_BLOCKED
  │                 │
  │                 └─ (OK) ──→ CONFIRMED
  │
  │ CONFLICT_* states require User Decision
  │   ├─ Accept & Continue
  │   ├─ Retry
  │   ├─ Cancel & Rollback Local
  │
  ├─ (fetch changes since cursor)
  │   ▼
  SYNCING_INBOX ─ (apply events)
  │                 ▼
  │             PROJECTING_LOCAL_STATE
  │                 │
  │                 ├─ (project OK)
  │                 │   ▼
  │
  ▼
ONLINE
```

### Konflikttypen

| Konflikt | Ursache | Behebung |
|----------|--------|----------|
| `REVISION_CONFLICT` | Plan/Doc während Offline geändert | Benutzer wählt: akzeptieren/nacharbeit/abbruch |
| `PERMISSION_REVOKED` | Rolle entzogen seit Offline-Start | Entwurf abbrechen, neu starten |
| `ENTITY_VERSION_CONFLICT` | Paralleles Update auf Server | Merge oder Rollback |
| `DUPLICATE_COMMAND` | Idempotency Key existiert | Wiederholung OK, keine Fehler |
| `ORDER_ON_HOLD` | Auftrag wurde gesperrt | Warten auf Hold-Release, dann retry |
| `BLOCKING_NCR` | NCR offen geworden | Nacharbeit + Nachprüfung erforderlich |
| `MISSING_OR_CORRUPT_EVIDENCE` | Foto/Messwert Upload fehlgeschlagen | Retry Upload oder neu erfassen |

---

## Implementation Guidelines

### State Machine Engine (serverseitig)

```typescript
// Pseudocode
interface StateTransition {
  from: WorkStepStatus,
  to: WorkStepStatus,
  guard: (context: TransitionContext) => boolean,
  action: (context: TransitionContext) => Promise<void>
}

async function canTransition(
  context: TransitionContext
): Promise<{ allowed: boolean, reason?: string }> {
  const transition = findTransition(context.from, context.to);
  if (!transition) return { allowed: false, reason: 'INVALID_TRANSITION' };
  return { allowed: await transition.guard(context) };
}

async function executeTransition(
  context: TransitionContext,
  transition: StateTransition
): Promise<void> {
  const tx = db.transaction();
  try {
    // 1. Verify pre-conditions again (double-check)
    if (!await transition.guard(context)) throw new GuardError();
    
    // 2. Update entity status atomically
    await updateStatus(tx, context.entityId, transition.to);
    
    // 3. Execute domain action
    await transition.action(context);
    
    // 4. Write audit event
    await writeAuditEvent(tx, {
      eventType: `${context.entityType}.transitioned`,
      previousValues: { status: context.from },
      newValues: { status: transition.to },
      ...context
    });
    
    // 5. Write outbox events for downstream
    await writeOutboxEvent(tx, context);
    
    // Commit atomically
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
```

### Guard Condition Patterns

```typescript
// Example: startWorkStep guard
async function canStartWorkStep(context: {
  workStepInstanceId: UUID,
  userId: UUID,
  releaseToken: string
}): Promise<Decision> {
  const step = await workStepRepo.findById(context.workStepInstanceId);
  
  // Check preconditions in sequence
  if (step.status !== 'READY') {
    return { allowed: false, reason: 'NOT_READY' };
  }
  
  // Verify release token
  const tokenValid = await releaseTokenService.verify(
    context.workStepInstanceId,
    context.releaseToken,
    { offline: isOffline() }
  );
  if (!tokenValid) {
    return { allowed: false, reason: 'INVALID_RELEASE_TOKEN' };
  }
  
  // Check authorization
  const isAuthorized = await authz.can(context.userId, 'work_step.execute', step);
  if (!isAuthorized) {
    return { allowed: false, reason: 'UNAUTHORIZED' };
  }
  
  // Check qualification currency
  const qualified = await qualificationService.isCurrentlyQualified(
    context.userId,
    step.requiredQualification
  );
  if (!qualified) {
    return { allowed: false, reason: 'NOT_QUALIFIED' };
  }
  
  return { allowed: true };
}

interface Decision {
  allowed: boolean;
  reason?: string;  // machine-readable code
  message?: string; // human-readable (German)
  nextAction?: string; // UI hint
}
```

---

## Testing State Machines

### Property-based Test Example

```typescript
// Use fast-check or similar
import fc from 'fast-check';

const validTransitions = [
  { from: 'LOCKED', to: 'READY' },
  { from: 'READY', to: 'IN_PROGRESS' },
  // ...
];

const invalidTransitions = [
  { from: 'COMPLETED', to: 'IN_PROGRESS' },  // should fail
  { from: 'LOCKED', to: 'COMPLETED' },        // should fail
  // ...
];

it('all valid transitions succeed', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(...validTransitions.map(t => fc.constant(t))),
      async (transition) => {
        const result = await canTransition({
          entityId: uuid(),
          from: transition.from,
          to: transition.to,
          userId: uuid(),
          organizationId: uuid()
        });
        expect(result.allowed).toBe(true);
      }
    ),
    { numRuns: 1000 }
  );
});

it('no invalid transitions succeed', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(...invalidTransitions.map(t => fc.constant(t))),
      async (transition) => {
        const result = await canTransition({...transition});
        expect(result.allowed).toBe(false);
      }
    )
  );
});
```

---

## Nächste Schritte

→ **04_ROLES_PERMISSIONS_MATRIX.md**: RBAC/ABAC Modell, Berechtigungsatome
