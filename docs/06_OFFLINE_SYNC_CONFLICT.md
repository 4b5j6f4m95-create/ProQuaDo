# 6. Offline-, Konflikt- und Wiederanlaufkonzept

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Die zentrale Invariante

> Ein bereits serverseitig freigegebener Arbeitsschritt darf offline bearbeitet und lokal fertiggestellt werden. Ein Folgeschritt darf jedoch erst begonnen werden, nachdem der Server den aktuellen Abschluss validiert, endgültig bestätigt und den Folgeschritt ausdrücklich freigegeben hat.

Dieses Dokument beschreibt, **wie diese Invariante technisch garantiert** wird – nicht nur organisatorisch versprochen.

---

## Architekturprinzip: Zwei-Ebenen-Autorität

```
┌─────────────────────────────────────────────────────┐
│ CLIENT (Lokale Autorität für Erfassung)             │
│ - Zeichnungen/Anweisungen anzeigen                  │
│ - Checklisten, Fotos, Messwerte erfassen            │
│ - Bestätigung/Signatur erfassen                     │
│ - Lokal "COMPLETED_PENDING_SYNC" markieren          │
│                                                       │
│ NIEMALS:                                            │
│ - "COMPLETED" final setzen                          │
│ - Folgeschritt freischalten                         │
│ - Dokumentrevision/Regel ändern                     │
└─────────────────────────┬─────────────────────────────┘
                           │ Outbox (signiert, idempotent)
┌─────────────────────────▼─────────────────────────────┐
│ SERVER (Alleinige Autorität für Prozessfortschritt)  │
│ - Validiert ALLE Bedingungen erneut                 │
│ - Setzt "COMPLETED" final                            │
│ - Ermittelt und gibt Folgeschritte frei             │
│ - Schreibt Audit + Outbox Event                     │
└───────────────────────────────────────────────────────┘
```

**Technischer Beweis der Invarianten-Einhaltung:**

1. Der Client-State-Machine-Typ kennt gar keinen Übergang zu `COMPLETED` – nur zu `COMPLETED_PENDING_SYNC`. Dies ist auf **Typ-Ebene** erzwungen (siehe unten).
2. Der nächste Arbeitsschritt bleibt lokal im Status `LOCKED`, bis ein Server-Event `work_step.released` empfangen und verarbeitet wurde.
3. Es gibt **keinen Client-Code-Pfad**, der lokal `READY` für einen noch nicht freigegebenen Schritt erzeugen kann – der Zustand kommt ausschließlich aus synchronisierten Server-Events.

---

## Release Token – Design

### Zweck
Beweis, dass **dieser konkrete Schritt** vor dem Offline-Gang serverseitig freigegeben war. Kein Freibrief für Folgeschritte.

### Struktur

```typescript
interface ReleaseToken {
  workStepInstanceId: string;
  productionOrderId: string;
  organizationId: string;
  releasedAt: string;               // ISO 8601
  issuingSystemInstance: string;     // server node id
  planRevisionId: string;
  requirementsVersion: string;       // hash of required checklist/photo/measurement config
  documentSetHash: string;           // hash of all bound document revisions
  entityVersion: number;
  tokenId: string;                   // server nonce, unique
  validUntil?: string;               // optional expiry
  signature: string;                 // HMAC-SHA256 or JWT signature
}
```

### Ausstellung

```typescript
async function issueReleaseToken(workStepInstanceId: string): Promise<ReleaseToken> {
  const step = await workStepRepo.findById(workStepInstanceId);
  const requirements = await requirementsService.snapshot(step);
  const documents = await documentBindingService.getReleasedRevisions(step);

  const token: Omit<ReleaseToken, 'signature'> = {
    workStepInstanceId,
    productionOrderId: step.productionOrderId,
    organizationId: step.organizationId,
    releasedAt: new Date().toISOString(),
    issuingSystemInstance: process.env.SERVER_NODE_ID,
    planRevisionId: step.planRevisionId,
    requirementsVersion: hashRequirements(requirements),
    documentSetHash: hashDocumentSet(documents),
    entityVersion: step.version,
    tokenId: generateNonce(),
  };

  const signature = signHmac(token, process.env.RELEASE_TOKEN_SECRET);

  // Persist for server-side revocation check
  await workStepReleaseRepo.create({
    workStepInstanceId,
    tokenHash: sha256(signature),
    tokenNonce: token.tokenId,
    isValid: true,
    ...token
  });

  return { ...token, signature };
}
```

