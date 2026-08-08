# 5. API- und Event-Verträge

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Grundprinzipien

- Versionierte REST/JSON API: `/api/v1/...`
- Keine generischen CRUD-Endpunkte für kritische Zustände (nur Domänenkommandos)
- Idempotency Key **verpflichtend** für alle mobilen Schreiboperationen
- ETag/Version für optimistisches Locking bei konkurrierender Bearbeitung
- RFC-7807-ähnliche Fehlerobjekte
- Cursor-Pagination mit stabiler Sortierung
- Upload über kurzlebige signierte URLs, Abschluss per Hash-Bestätigung

---

## Standard-Fehlerformat (RFC 7807-ähnlich)

```typescript
interface ApiError {
  type: string;           // URI-Referenz, z.B. "/errors/validation-failed"
  title: string;           // Kurzbeschreibung
  status: number;          // HTTP Status Code
  code: string;            // maschinenlesbarer Code, z.B. "WORK_STEP_NOT_READY"
  detail: string;          // Beschreibung (deutsch)
  instance: string;        // betroffener Request-Pfad
  correlationId: string;   // für Support/Debugging
  affectedObject?: {
    type: string;
    id: string;
  };
  nextAction?: string;     // UI-Hinweis, z.B. "RETRY_AFTER_SYNC"
  errors?: Array<{
    field: string;
    message: string;
  }>;
}
```

**Beispiel:**
```json
{
  "type": "/errors/work-step-not-ready",
  "title": "Arbeitsschritt nicht freigegeben",
  "status": 409,
  "code": "WORK_STEP_NOT_READY",
  "detail": "Der Arbeitsschritt wurde noch nicht serverseitig freigegeben.",
  "instance": "/api/v1/work-steps/abc-123/start",
  "correlationId": "req_9f8e7d6c",
  "affectedObject": { "type": "work_step_instance", "id": "abc-123" },
  "nextAction": "WAIT_FOR_RELEASE"
}
```

---

## Standard Error Codes (Auszug)

| Code | HTTP Status | Bedeutung |
|---|---|---|
| `WORK_STEP_NOT_READY` | 409 | Schritt nicht freigegeben |
| `INVALID_RELEASE_TOKEN` | 403 | Release Token ungültig/abgelaufen |
| `PERMISSION_DENIED` | 403 | RBAC-Prüfung fehlgeschlagen |
| `NOT_QUALIFIED` | 403 | Qualifikation fehlt/abgelaufen |
| `CROSS_TENANT_ACCESS_DENIED` | 404 | Mandantengrenze verletzt (kein Leak) |
| `ENTITY_VERSION_CONFLICT` | 409 | Optimistic Lock Konflikt |
| `REVISION_CONFLICT` | 409 | Dokument/Plan-Revision geändert |
| `DUPLICATE_COMMAND` | 200/409* | Idempotency Key bereits verarbeitet |
| `MISSING_REQUIRED_EVIDENCE` | 422 | Pflichtnachweis fehlt |
| `MEASUREMENT_OUT_OF_TOLERANCE` | 422 | Messwert außerhalb Toleranz |
| `BLOCKING_NCR_OPEN` | 423 | Blockierende NCR verhindert Fortschritt |
| `EQUIPMENT_CALIBRATION_EXPIRED` | 422 | Prüfmittel nicht kalibriert |
| `SAME_PERSON_REVIEW_DENIED` | 403 | Vier-Augen verletzt |
| `PLAN_CYCLE_DETECTED` | 422 | Zyklische Abhängigkeit im Plan |
| `ORDER_ON_HOLD` | 423 | Auftrag gesperrt |
| `MALWARE_DETECTED` | 422 | Datei-Scan fehlgeschlagen |

`*` DUPLICATE_COMMAND gibt bei erfolgreicher Erstverarbeitung 200 mit Originalergebnis zurück (echte Idempotenz), nicht 409.

---

## Idempotency & Concurrency

### Idempotency Key
```http
POST /api/v1/work-steps/{id}/completion-submissions
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

- Client generiert UUID pro logischer Operation (nicht pro HTTP-Retry)
- Server speichert `(organization_id, device_id, idempotency_key)` eindeutig
- Bei Wiederholung: identisches Ergebnis zurückgeben, keine Doppelverarbeitung
- Key TTL: 7 Tage (konfigurierbar)

### ETag / Version
```http
GET /api/v1/work-steps/abc-123
→ ETag: "v5"

