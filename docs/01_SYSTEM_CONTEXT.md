# 1. Systemkontext und Architekturübersicht

**Dokumentversion:** 1.0  
**Status:** Foundation  
**Gültig ab:** 2026-08-08  

---

## Vision

ProQuaDo ist eine produktionsreife Anwendung zur Planung, Ausführung, Prüfung und lückenlosen Dokumentation von Fertigungsaufträgen. Sie unterstützt ein Qualitätsmanagementsystem nach ISO 9001:2015 Amendment 1:2024 ohne Zertifizierungsbehauptung.

**Zentrales Versprechen:** Jeder Arbeitsschritt wird transparent, rückverfolgbar und unveränderlich dokumentiert. Der Server kontrolliert den Prozessfortschritt. Offline-Datenerfassung funktioniert, umgeht aber nicht die Serverautorität.

---

## Systemgrenzen

### In Scope (MVP)
- Projekt- und Produktverwaltung
- Revisionierte Dokumentenverwaltung mit Freigabeworkflow
- Fertigungsplan mit linearen Schritten und Abhängigkeiten
- Tablet-optimierte Benutzeroberfläche für Produktion
- Online- und Offline-Arbeitsschrittausführung
- Checklisten, Fotos, Messwerte, Bestätigungen
- Einfache NCR, Nacharbeit, Nachprüfung
- Vier-Augen-Prüfung
- Append-only Audit Trail
- Digitale Produktionsakte (PDF/ZIP)
- Dashboard und Benachrichtigungen

### Out of Scope (Phase 2+)
- Vollständiges ERP/MES/PLM/CAD-System
- Kryptographisch qualifizierte elektronische Signaturen
- Autonome KI-Produktionsentscheidungen
- Native Apps (Web/PWA zuerst)
- Komplexe parallele Workflowgraphen
- Umfassende CAPA und BI
- Multi-ERP-Integrationen

---

## Architekturüberblick

### Schichtenarchitektur

```
┌─────────────────────────────────────────────────────────┐
│ Clients (Browser, Mobile Web, PWA)                      │
│ - Tablet-optimiert mit Touch                            │
│ - Offline-erste lokale DB & Outbox                      │
│ - Release-Token Validierung                             │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP/JSON + WebSocket
┌────────────────────────▼────────────────────────────────┐
│ Next.js Server                                          │
│ ┌──────────────────────────────────────────────────┐   │
│ │ API Layer                                        │   │
│ │ - Authentifizierung (OIDC/OAuth2)               │   │
│ │ - Autorisierung (RBAC/ABAC)                     │   │
│ │ - Input Validation, Error Handling              │   │
│ └──────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────┐   │
│ │ Domänenservices (Workflow Engine)               │   │
│ │ - Production Planning & Execution               │   │
│ │ - Document & Revision Management                │   │
│ │ - Quality & Non-Conformance                     │   │
│ │ - Sync & Conflict Resolution                    │   │
│ │ - Audit Trail Management                        │   │
│ └──────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────┐   │
│ │ Event & Transactional Outbox                    │   │
│ │ - Write Events atomically with Domain Changes   │   │
│ │ - Outbox for Async Processors                   │   │
│ └──────────────────────────────────────────────────┘   │
└────────────────┬─────────────────┬─────────────────────┘
                 │                 │
        ┌────────▼──────┐  ┌──────▼──────────┐
        │ PostgreSQL    │  │ S3-Compatible  │
        │ (Prisma)      │  │ Object Storage │
        │               │  │                │
        │ - Relational  │  │ - Documents    │
        │ - Audit       │  │ - Photos       │
        │ - Events      │  │ - Exports      │
        └────────────────┘  └────────────────┘
                 │
        ┌────────▼────────────────┐
        │ Background Services     │
        │ (Queue/Workers)         │
        │ - PDF Generation        │
        │ - Image Processing      │
        │ - Sync Notifications    │
        │ - Report Jobs           │
        └─────────────────────────┘
```

### Kernkomponenten

#### 1. **Identity & Access Control**
- OIDC/OAuth2 Provider (z.B. Keycloak, AWS Cognito)
- Session Management mit Device & MFA
- RBAC über Roles + Permissions
- ABAC für Organization, Site, Department, Project
- Qualifications mit Gültigkeitszeitraum