### Validierung (bei `canStartWorkStep`)

```typescript
async function verifyReleaseToken(
  token: ReleaseToken,
  offline: boolean
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Signature check
  if (!verifyHmac(token, process.env.RELEASE_TOKEN_SECRET)) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  // 2. Expiry check
  if (token.validUntil && new Date(token.validUntil) < new Date()) {
    return { valid: false, reason: 'EXPIRED' };
  }

  // 3. Online-only: server-side revocation check
  if (!offline) {
    const record = await workStepReleaseRepo.findByNonce(token.tokenId);
    if (!record || !record.isValid) {
      return { valid: false, reason: 'REVOKED_OR_UNKNOWN' };
    }
  }
  // Offline: trust signature + local cache of last known valid tokens,
  // but final decision always re-validated on sync.

  return { valid: true };
}
```

**Wichtig:** Der Token beweist nur, dass *dieser* Schritt freigegeben war. Die Freigabe des **nächsten** Schritts erzeugt einen **eigenen, separaten Token**, ausgestellt erst nach serverseitiger Validierung des Vorgängerabschlusses. Es gibt keinen Mechanismus, der aus einem Token für Schritt N einen gültigen Zugriff für Schritt N+1 ableiten kann.

---

## Client State Machine (Typsicherheit)

Um zu verhindern, dass der Client versehentlich oder böswillig `COMPLETED` erzeugt, wird der Typ so modelliert, dass dieser Zustand im Client-Vokabular **nicht existiert**:

```typescript
// Client-seitiger Typ (bewusst eingeschränkt!)
type ClientWorkStepStatus =
  | 'LOCKED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED_PENDING_SYNC'
  | 'WAITING_FOR_SERVER'
  | 'SKIP_REQUEST_PENDING_SYNC'
  | 'SERVER_CONFIRMED_COMPLETED'   // read-only projection from server event
  | 'SERVER_CONFIRMED_REJECTED'    // read-only projection from server event
  | 'BLOCKED_BY_SERVER';            // read-only projection

// Es gibt KEINE Client-Funktion completeWorkStep() -> 'COMPLETED'
// Nur: prepareLocalCompletion() -> 'COMPLETED_PENDING_SYNC'

function prepareLocalCompletion(
  step: LocalWorkStep
): LocalWorkStep & { status: 'COMPLETED_PENDING_SYNC' } {
  assertAllRequirementsMetLocally(step);
  return { ...step, status: 'COMPLETED_PENDING_SYNC', localCompletedAt: clientNow() };
}

// 'SERVER_CONFIRMED_COMPLETED' kann NUR durch Verarbeitung eines
// eingehenden Sync-Events erzeugt werden, niemals durch lokale Nutzeraktion.
function applyServerEvent(event: DomainEvent, local: LocalWorkStep): LocalWorkStep {
  if (event.eventType === 'work_step.completed') {
    return { ...local, status: 'SERVER_CONFIRMED_COMPLETED', serverConfirmedAt: event.occurredAt };
  }
  // ...
}
```

Diese Trennung macht die Invariante **strukturell unmöglich zu verletzen** im Client-Code, statt sich nur auf Disziplin zu verlassen.

---

## Lokale Speicherung

### Datentrennung

| Kategorie | Speicherort | Verschlüsselung |
|---|---|---|
| Replizierte Referenzdaten (Pläne, Dokumente) | Lokale DB (IndexedDB/SQLite) | AES-256, Device-Key |
| Lokale Entwürfe (in Bearbeitung) | Lokale DB | AES-256 |
| Unveränderliche Outbox-Kommandos | Lokale DB, append-only Tabelle | AES-256 |
| Binärdateien (Fotos) | Lokales Dateisystem/Blob Storage | AES-256, mit Hash-Referenz |
| Sync-Cursor & bestätigte Versionen | Lokale DB | - |

### Lokales Mutation-Envelope