PUT /api/v1/work-steps/abc-123
If-Match: "v5"
→ 412 Precondition Failed (wenn Version nicht mehr aktuell)
```

---

## Kern-Endpunkte

### Work Step Lifecycle

```http
GET    /api/v1/work-steps/{id}
POST   /api/v1/work-steps/{id}/start
POST   /api/v1/work-steps/{id}/pause
POST   /api/v1/work-steps/{id}/resume
POST   /api/v1/work-steps/{id}/completion-submissions
GET    /api/v1/completion-submissions/{id}
POST   /api/v1/completion-submissions/{id}/validate
POST   /api/v1/work-steps/{id}/skip-requests
POST   /api/v1/skip-requests/{id}/decision
POST   /api/v1/work-steps/{id}/checklist-responses
POST   /api/v1/work-steps/{id}/measurement-results
POST   /api/v1/work-steps/{id}/photo-evidence/upload-url
POST   /api/v1/photo-evidence/{id}/complete
POST   /api/v1/work-steps/{id}/confirmations
POST   /api/v1/second-approvals/{id}/decision
```

#### Beispiel: Start Work Step

```typescript
// POST /api/v1/work-steps/{id}/start
interface StartWorkStepRequest {
  releaseToken: string;
  clientTimestamp: string;  // ISO 8601
  deviceId: string;
}

interface StartWorkStepResponse {
  workStepInstanceId: string;
  status: 'IN_PROGRESS';
  startedAt: string;
  version: number;
}

// Error cases:
// 409 WORK_STEP_NOT_READY
// 403 INVALID_RELEASE_TOKEN
// 403 PERMISSION_DENIED
// 403 NOT_QUALIFIED
```

#### Beispiel: Completion Submission

```typescript
// POST /api/v1/work-steps/{id}/completion-submissions
interface CompletionSubmissionRequest {
  idempotencyKey: string;
  clientCompletedAt: string;  // ISO 8601, erfasst offline
  usedDocumentRevisionIds: string[];
  entityVersion: number;      // optimistic lock
  confirmation: {
    confirmationTextVersion: string;
    signatureMethod: 'PIN' | 'DIGITAL_SIGNATURE';
    signatureData: string;
  };
}

interface CompletionSubmissionResponse {
  submissionId: string;
  status: 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
  workStepStatus: WorkStepStatus;
  nextStepReleased: boolean;
  validationErrors?: Array<{ code: string; detail: string }>;
}
```

#### Beispiel: Validate Completion (Server-Side, from Sync)

```typescript
// POST /api/v1/completion-submissions/{id}/validate
interface ValidateCompletionResponse {
  result: 'COMPLETED' | 'REJECTED' | 'AWAITING_SECOND_APPROVAL';
  rejectionReasons?: Array<{
    code: string;   // e.g. 'MEASUREMENT_OUT_OF_TOLERANCE'
    detail: string;
    affectedField?: string;
  }>;
  nextStepInstanceIds?: string[];  // released successors
  auditEventId: string;
}
```

---

### Non-Conformance

```http
POST   /api/v1/non-conformances
GET    /api/v1/non-conformances/{id}
POST   /api/v1/non-conformances/{id}/assess
POST   /api/v1/non-conformances/{id}/containment
POST   /api/v1/non-conformances/{id}/rework-steps
POST   /api/v1/non-conformances/{id}/reinspections
POST   /api/v1/non-conformances/{id}/disposition
```

---

### Production Hold

```http
POST   /api/v1/production-holds
POST   /api/v1/production-holds/{id}/release
GET    /api/v1/production-holds?scope=order&scopeId={orderId}
```

---

### Documents

```http
POST   /api/v1/documents
POST   /api/v1/documents/{id}/revisions
POST   /api/v1/document-revisions/{id}/upload-url
POST   /api/v1/document-revisions/{id}/complete-upload
POST   /api/v1/document-revisions/{id}/submit-review
POST   /api/v1/document-revisions/{id}/approve
POST   /api/v1/document-revisions/{id}/release
POST   /api/v1/document-revisions/{id}/withdraw
GET    /api/v1/documents/{id}/revisions
```

#### Beispiel: Upload Flow

```typescript
// 1. Request Upload URL
// POST /api/v1/document-revisions/{id}/upload-url
interface UploadUrlRequest {
  mimeType: string;
  fileSizeBytes: number;
  expectedHashSha256: string;  // client pre-computes
}
interface UploadUrlResponse {
  uploadUrl: string;      // signed S3 URL, short-lived
  uploadId: string;
  expiresAt: string;
}

// 2. Client uploads directly to S3

// 3. Complete Upload
// POST /api/v1/document-revisions/{id}/complete-upload
interface CompleteUploadRequest {
  uploadId: string;
  actualHashSha256: string;
}
interface CompleteUploadResponse {
  status: 'VERIFIED' | 'HASH_MISMATCH' | 'MALWARE_SCAN_PENDING';
  malwareScanStatus: string;
}
```

---

### Production Plans

```http
POST   /api/v1/production-plans
POST   /api/v1/production-plans/{id}/revisions
POST   /api/v1/production-plan-revisions/{id}/steps
POST   /api/v1/production-plan-revisions/{id}/submit-review
POST   /api/v1/production-plan-revisions/{id}/approve
POST   /api/v1/production-plan-revisions/{id}/release
POST   /api/v1/production-plan-revisions/{id}/validate-graph  # cycle check
```

---

### Production Orders

```http
POST   /api/v1/production-orders
POST   /api/v1/production-orders/{id}/release
POST   /api/v1/production-orders/{id}/assign
GET    /api/v1/production-orders/{id}
GET    /api/v1/production-orders?status=IN_PROGRESS&projectId=...
GET    /api/v1/production-orders/by-serial/{serialNumber}
```

---

### Sync API

```http
GET    /api/v1/sync/changes?cursor={cursor}&deviceId={deviceId}
POST   /api/v1/sync/commands
GET    /api/v1/sync/health
```

#### Sync Changes (Server → Client)

```typescript
// GET /api/v1/sync/changes?cursor=12345&deviceId=xyz
interface SyncChangesResponse {
  cursor: number;           // new cursor position
  hasMore: boolean;
  events: Array<{
    eventId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    serverTimestamp: string;
    version: number;
  }>;
}
```

#### Sync Commands (Client → Server, Batch)

```typescript
// POST /api/v1/sync/commands
interface SyncCommandsRequest {
  deviceId: string;
  commands: Array<{
    idempotencyKey: string;
    commandType: string;       // 'complete_work_step', 'create_ncr', etc.
    payload: Record<string, unknown>;
    clientTimestamp: string;
    entityVersion?: number;
  }>;
}