#### 2. **Organization & Hierarchy**
- Organisationen, Standorte, Abteilungen, Arbeitsbereiche
- Zukunfts-sicher für Multi-Tenancy
- Organization-ID auf allen kritischen Tabellen erzwungen

#### 3. **Project & Document Management**
- Projekte mit Kundendaten, Terminen, Team
- Produkte, Baugruppen, Teile
- Dokumente mit Revision, Gültigkeitszeitraum, Status
- Viewer für PDF/CAD mit Markierungen
- Änderungsmanagement mit Auswirkungsanalyse

#### 4. **Production Planning**
- Fertigungspläne (revisioniert, freigegeben)
- Arbeitsschritte mit Abhängigkeiten und Anforderungen
- Checklisten-Templates, Inspektionsmerkmale
- Foto-, Signatur-, Messwert-, Vier-Augen-Regeln
- Prüfmittelverwaltung & Kalibrierung

#### 5. **Production Execution**
- Produktionsaufträge mit Status-Zustandsmaschine
- Arbeitsschrittinstanzen und Release Tokens
- Lokale Bearbeitung mit Outbox & Synchronisation
- Offline-Mode mit Konfliktauflösung
- Abschlussvalidierung durch Server

#### 6. **Quality Management**
- Non-Conformances (NCR) mit Disposition
- Produktionssperren und Freigaben
- Nacharbeit und Nachprüfung
- Prüfmittel und Kalibrierstatus
- CAPA-Referenzen (Phase 2)

#### 7. **Audit & Traceability**
- Append-only Audit Trail
- Event Sourcing (Transactional Outbox)
- Digitale Produktionsakte
- Manifest mit Datei-Hashes

#### 8. **Sync & Offline**
- Lokale SQLite/IndexedDB mit Encryption
- Release Tokens für Offline-Start
- Konfliktcenter bei Revision- oderPermissionänderungen
- Resumable Photo Uploads

---

## Zentrale Invarianten

### 1. Server ist Autorität
- Nur der Server entscheidet über Status, Freigaben, Sperren
- Client kann lokal eine Entität ändern, nicht aber verbindlich freigeben
- Offline-Abschluss = `COMPLETED_PENDING_SYNC`, nicht `COMPLETED`

### 2. Offline-Regel (Kernprinzip)
```
✓ Offline: freigegebenen Schritt bearbeiten, lokal fertigstellen
✗ Offline: nächsten Schritt freigeben oder starten
```

### 3. Unveränderliche Historie
- Alte Revisionen bleiben lesbar, auch wenn ersetzt
- Ausführung wird mit tatsächlich verwendeter Revision verknüpft
- Änderungen erzeugen neue Entitäten, nicht rückwirkend rewritten

### 4. Vier-Augen für Kritisches
- Executor ≠ Reviewer (Personen, Qualifikation, Zugehörigkeit)
- Gilt für Freigaben, bestimmte Prüfungen, Sperrenaufhebung

### 5. Datenintegrität vor Komfort
- Validierung auf Server, nicht lokal optional
- Fehlende Nachweise = kein Abschluss
- Toleranzverletzung = blockierende NCR

---

## Deployment Topology

```
┌─────────────────────────────────────────────┐
│ Prod Environment                            │
├─────────────────────────────────────────────┤
│ - PostgreSQL 15+ (HA, Point-in-Time DR)    │
│ - S3-compatible Object Storage (versioned) │
│ - Next.js Cluster (Loadbalanced)           │
│ - Queue/Worker für Async Jobs              │
│ - Redis für Session & Cache (optional)     │
│ - TLS überall, Firewall, VPN/IP Whitelist │
│ - Logging & Monitoring (centralized)       │
│ - Backup Strategy: RPO ≤ 1h, RTO ≤ 4h     │
└─────────────────────────────────────────────┘
```

**Anforderungen an Betrieb:**
- Verschlüsselt im Transit (TLS 1.3)
- Verschlüsselt in Ruhe (Database Encryption + S3 SSE)
- Geheimnisse in securely managed Service (AWS Secrets, Vault)
- Least Privilege für DB, Storage, Queue
- Audit Logs in separate, read-only Log Sink
- Disaster Recovery: wöchentliche Restore-Probe

---

## Schnittstellen & Integrationspunkte

### Client ↔ Server
- **REST/JSON über HTTPS**
  - Versionierte Endpoints: `/api/v1/...`
  - Idempotency Keys für Schreiboperationen
  - ETags/Versionen für Konflikt-Handling
  - RFC-7807-ähnliche Fehler
  - Cursor-Pagination mit stabiler Sortierung