```typescript
interface LocalMutation {
  mutationId: string;        // UUID, generiert bei Erstellung
  deviceId: string;
  actorId: string;
  clientTimestamp: string;   // Erfassungszeit (bleibt erhalten!)
  sequenceNumber: number;    // monoton pro Device
  baseVersion: number;       // Version zum Zeitpunkt der lokalen Änderung
  payloadSchemaVersion: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;    // = mutationId, wiederverwendet bei Retry
}
```

---

## Synchronisationsprotokoll (Sequenzdetails)

```
┌──────────┐                                    ┌──────────┐
│  Client  │                                    │  Server  │
└────┬─────┘                                    └────┬─────┘
     │  1. Health Check (authenticated)              │
     ├───────────────────────────────────────────────>│
     │<───────────────────────────────────────────────┤
     │  2. Token Refresh + Device Status Check        │
     ├───────────────────────────────────────────────>│
     │<───────────────────────────────────────────────┤
     │  3. POST /sync/commands (Outbox, stable order)  │
     ├───────────────────────────────────────────────>│
     │                                                  │ Process each command:
     │                                                  │ - Idempotency check
     │                                                  │ - Full re-validation
     │                                                  │ - Atomic transaction
     │                                                  │ - Write audit + outbox
     │<───────────────────────────────────────────────┤
     │  4. Per-Command Response (deterministic)        │
     │     ACCEPTED | REJECTED | CONFLICT | DUPLICATE  │
     │                                                  │
     │  5. Large Photos: resumable, checksummed        │
     ├───────────────────────────────────────────────>│
     │<───────────────────────────────────────────────┤
     │  6. GET /sync/changes?cursor=X                  │
     ├───────────────────────────────────────────────>│
     │<───────────────────────────────────────────────┤
     │  7. Apply events to local projection (atomic)   │
     │                                                  │
     │  8. Mark Outbox entries confirmed                │
     │     (only after persisted server ack)           │
     │                                                  │
     │  9. Update UI: releases & locks immediately      │
     │                                                  │
```

### Wichtige Eigenschaften

1. **Stabile Reihenfolge:** Commands werden in der Reihenfolge verarbeitet, in der sie lokal erzeugt wurden (sequenceNumber), nicht parallel.
2. **Kein Rollback erfolgreicher Einträge:** Wenn Command 3 von 5 fehlschlägt, bleiben 1 und 2 bestätigt; 3-5 werden individuell markiert.
3. **Deterministische Antworten:** Gleicher Idempotency Key → immer gleiches Ergebnis, auch bei Netzwerk-Timeout und Retry.
4. **Bestätigung erst nach Persistenz:** Outbox-Eintrag wird lokal erst als "erledigt" markiert, nachdem die Serverantwort selbst lokal persistiert wurde (Schutz gegen Crash zwischen Empfang und Verarbeitung).

---

## Offline-Abschluss-Sequenz (Detailliert)

```
Zustand: IN_PROGRESS (offline, Release Token vorhanden)
   │
   │ Mitarbeiter füllt Checkliste, macht Fotos, erfasst Messwerte
   │
   ▼
Lokale Vollständigkeitsprüfung (Client-seitig, nur Vorprüfung!)
   │  - Pflichtfotos vorhanden? (Anzahl, nicht Qualität)
   │  - Checkliste vollständig?
   │  - Messwerte erfasst? (nicht Toleranzprüfung - das macht Server!)
   │  - Bestätigung/Signatur vorhanden?
   │
   ▼
prepareLocalCompletion()
   │
   ▼
Status: COMPLETED_PENDING_SYNC
UI: "Lokal abgeschlossen – Serverfreigabe ausstehend."
Folgeschritt UI: "Gesperrt. Für die Freigabe ist eine Verbindung 
                  zum Server und eine erfolgreiche Prüfung erforderlich."
   │
   │ (Verbindung wird wiederhergestellt)
   │
   ▼
Sync: Outbox sendet CompletionSubmission
   │
   ▼
Status: WAITING_FOR_SERVER
   │
   ▼
Server: validateAndCompleteWorkStep()
   │  - ALLE Bedingungen aus 03_STATE_MACHINES.md erneut geprüft
   │  - Nicht nur "Foto vorhanden", sondern "Foto integer, Hash korrekt"
   │  - Nicht nur "Messwert vorhanden", sondern "innerhalb Toleranz"
   │  - Vier-Augen-Regel falls zutreffend
   │  - Revision-Vergleich (aktuell vs. zum Ausführungszeitpunkt)
   │
   ├─── Erfolg ──→ Status: COMPLETED
   │               → releaseEligibleSuccessors()
   │               → Event: work_step.completed
   │               → Event: work_step.released (für Folgeschritt)
   │
   └─── Fehler ──→ Status: COMPLETION_REJECTED
                   → Event: work_step.completion_rejected
                   → UI zeigt konkrete Gründe + nächste Handlung
```