interface SyncCommandsResponse {
  results: Array<{
    idempotencyKey: string;
    status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT' | 'DUPLICATE';
    resultingState?: Record<string, unknown>;
    conflictType?: 'REVISION_CONFLICT' | 'PERMISSION_REVOKED' | 
                    'ORDER_ON_HOLD' | 'ENTITY_VERSION_CONFLICT' |
                    'BLOCKING_NCR' | 'MISSING_OR_CORRUPT_EVIDENCE';
    conflictDetail?: Record<string, unknown>;
    errors?: ApiError[];
  }>;
}
```

**Verarbeitungsreihenfolge:** Commands werden in stabiler, client-definierter Reihenfolge sequenziell verarbeitet (nicht parallel), um kausale Abhängigkeiten zu respektieren (z.B. Checklisten-Antwort vor Completion Submission).

---

### Search & Traceability

```http
GET    /api/v1/search?q={query}&type=serial_number|order|document
GET    /api/v1/production-dossiers/by-serial/{serialNumber}
POST   /api/v1/production-dossiers/{id}/export
GET    /api/v1/export-manifests/{id}
```

---

## Event-Verträge (Outbox Events)

Alle Events folgen dem Schema:

```typescript
interface DomainEvent {
  eventId: string;              // UUID
  eventType: string;             // Vergangenheitsform: 'work_step.completed'
  eventVersion: string;          // Schema-Version, z.B. "1.0"
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;          // welches Event/Command löste dies aus
  payload: Record<string, unknown>;
  occurredAt: string;             // server timestamp
}
```

### Event-Katalog (Auszug)

| Event Type | Payload Highlights |
|---|---|
| `production_order.released` | orderId, planRevisionId |
| `work_step.released` | workStepInstanceId, releaseTokenId |
| `work_step.started` | workStepInstanceId, actorId, deviceId |
| `work_step.completed` | workStepInstanceId, completedAt, usedRevisions |
| `work_step.completion_rejected` | workStepInstanceId, reasons[] |
| `work_step.blocked` | workStepInstanceId, ncrId or holdId |
| `document_revision.released` | documentId, revisionId, releasedBy |
| `document_revision.superseded` | documentId, oldRevisionId, newRevisionId |
| `non_conformance.raised` | ncrId, blocking, affectedStepId |
| `non_conformance.closed` | ncrId, disposition |
| `production_hold.applied` | holdId, scope, reason |
| `production_hold.released` | holdId, releasedBy |
| `second_approval.granted` | workStepInstanceId, reviewerId |
| `revision_conflict.detected` | workStepInstanceId, oldRevisionId, newRevisionId |

**Konsumenten:** Interne Services (PDF-Generierung, Benachrichtigungen), zukünftige externe Webhooks. Kein externer Consumer darf interne Tabellenstruktur voraussetzen – nur das Event-Schema ist Vertrag.

---

## OpenAPI-Grundgerüst

Vollständige OpenAPI 3.1 Spezifikation wird in `openapi/v1.yaml` gepflegt (wird bei Implementierungsstart erzeugt). Struktur:

```yaml
openapi: 3.1.0
info:
  title: ProQuaDo API
  version: "1.0"
servers:
  - url: /api/v1
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    ApiError: {...}
    WorkStepInstance: {...}
    # ... generated from Prisma schema + Zod validators
paths:
  /work-steps/{id}/start:
    post: {...}
```

---

## Rate Limits & Größenlimits

| Endpunkt-Kategorie | Rate Limit | Größenlimit |
|---|---|---|
| Standard API | 100 req/min/user | - |
| Sync Commands (Batch) | 10 req/min/device | 500 Commands/Batch |
| Photo Upload | 20 uploads/min/device | 25 MB/Foto |
| Document Upload | 5 uploads/min/user | 200 MB/Datei |
| Export/Dossier | 5 req/hour/user | - |

---

## Nächste Schritte

→ **06_OFFLINE_SYNC_CONFLICT.md**: Offline-Architektur, Release Token Details, Konfliktauflösung