- **WebSocket (optional, Phase 2)**
  - Real-time Benachrichtigungen
  - Sync-Status Live-Updates

### Sync Protocol (Client → Server)
```
1. Health Check & Session Renewal
2. Send Outbox (Commands + Evidence Files)
3. Fetch Changes (Events since Cursor)
4. Local Projection Update (atomic)
5. Confirm Outbox Entries
```

### External Integrations (Phase 2)
- **ERP** (SAP, NetSuite, Odoo)
  - Project/Order Import
  - Status/QA Export
  - Idempotent with Mapping Quarantine

- **QR/Barcode**
  - Not Guessable Resolver
  - Authorized Decryption or Server-Side Lookup

- **Webhooks**
  - Signed (HMAC-SHA256)
  - Versioned Payloads
  - Auditable & Retriable

---

## Non-Functional Requirements

| Aspekt           | Anforderung                                   |
|------------------|-----------------------------------------------|
| **Availability** | 99.5% uptime (planned maintenance excluded)   |
| **Latency**      | API p95 < 500ms; Sync < 2s                    |
| **Storage**      | Projected: 10–50 GB per year (photo-heavy)   |
| **Backup**       | Daily incremental, weekly full; 7-year retain |
| **Security**     | SOC 2 Type II ready; Penetration Test yearly |
| **Compliance**   | DSGVO, optional industry certifications       |
| **Accessibility**| WCAG 2.2 AA for web, touch-optimized         |
| **i18n**         | German + English; ready for more              |

---

## Risikoanalyse (Übersicht)

| Risiko                               | Likelihood | Impact | Mitigation                                    |
|--------------------------------------|------------|--------|-----------------------------------------------|
| Datenverlust durch DB-Fehler        | Low        | High   | PITR Backups, Audit Append-Only, Replication |
| Offline-Konflikt maskiert Fehler    | Medium     | High   | Explicit Conflict UI, Manual Resolution      |
| Unerwartete Dokumentrevision        | Medium     | Medium | Conflict Detection, Auswirkungsanalyse       |
| Unbefugter Schrittzugriff           | Low        | High   | RBAC/ABAC, Server-seitige Autorisierung      |
| Foto-/Messwert-Duplikate            | Low        | Medium | Idempotency Keys, Deduplication              |
| Prüfmittel-Datumsfehler             | Low        | Medium | Server-seitige Kalibriervalidierung          |
| Performance unter Last              | Low        | Medium | Pagination, Indexing, Query Optimization     |

---

## Nächste Schritte (Sequenz)

1. ✓ Systemkontext (dieses Dokument)
2. → **Domänenmodell & ER-Modell**
3. → Zustandsautomaten
4. → Rollen-, Rechte- und Freigabematrix
5. → API- und Event-Verträge
6. → Offline-, Konflikt- und Wiederanlaufkonzept
7. → Wireflows & UX-Flows
8. → Bedrohungsmodell & Datenschutz
9. → Testpyramide & Abnahmekriterien
10. → MVP-Plan & Entwicklungsphasen

---

## Anhang: Glossar (Kurzform)

- **Auftrag** (Production Order): Konkrete Herstellungsanforderung mit Auftragsnummer, Seriennummer/Charge
- **Arbeitsschritt** (Work Step): Einzelne Tätigkeit in einem Plan mit Abhängigkeiten, Anforderungen, Ressourcen
- **Fertigungsplan** (Production Plan): Revisionierte Vorlage des Ablaufs mit linearen oder DAG-Schritten
- **Dokumentrevision** (Document Revision): Unveränderliche Version eines Dokuments mit Freigabestatus
- **Serverfreigabe** (Release): Autoritative Erlaubnis für einen Schritt, start-ready zu sein
- **NCR** (Non-Conformance Report): Abweichungsmeldung mit Blockierungswirkung
- **Nacharbeit** (Rework): Mit NCR verknüpfter Schritt zur Fehlerbehandlung
- **Produktionsakte** (Production Dossier): Audit- und Nachweissammlung für Auftrag/Seriennummer
- **Release Token**: Signierter Nachweis einer konkreten, autorisierten Schrittfreigabe
- **Audit Trail**: Append-only Historie von Handlungen, Entscheidungen und Zustandsänderungen