---

## Konfliktbehandlung (Detailliert)

### Kein Last-Write-Wins für Qualitätsdaten

Jeder Konflikt wird explizit an einen berechtigten Menschen zur Entscheidung weitergegeben – niemals automatisch aufgelöst, wenn Qualitätsdaten betroffen sind.

### Konflikttyp: REVISION_CONFLICT (Referenzszenario C aus Masterprompt)

```
Zeitleiste:
T0: Schritt 2 wird online freigegeben, referenziert Dok P-102 Rev.04
T1: Mitarbeiter geht offline, arbeitet an Schritt 2 (Rev.04 im Cache)
T2: Projektleiter gibt online Rev.05 für P-102 frei (Rev.04 → SUPERSEDED)
T3: Mitarbeiter schließt Schritt 2 offline ab (immer noch mit Rev.04-Kontext)
T4: Mitarbeiter kommt online, synchronisiert

Server-Verarbeitung bei T4:
  1. CompletionSubmission enthält usedDocumentRevisionIds = [Rev.04-ID]
  2. Server prüft: Ist Rev.04 noch die "aktuell gültige" Revision? NEIN (Rev.05 aktiv)
  3. Server erzeugt REVISION_CONFLICT, OHNE die Ausführung zu verwerfen
  4. Historie bleibt: "ausgeführt nach Rev.04" (schreibgeschützt)
  5. work_step_instance.status → BLOCKED (nicht COMPLETED, nicht REJECTED)
  6. Benachrichtigung an Projektleiter/QM: "Konflikt zu entscheiden"

Berechtigte Person entscheidet (auditiert):
  a) "Weiterhin gültig" → Schritt wird trotzdem COMPLETED (mit Rev.04-Referenz + Entscheidungsvermerk)
  b) "Zusatzprüfung erforderlich" → neuer Prüfschritt wird eingefügt
  c) "Nacharbeit erforderlich" → REWORK_REQUIRED, NCR erzeugt
  d) "Wiederholung erforderlich" → Schritt wird zurückgesetzt, neu mit Rev.05 gestartet
  e) "Produktsperre" → production_hold erzeugt

Alle Entscheidungen: conflict_decisions Tabelle mit Grund, Person, Zeitpunkt.
Die Historie wird NIE auf Rev.05 umgeschrieben.
```

### Konflikttyp: PERMISSION_REVOKED

```typescript
async function handleSyncCommand(command: SyncCommand): Promise<CommandResult> {
  const actor = await userRepo.findById(command.actorId);
  const hasPermission = await authz.can({
    userId: actor.id,
    action: command.requiredPermission,
    resource: command.resource
  });

  if (!hasPermission) {
    // WICHTIG: Wir verwerfen die Daten NICHT, sondern markieren sie
    // als historisches Faktum ohne automatische Freigabewirkung.
    await preserveAsHistoricalFact(command);
    return {
      status: 'CONFLICT',
      conflictType: 'PERMISSION_REVOKED',
      conflictDetail: {
        message: 'Berechtigung wurde vor Synchronisation entzogen. ' +
                  'Die erfassten Daten bleiben erhalten, erfordern aber ' +
                  'eine Entscheidung durch eine berechtigte Person.'
      }
    };
  }
  // ... normal processing
}
```

### Konflikttyp: ENTITY_VERSION_CONFLICT

```typescript
// Optimistic Locking Standard-Pattern
if (command.baseVersion !== currentEntity.version) {
  return {
    status: 'CONFLICT',
    conflictType: 'ENTITY_VERSION_CONFLICT',
    conflictDetail: {
      clientVersion: command.baseVersion,
      serverVersion: currentEntity.version,
      serverState: currentEntity  // damit Client informierte Entscheidung treffen kann
    }
  };
}
```

### Konflikttyp: MISSING_OR_CORRUPT_EVIDENCE

```typescript
async function validatePhotoEvidence(photoId: string): Promise<ValidationResult> {
  const photo = await photoRepo.findById(photoId);
  const actualHash = await computeS3ObjectHash(photo.storageKey);

  if (actualHash !== photo.fileHashSha256) {
    return {
      valid: false,
      conflictType: 'MISSING_OR_CORRUPT_EVIDENCE',
      action: 'REQUEST_REUPLOAD'
    };
  }
  return { valid: true };
}
```

---

## Resumable Upload (Fotos)

```typescript
interface ResumableUploadState {
  photoId: string;
  totalBytes: number;
  uploadedBytes: number;
  chunkSize: number;
  chunkHashes: string[];  // per-chunk SHA-256 for integrity
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

// Client retries from last confirmed chunk, not from zero
async function resumeUpload(photoId: string): Promise<void> {
  const state = await localDb.uploadState.get(photoId);
  const serverState = await api.get(`/photo-evidence/${photoId}/upload-status`);
  
  const resumeFrom = Math.min(state.uploadedBytes, serverState.confirmedBytes);
  await uploadChunksFrom(photoId, resumeFrom);
}
```

**Serverausfall nach Upload, vor Quittung (Negativtest #14):**
- Client hat lokalen `uploadedBytes` Stand
- Bei Retry: Server prüft bereits vorhandene Chunks via Hash, akzeptiert nur fehlende
- Kein Duplikat durch clientseitige Chunk-ID + serverseitige Deduplication

---

## Geräteverlust und Sicherheit

| Maßnahme | Umsetzung |
|---|---|
| Lokale Daten verschlüsselt | AES-256, Schlüssel abgeleitet aus Device-Keystore + User-Auth |
| Bindung an Benutzer/Gerät | Device Registration mit `devices` Tabelle, gebunden an aktuelle Session |
| Remote-Widerruf | Admin kann Device sperren; nächster Sync-Health-Check schlägt fehl, erzwingt Re-Login oder Datenlöschung |
| Aufbewahrung von Cache | Konfigurierbare TTL (z.B. 30 Tage), automatische Bereinigung nicht-synchronisierter *bestätigter* Daten |
| Warnung bei Speicherplatz | UI-Banner ab 90% Belegung, keine automatische Löschung unbestätigter Daten |
| Export-Verhinderung | Keine "Share"-Funktion für Rohdaten auf Produktionsgeräten (MDM/App-Konfiguration) |
| Backpressure | Upload-Warteschlange mit sichtbarem Status (Anzahl ausstehend, Größe) |

---

## Negativtest-Rückverfolgung (aus Masterprompt Kap. 18)

| # | Test | Wie dieses Konzept es garantiert |
|---|---|---|
| 1 | Offline Schritt 5 abschließen, Schritt 6 starten | Schritt 6 bleibt `LOCKED` bis `work_step.released`-Event lokal verarbeitet; Client kennt keinen Übergang zu `READY` ohne Server-Event |
| 2 | Gefälschten COMPLETED senden | Client-Typ kennt `COMPLETED` nicht als sendbaren Zustand; Server validiert Signatur des Release Tokens und alle Bedingungen unabhängig |
| 3 | Doppeltes Abschlusskommando | Idempotency Key dedupliziert; exakt ein Audit-Event |
| 4 | Dokumentrevision während Offline geändert | `REVISION_CONFLICT`, Historie bleibt bei alter Revision |
| 5 | Recht vor Sync entzogen | `PERMISSION_REVOKED`, keine automatische Freigabe |
| 13 | Parallele Syncs, gleiche Entität | `ENTITY_VERSION_CONFLICT` via Optimistic Locking |
| 14 | Serverausfall nach Upload, vor Quittung | Chunk-Hash-basiertes Resume, keine Duplikate |

---

## Nächste Schritte

→ **07_WIREFLOWS_UX.md**: UX-Flows für alle Rollen, insbesondere Offline-Statusanzeigen
